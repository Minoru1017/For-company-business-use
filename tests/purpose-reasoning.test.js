import { describe, expect, it } from 'vitest';
import { buildDeepReasoning } from '../src/purpose-reasoning.js';
import { buildPurposeProfile } from '../src/purpose-types.js';
import { enrichSegments } from '../src/parser.js';

describe('purpose-reasoning', () => {
  it('builds six-step deep reasoning chain for dominant type', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '我想學 AI', spk: 'C' },
      { start: 5, end: 10, text: '你最擔心的是什麼？', spk: 'S' },
      { start: 10, end: 20, text: '我最擔心被淘汰，壓力很大，怕跟不上同事', spk: 'C' },
    ]);
    const profile = buildPurposeProfile(segs);
    const dr = profile.deepReasoning;
    expect(dr.ready).toBe(true);
    expect(dr.chains[0].label).toBe('怕什麼');
    expect(dr.chains[0].steps).toHaveLength(6);
    expect(dr.chains[0].steps[1].key).toBe('deep');
    expect(dr.chains[0].steps[3].key).toBe('verify');
  });

  it('flags ambiguous when two types score similarly', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '我想學 AI 跟上趨勢，也擔心被淘汰', spk: 'C' },
      { start: 5, end: 15, text: '我怕跟不上同事，也想跟同行一起學', spk: 'C' },
    ]);
    const profile = buildPurposeProfile(segs);
    expect(profile.deepReasoning.ambiguous).toBe(true);
    expect(profile.deepReasoning.ambiguousTypes.length).toBe(2);
  });

  it('returns not ready when no customer speech', () => {
    const segs = enrichSegments([{ start: 0, end: 5, text: '您好', spk: 'S' }]);
    const dr = buildDeepReasoning(segs, buildPurposeProfile(segs));
    expect(dr.ready).toBe(false);
  });
});
