import { describe, expect, it } from 'vitest';
import { chunkTranscript, formatApiError, mergeAIResults, parseAIResponse } from '../src/gemini.js';

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

  it('formats API errors clearly', () => {
    expect(formatApiError(401, {})).toContain('401');
    expect(formatApiError(404, {})).toContain('404');
    expect(formatApiError(429, {})).toContain('429');
  });
});
