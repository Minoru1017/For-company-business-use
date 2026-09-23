import { describe, expect, it, vi } from 'vitest';
import {
  buildGeminiRequestBody,
  callGemini,
  chunkTranscript,
  describeApiKeyProblem,
  extractSuggestedModel,
  formatApiError,
  isDeprecatedModel,
  isRetryableGeminiStatus,
  mergeAIResults,
  modelsToTryForCapacity,
  parseAIResponse,
  pickPreferredModel,
} from '../src/gemini.js';

describe('gemini helpers', () => {
  it('parses valid AI JSON', () => {
    const raw = '{"good":[{"point":"a","evidence":"b"}],"bad":[],"suggest":[],"summary":"ok"}';
    const j = parseAIResponse(raw);
    expect(j.summary).toBe('ok');
  });

  it('rejects invalid AI JSON shape', () => {
    expect(() => parseAIResponse('{"good":"nope"}')).toThrow();
  });

  it('chunks long transcripts', () => {
    const line = '[00:01] S: ' + '測'.repeat(100);
    const big = Array.from({ length: 200 }, () => line).join('\n');
    const chunks = chunkTranscript(big, 5000);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.length).toBeLessThanOrEqual(5000 + 200));
  });

  it('merges multi-chunk AI results', () => {
    const merged = mergeAIResults([
      { good: [{ point: 'a' }], bad: [], suggest: [], summary: 'A' },
      { good: [{ point: 'b' }], bad: [{ point: 'x' }], suggest: [], summary: 'B' },
    ]);
    expect(merged.good).toHaveLength(2);
    expect(merged.bad).toHaveLength(1);
    expect(merged.summary).toContain('A');
  });

  it('spots broken API key strings before sending', () => {
    const aq = 'AQ.' + 'x'.repeat(90);
    expect(describeApiKeyProblem(aq)).toBe('');
    expect(describeApiKeyProblem('AIza' + 'y'.repeat(35))).toBe('');
    expect(describeApiKeyProblem('')).toContain('請先貼上');
    expect(describeApiKeyProblem('Bearer ' + aq)).toContain('Bearer');
    expect(describeApiKeyProblem(`"${aq}"`)).toContain('引號');
    expect(describeApiKeyProblem('AQ.abc def' + 'x'.repeat(60))).toContain('空格');
    expect(describeApiKeyProblem('AQ。' + 'x'.repeat(80))).toContain('全形');
    expect(describeApiKeyProblem('AQ.short')).toContain('截斷');
    expect(describeApiKeyProblem('AIzaShort')).toContain('不完整');
    expect(describeApiKeyProblem('sk-openai-style-key-1234567890')).toContain('AQ.');
  });

  it('formats API errors clearly', () => {
    expect(formatApiError(401, { error: { message: 'Expected OAuth 2 access token' } })).toContain('AQ.');
    expect(formatApiError(401, {})).toContain('401');
    expect(formatApiError(400, { error: { message: 'API key not valid. Please pass a valid API key.' } })).toContain('重新複製');
    expect(formatApiError(404, { error: { message: 'use models/gemini-3.6-flash' } })).toContain('gemini-3.6-flash');
    expect(formatApiError(429, {})).toContain('429');
    expect(formatApiError(503, { error: { message: 'high demand' } })).toContain('flash-lite');
  });

  it('retries and capacity fallbacks', () => {
    expect(isRetryableGeminiStatus(503)).toBe(true);
    expect(isRetryableGeminiStatus(401)).toBe(false);
    expect(modelsToTryForCapacity('gemini-3.6-flash')[0]).toBe('gemini-3.6-flash');
    expect(modelsToTryForCapacity('gemini-3.6-flash')).toContain('gemini-3.6-flash-lite');
  });

  it('builds text-only and multimodal request bodies', () => {
    const textBody = buildGeminiRequestBody({ text: 'hi' });
    expect(textBody.contents[0].parts).toEqual([{ text: 'hi' }]);
    expect(textBody.generationConfig).toEqual({ temperature: 0.3, responseMimeType: 'application/json' });

    const audioPart = { inline_data: { mime_type: 'audio/mp4', data: 'QUFB' } };
    const multi = buildGeminiRequestBody({
      text: 'ignored',
      parts: [audioPart, { text: 'transcribe' }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 65536 },
    });
    expect(multi.contents[0].parts[0]).toBe(audioPart);
    expect(multi.contents[0].parts[1].text).toBe('transcribe');
    expect(multi.generationConfig).toEqual({ temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 65536 });
  });

  it('joins multiple text parts and passes finishReason to the parser', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"good":[' }, { text: '],"bad":[],"suggest":[]}' }] }, finishReason: 'STOP' }],
        usageMetadata: { totalTokenCount: 42 },
      }),
    }));
    const parse = vi.fn((raw, meta) => ({ raw, meta }));
    const r = await callGemini({ apiKey: 'k', model: 'gemini-3.6-flash', text: 'x', fetchImpl, parse });
    expect(r.raw).toBe('{"good":[],"bad":[],"suggest":[]}');
    expect(r.usedTokens).toBe(42);
    expect(r.finishReason).toBe('STOP');
    expect(parse).toHaveBeenCalledWith(r.raw, { finishReason: 'STOP' });
  });

  it('detects deprecated models and picks preferred', () => {
    expect(isDeprecatedModel('gemini-2.5-flash')).toBe(true);
    expect(isDeprecatedModel('gemini-3.6-flash')).toBe(false);
    expect(extractSuggestedModel('Please use models/gemini-3.6-flash instead')).toBe('gemini-3.6-flash');
    expect(pickPreferredModel(['gemini-2.5-flash', 'gemini-3.6-flash'], 'gemini-2.5-flash')).toBe('gemini-3.6-flash');
  });
});
