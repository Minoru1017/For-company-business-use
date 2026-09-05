import { describe, expect, it } from 'vitest';
import { buildPurposeProfile, detectPurposeSignals, PURPOSE_TYPES } from '../src/purpose-types.js';
import { enrichSegments } from '../src/parser.js';

describe('purpose-types', () => {
  it('detects five purpose types independently', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '我最擔心被淘汰', spk: 'C' },
      { start: 5, end: 10, text: '我希望被當專業人士看待', spk: 'C' },
    ]);
    const signals = detectPurposeSignals(segs);
    expect(signals.map((s) => s.label)).toContain('怕什麼');
    expect(signals.map((s) => s.label)).toContain('愛什麼');
  });

  it('builds profile with dominant type and pitch suggestion', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '我想跟上業界趨勢，想跟同行一起成長', spk: 'C' },
      { start: 5, end: 10, text: '你會跟一群同行一起學，不會落單', spk: 'S' },
    ]);
    const profile = buildPurposeProfile(segs);
    expect(profile.dominant.label).toBe('想什麼');
    expect(profile.pitchMatched).toBe(true);
  });

  it('suggests type-specific amplify when missing', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '我現在最缺的是能用的 AI 工具', spk: 'C' },
      { start: 5, end: 10, text: '我們的課程很好', spk: 'S' },
    ]);
    const profile = buildPurposeProfile(segs);
    expect(profile.dominant.label).toBe('要什麼');
    expect(profile.amplifyMatched).toBe(false);
    expect(profile.recommendations.some((r) => r.type === 'amplify')).toBe(true);
  });

  it('exports five purpose types', () => {
    expect(PURPOSE_TYPES).toHaveLength(5);
    expect(PURPOSE_TYPES.map((t) => t.label)).toEqual(['要什麼', '怕什麼', '想什麼', '愛什麼', '爽什麼']);
  });
});
