import { describe, expect, it } from 'vitest';
import {
  formatElapsed,
  normalizeEngine,
  startBlockReason,
  transcribeDoneMessages,
  transcriptFileName,
} from '../src/dev-audio-upload.js';

describe('dev audio upload helpers', () => {
  it('normalizes engine to gemini unless worker', () => {
    expect(normalizeEngine('worker')).toBe('worker');
    expect(normalizeEngine('gemini')).toBe('gemini');
    expect(normalizeEngine(null)).toBe('gemini');
    expect(normalizeEngine('gpu')).toBe('gemini');
  });

  it('formats elapsed time', () => {
    expect(formatElapsed(0)).toBe('0 秒');
    expect(formatElapsed(59_999)).toBe('59 秒');
    expect(formatElapsed(65_000)).toBe('1 分 05 秒');
    expect(formatElapsed(3_600_000)).toBe('60 分 00 秒');
  });

  it('reports why start is blocked, in priority order', () => {
    const ok = { hasFile: true, apiKey: 'k', consent: true };
    expect(startBlockReason({ ...ok, busy: true })).toBe('busy');
    expect(startBlockReason({ ...ok, hasFile: false })).toBe('請先選擇錄音檔');
    expect(startBlockReason({ ...ok, apiKey: '' })).toBe('請貼上 Gemini API Key');
    expect(startBlockReason({ ...ok, keyProblem: 'Key 格式不對' })).toBe('Key 格式不對');
    expect(startBlockReason({ ...ok, consent: false })).toBe('請勾選知情同意');
    expect(startBlockReason(ok)).toBe('');
    expect(startBlockReason()).toBe('請先選擇錄音檔');
  });

  it('derives transcript file name from audio name', () => {
    expect(transcriptFileName('0930 王先生.m4a')).toBe('0930 王先生.srt');
    expect(transcriptFileName('call.MP3')).toBe('call.srt');
    expect(transcriptFileName('noext')).toBe('noext.srt');
    expect(transcriptFileName('')).toBe('audio.srt');
  });

  it('builds done messages, warning when truncated', () => {
    const ok = transcribeDoneMessages({ lines: 120, truncated: false });
    expect(ok.kind).toBe('ok');
    expect(ok.status).toContain('120 句');
    expect(ok.toast).toContain('120 句');
    const cut = transcribeDoneMessages({ lines: 80, truncated: true });
    expect(cut.kind).toBe('err');
    expect(cut.status).toContain('截斷');
    expect(cut.toast).toContain('截斷');
  });
});
