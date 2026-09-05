import { describe, expect, it } from 'vitest';
import {
  buildPurposeProfile,
  buildTypeLayerHits,
  detectWrongProbes,
  getTypeDiscoveryLayers,
  TYPE_DISCOVERY_LAYERS,
} from '../src/purpose-types.js';
import { enrichSegments } from '../src/parser.js';

describe('purpose-types tier discovery', () => {
  it('defines five layers per tier with enjoy path from handbook', () => {
    expect(Object.keys(TYPE_DISCOVERY_LAYERS)).toHaveLength(5);
    const enjoy = getTypeDiscoveryLayers('enjoy');
    expect(enjoy.map((l) => l.name)).toEqual(['爽什麼', '你怎樣爽', '如何爽', '爽的意義', '真的爽歪歪']);
    expect(enjoy[4].question).toContain('爽歪歪');
  });

  it('detects wrong probe when enjoy client gets fear questions', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '我想自我證明，做出有意義的影響', spk: 'C' },
      { start: 5, end: 10, text: '你最深的恐懼是什麼？', spk: 'S' },
      { start: 10, end: 15, text: '我最擔心的是什麼？', spk: 'S' },
    ]);
    const profile = buildPurposeProfile(segs);
    expect(profile.dominant.label).toBe('爽什麼');
    expect(profile.wrongProbes.length).toBeGreaterThan(0);
    expect(profile.wrongProbes[0].toward).toBe('怕什麼');
  });

  it('builds tier layer hits for dominant type', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '我想自我證明，幫助更多人', spk: 'C' },
      { start: 5, end: 10, text: '對你來說什麼事會讓你覺得真的很爽很值得？', spk: 'S' },
      { start: 10, end: 20, text: '做到之後能帶著團隊一起升級，這才是我想成為的人', spk: 'C' },
    ]);
    const profile = buildPurposeProfile(segs);
    expect(profile.typeLayerHits.length).toBe(5);
    expect(profile.typeDeepest).toBeGreaterThan(0);
  });

  it('detectWrongProbes returns empty when probes match tier', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '我最擔心被淘汰', spk: 'C' },
      { start: 5, end: 10, text: '你最擔心的是什麼？', spk: 'S' },
    ]);
    const profile = buildPurposeProfile(segs);
    expect(profile.dominant.label).toBe('怕什麼');
    expect(detectWrongProbes(segs, profile.dominant)).toHaveLength(0);
  });

  it('buildTypeLayerHits tracks sales questions', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '你現在最缺的是什麼？', spk: 'S' },
      { start: 5, end: 10, text: '缺能用的 AI 工具', spk: 'C' },
    ]);
    const hits = buildTypeLayerHits(segs, 'want');
    expect(hits[0].hit).toBe(true);
  });
});
