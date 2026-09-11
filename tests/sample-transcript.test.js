import { describe, expect, it } from 'vitest';
import { runAnalysis } from '../src/analyze.js';
import { applyBuiltinSpeakerLabels, enrichSegments, parse } from '../src/parser.js';
import { SAMPLE_TRANSCRIPT_NAME, SAMPLE_TRANSCRIPT_SRT } from '../src/sample-transcript.js';
import { labeledRatio } from '../src/speaker-labels.js';

function loadSample() {
  const segs = parse(SAMPLE_TRANSCRIPT_SRT);
  applyBuiltinSpeakerLabels(segs);
  enrichSegments(segs);
  return segs;
}

describe('built-in sample transcript', () => {
  it('parses into a fully speaker-labelled ~3 minute call', () => {
    const segs = loadSample();
    expect(SAMPLE_TRANSCRIPT_NAME).toMatch(/\.srt$/);
    expect(segs.length).toBeGreaterThanOrEqual(20);
    expect(labeledRatio(segs)).toBe(1);
    expect(segs.some((s) => s.spk === 'S')).toBe(true);
    expect(segs.some((s) => s.spk === 'C')).toBe(true);
    expect(segs[0].spk).toBe('S');
    const total = segs[segs.length - 1].end - segs[0].start;
    expect(total).toBeGreaterThan(150);
    expect(total).toBeLessThan(240);
    expect(segs.every((s) => !/SPEAKER_\d+/.test(s.text))).toBe(true);
  });

  it('exercises the analysis: most steps and layers hit, report has both praise and improvements', () => {
    const segs = loadSample();
    const r = runAnalysis(segs);
    const stepsHit = Object.values(r.stepHit).filter(Boolean).length;
    expect(stepsHit).toBeGreaterThanOrEqual(5);
    expect(r.layerHits.filter((l) => l.hit).length).toBeGreaterThanOrEqual(4);
    expect(r.stats.custRatio).toBeGreaterThan(0.35);
    expect(r.good.length).toBeGreaterThan(0);
    expect(r.bad.length + r.sug.length).toBeGreaterThan(0);
    expect(r.reportText.length).toBeGreaterThan(100);
  });
});
