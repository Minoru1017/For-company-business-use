import { describe, expect, it } from 'vitest';
import { runAnalysis } from '../src/analyze.js';
import {
  ONE_CHANGE_FALLBACK,
  pickOneChange,
  ratioTone,
  scoreStrip,
  stepSummary,
  stepTone,
  stripTags,
  timelineModel,
} from '../src/call-scorecard.js';
import { applyBuiltinSpeakerLabels, enrichSegments, parse } from '../src/parser.js';
import { RULES } from '../src/rules.js';
import { SAMPLE_TRANSCRIPT_SRT } from '../src/sample-transcript.js';

describe('call-scorecard', () => {
  it('strips report HTML down to the sentence a rep reads', () => {
    expect(stripTags('改問<span class="q">「你平常都用 AI 做哪些事？」</span>')).toBe('改問「你平常都用 AI 做哪些事？」');
    expect(stripTags('<b>A</b> &amp; B&nbsp;&lt;C&gt;')).toBe('A & B <C>');
  });

  it('picks the first suggestion as the one change, with the first problem as why', () => {
    const one = pickOneChange({ sug: ['', '先問<span class="q">「誰拍板？」</span>'], bad: ['<b>沒有確認決策者</b>'] });
    expect(one).toEqual({ change: '先問「誰拍板？」', why: '沒有確認決策者' });
  });

  it('falls back to keeping the structure when there is nothing to change', () => {
    expect(pickOneChange({ sug: [], bad: ['舊問題'] })).toEqual({ change: ONE_CHANGE_FALLBACK, why: '' });
    expect(pickOneChange(undefined).change).toBe(ONE_CHANGE_FALLBACK);
  });

  it('maps ratios and step counts onto the three semantic tones', () => {
    expect([ratioTone(0.5), ratioTone(0.3), ratioTone(0.1)]).toEqual(['ok', 'warn', 'bad']);
    expect([stepTone(6, 6), stepTone(3, 6), stepTone(2, 6)]).toEqual(['ok', 'warn', 'bad']);
  });

  it('summarizes six steps with short labels', () => {
    const { steps, done, total } = stepSummary({ connect: { text: 'x' }, discovery: null });
    expect(total).toBe(RULES.steps.length);
    expect(done).toBe(1);
    expect(steps[0]).toEqual({ key: 'connect', label: '連結', hit: true });
  });

  it('builds the four-number strip from a real analysis', () => {
    const segs = enrichSegments(parse(SAMPLE_TRANSCRIPT_SRT));
    applyBuiltinSpeakerLabels(segs);
    const result = runAnalysis(segs);
    const strip = scoreStrip(result);
    expect(strip.map((s) => s.key)).toEqual(['dur', 'ratio', 'steps', 'questions']);
    expect(strip[0].value).toMatch(/^\d{2}:\d{2}$/);
    expect(strip[1].value).toBe(`${Math.round(result.stats.custRatio * 100)}%`);
    expect(strip[2].value).toMatch(/^\d\/6$/);
  });

  it('lays segments out on a 0-100% timeline and keeps at most five marks in time order', () => {
    const segs = [
      { start: 0, end: 10, spk: 'S', text: 'a' },
      { start: 10, end: 40, spk: 'C', text: 'b' },
      { start: 40, end: 100, spk: 'S', text: 'c' },
    ];
    const moments = Array.from({ length: 7 }, (_, i) => ({
      startIdx: 1,
      endIdx: 1,
      start: 90 - i * 10,
      label: `m${i}`,
      customerChars: i,
      breakthrough: i === 0,
    }));
    const tl = timelineModel(segs, moments);
    expect(tl.total).toBe(100);
    expect(tl.bars[1]).toMatchObject({ spk: 'C', left: 10, width: 30 });
    expect(tl.marks).toHaveLength(5);
    expect(tl.marks.map((m) => m.left)).toEqual([...tl.marks.map((m) => m.left)].sort((a, b) => a - b));
    expect(tl.marks.some((m) => m.breakthrough)).toBe(true);
    expect(tl.ticks).toEqual(['00:00', '00:33', '01:07', '01:40']);
  });

  it('handles an empty transcript without dividing by zero', () => {
    const tl = timelineModel([], []);
    expect(tl.bars).toEqual([]);
    expect(tl.marks).toEqual([]);
  });
});
