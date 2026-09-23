import { describe, expect, it, vi } from 'vitest';
import {
  AUDIO_ACCEPT,
  INLINE_LIMIT_BYTES,
  MAX_AUDIO_BYTES,
  guessAudioMime,
  isAudioFileName,
  parseClock,
  parseTranscriptJson,
  safeWorkerJobName,
  salvageTruncatedJson,
  transcribeAudioWithGemini,
  validateAudioFile,
} from '../src/audio-transcribe.js';

function fakeFile(name, size = 1024, type = '') {
  return {
    name,
    size,
    type,
    arrayBuffer: async () => new Uint8Array(size).fill(65).buffer,
  };
}

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function geminiReply(segments, usage = 1234) {
  return jsonResponse({
    candidates: [{ content: { parts: [{ text: JSON.stringify({ segments }) }] }, finishReason: 'STOP' }],
    usageMetadata: { totalTokenCount: usage },
  });
}

describe('audio file helpers', () => {
  it('recognises audio extensions and mime types', () => {
    expect(isAudioFileName('電訪 0912.m4a')).toBe(true);
    expect(isAudioFileName('call.MP3')).toBe(true);
    expect(isAudioFileName('transcript.vibe.json')).toBe(false);
    expect(isAudioFileName('demo.mp4')).toBe(false);
    expect(AUDIO_ACCEPT).toContain('.m4a');
    expect(AUDIO_ACCEPT).toContain('audio/*');
  });

  it('prefers extension over browser-provided type', () => {
    expect(guessAudioMime({ name: 'a.m4a', type: 'video/mp4' })).toBe('audio/mp4');
    expect(guessAudioMime({ name: 'a.webm', type: '' })).toBe('audio/webm');
    expect(guessAudioMime({ name: 'noext', type: 'audio/x-foo' })).toBe('audio/x-foo');
    expect(guessAudioMime({ name: 'noext', type: '' })).toBe('audio/mpeg');
  });

  it('validates files', () => {
    expect(validateAudioFile(null)).toContain('請先選擇');
    expect(validateAudioFile(fakeFile('x.srt'))).toContain('不支援');
    expect(validateAudioFile(fakeFile('x.mp3', 0))).toContain('空');
    expect(validateAudioFile(fakeFile('x.mp3', MAX_AUDIO_BYTES + 1))).toContain('過大');
    expect(validateAudioFile(fakeFile('x.mp3', 5000))).toBe('');
    expect(validateAudioFile(fakeFile('blob', 5000, 'audio/webm'))).toBe('');
  });

  it('sanitises worker job names but keeps the extension', () => {
    expect(safeWorkerJobName('demo.mp4')).toBe('demo.mp4');
    expect(safeWorkerJobName('電訪 0912.m4a')).toBe('upload.m4a');
    expect(safeWorkerJobName('C:\\Users\\me\\ok-file_1.wav')).toBe('ok-file_1.wav');
    expect(safeWorkerJobName('', 'mp3')).toBe('upload.mp3');
    expect(safeWorkerJobName('a'.repeat(130) + '.mp3')).toBe('upload.mp3');
  });
});

describe('parseClock', () => {
  it('parses mm:ss / h:mm:ss / seconds', () => {
    expect(parseClock('00:04')).toBe(4);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('12.5')).toBe(12.5);
    expect(parseClock(30)).toBe(30);
    expect(parseClock('abc')).toBeNaN();
    expect(parseClock('')).toBeNaN();
  });
});

describe('parseTranscriptJson', () => {
  it('converts Gemini segments into labeled segs', () => {
    const raw = JSON.stringify({
      segments: [
        { start: '00:00', end: '00:04', speaker: 'S', text: '喂，您好' },
        { start: '00:04', end: '00:06', speaker: 'C', text: '你好' },
        { start: '00:06', end: '00:09', speaker: 'customer', text: '請說' },
        { start: '00:09', end: '00:10', speaker: 'S', text: '   ' },
      ],
    });
    const segs = parseTranscriptJson(raw);
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ start: 0, end: 4, text: '喂，您好', spk: 'S', labeled: true });
    expect(segs[1].spk).toBe('C');
    expect(segs[2].spk).toBe('C');
    expect(segs.truncated).toBeUndefined();
  });

  it('strips markdown fences and accepts a bare array', () => {
    const segs = parseTranscriptJson('```json\n[{"start":"0:01","end":"0:03","speaker":"S","text":"hi"}]\n```');
    expect(segs).toHaveLength(1);
    expect(segs[0].start).toBe(1);
  });

  it('fills missing/invalid times monotonically', () => {
    const segs = parseTranscriptJson(
      JSON.stringify({
        segments: [
          { start: 'x', end: null, speaker: 'S', text: '一二三四五六七八' },
          { start: '00:05', end: '00:02', speaker: 'C', text: '好' },
        ],
      })
    );
    expect(segs[0].start).toBe(0);
    expect(segs[0].end).toBeGreaterThan(0);
    expect(segs[1].start).toBe(5);
    expect(segs[1].end).toBeGreaterThanOrEqual(5);
  });

  it('salvages truncated output and flags it', () => {
    const full = JSON.stringify({
      segments: [
        { start: '00:00', end: '00:02', speaker: 'S', text: '第一句' },
        { start: '00:02', end: '00:05', speaker: 'C', text: '第二句' },
        { start: '00:05', end: '00:09', speaker: 'S', text: '第三句 "引號" 也要處理' },
      ],
    });
    const cut = full.slice(0, full.lastIndexOf('{') + 20);
    expect(() => JSON.parse(cut)).toThrow();
    expect(salvageTruncatedJson(cut)).toContain('第二句');
    const segs = parseTranscriptJson(cut);
    expect(segs).toHaveLength(2);
    expect(segs.truncated).toBe(true);
  });

  it('flags MAX_TOKENS even when JSON is intact', () => {
    const raw = JSON.stringify({ segments: [{ start: '0:00', end: '0:01', speaker: 'S', text: 'a' }] });
    expect(parseTranscriptJson(raw, { finishReason: 'MAX_TOKENS' }).truncated).toBe(true);
  });

  it('rejects empty / malformed replies', () => {
    expect(() => parseTranscriptJson('')).toThrow();
    expect(() => parseTranscriptJson('not json at all')).toThrow();
    expect(() => parseTranscriptJson('{"foo":1}')).toThrow(/segments/);
    expect(() => parseTranscriptJson('{"segments":[]}')).toThrow(/未辨識/);
  });
});

describe('transcribeAudioWithGemini', () => {
  it('sends small files inline with the prompt', async () => {
    const fetchImpl = vi.fn(async () => geminiReply([{ start: '0:00', end: '0:02', speaker: 'S', text: '喂' }], 777));
    const result = await transcribeAudioWithGemini({
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      file: fakeFile('call.m4a', 2048),
      fetchImpl,
    });
    expect(result.via).toBe('inline');
    expect(result.usedTokens).toBe(777);
    expect(result.modelUsed).toBe('gemini-3.6-flash');
    expect(result.segs[0].text).toBe('喂');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('/models/gemini-3.6-flash:generateContent');
    expect(init.headers['x-goog-api-key']).toBe('k');
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts[0].inline_data.mime_type).toBe('audio/mp4');
    expect(body.contents[0].parts[0].inline_data.data).toBe(Buffer.alloc(2048, 65).toString('base64'));
    expect(body.contents[0].parts[1].text).toContain('逐字稿');
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.maxOutputTokens).toBeGreaterThan(10000);
  });

  it('uploads large files via the File API, waits for ACTIVE, then deletes', async () => {
    const calls = [];
    const fetchImpl = vi.fn(async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', headers: init.headers || {} });
      if (url.endsWith('/upload/v1beta/files')) {
        return jsonResponse({}, { headers: { 'X-Goog-Upload-URL': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=abc' } });
      }
      if (url.includes('upload_id=abc')) {
        return jsonResponse({ file: { name: 'files/xyz', uri: 'https://generativelanguage.googleapis.com/v1beta/files/xyz', state: 'PROCESSING', mimeType: 'audio/mpeg' } });
      }
      if (url.endsWith('/v1beta/files/xyz') && (init.method || 'GET') === 'GET') {
        return jsonResponse({ name: 'files/xyz', uri: 'https://generativelanguage.googleapis.com/v1beta/files/xyz', state: 'ACTIVE', mimeType: 'audio/mpeg' });
      }
      if (url.endsWith('/v1beta/files/xyz') && init.method === 'DELETE') {
        return jsonResponse({});
      }
      if (url.includes(':generateContent')) {
        const body = JSON.parse(init.body);
        expect(body.contents[0].parts[0].file_data.file_uri).toContain('files/xyz');
        return geminiReply([{ start: '0:00', end: '0:03', speaker: 'C', text: '你好' }]);
      }
      throw new Error(`unexpected ${url}`);
    });

    const result = await transcribeAudioWithGemini({
      apiKey: 'k',
      model: 'gemini-3.6-flash',
      file: fakeFile('big.mp3', 4096),
      fetchImpl,
      inlineLimit: 1024,
    });
    // deletion is fire-and-forget; let it settle
    await new Promise((r) => setTimeout(r, 0));

    expect(result.via).toBe('file_api');
    expect(result.segs[0].spk).toBe('C');
    const startCall = calls.find((c) => c.url.endsWith('/upload/v1beta/files'));
    expect(startCall.headers['X-Goog-Upload-Protocol']).toBe('resumable');
    expect(startCall.headers['X-Goog-Upload-Header-Content-Type']).toBe('audio/mpeg');
    expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('files/xyz'))).toBe(true);
  }, 10000);

  it('rejects unsupported files before touching the network', async () => {
    const fetchImpl = vi.fn();
    await expect(
      transcribeAudioWithGemini({ apiKey: 'k', model: 'm', file: fakeFile('notes.txt'), fetchImpl })
    ).rejects.toThrow(/不支援/);
    await expect(
      transcribeAudioWithGemini({ apiKey: '', model: 'm', file: fakeFile('a.mp3'), fetchImpl })
    ).rejects.toThrow(/API Key/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('exposes INLINE_LIMIT_BYTES under the 20 MB request cap after base64 growth', () => {
    expect((INLINE_LIMIT_BYTES * 4) / 3).toBeLessThan(20 * 1024 * 1024);
  });
});
