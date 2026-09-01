import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyBuiltinSpeakerLabels, enrichSegments, parse, parseVibeJson } from '../src/parser.js';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

describe('parser', () => {
  it('parses Vibe native .vibe.json with speaker numbers', () => {
    const raw = readFileSync(join(fixtures, 'sample.vibe.json'), 'utf8');
    const segs = parseVibeJson(raw);
    expect(segs).toHaveLength(3);
    expect(segs[0].start).toBe(5);
    expect(segs[0].end).toBe(12);
    expect(segs[0].spk).toBe('S');
    expect(segs[0].labeled).toBe(true);
    expect(segs[1].spk).toBe('C');
    expect(segs[1].text).toBe('對，我是。');
  });

  it('parses SRT with speaker labels', () => {
    const text = readFileSync(join(fixtures, 'sample.srt'), 'utf8');
    const segs = applyBuiltinSpeakerLabels(parse(text));
    expect(segs).toHaveLength(2);
    expect(segs[0].spk).toBe('S');
    expect(segs[1].spk).toBe('C');
    expect(segs[0].text).toContain('王先生');
  });

  it('parses VTT timestamps', () => {
    const text = readFileSync(join(fixtures, 'sample.vtt'), 'utf8');
    const segs = parse(text);
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0].start).toBe(5);
  });

  it('parses bracket TXT timestamps', () => {
    const text = readFileSync(join(fixtures, 'sample.txt'), 'utf8');
    const segs = applyBuiltinSpeakerLabels(parse(text));
    expect(segs).toHaveLength(3);
    enrichSegments(segs);
    expect(segs[0].chars).toBeGreaterThan(0);
  });

  it('does not execute HTML in transcript text', () => {
    const segs = parse('[00:01] <script>alert(1)</script>');
    expect(segs[0].text).toContain('<script>');
  });
});
