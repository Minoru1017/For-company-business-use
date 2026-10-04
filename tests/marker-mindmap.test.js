import { describe, expect, it } from 'vitest';
import {
  autoLayout,
  buildMindmap,
  evidenceStrength,
  normalizeEvidence,
  normalizeMarkerAnalysis,
  parseTimeInput,
  positionsForCall,
  suggestEvidence,
} from '../src/marker-mindmap.js';
import { normalizeMarkers } from '../src/call-timeline-player.js';

const call = (over = {}) => ({
  id: 'c1',
  name: '20261002_1430_0912.wav',
  startTime: '14:30',
  devMarkers: [
    { id: 'm2', sec: 95, text: '她說要考慮', surface: '我再考慮看看', intent: '還不信任我', evidence: [] },
    { id: 'm1', sec: 30, text: '開頭報名字' },
  ],
  ...over,
});

describe('marker analysis fields', () => {
  it('fills missing surface / intent / evidence for legacy markers', () => {
    expect(normalizeMarkerAnalysis({ text: 'x' })).toEqual({ surface: '', intent: '', evidence: [] });
  });

  it('drops empty evidence and normalizes kinds / seconds', () => {
    const out = normalizeEvidence([
      { text: '  我再想想 ', sec: '12', spk: 'C', source: 'transcript' },
      { text: '', sec: 3 },
      { kind: 'behavior', text: '停頓 3 秒', sec: null },
      { kind: 'weird', text: 'x', sec: -5, spk: 'Z' },
    ]);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ kind: 'quote', text: '我再想想', sec: 12, spk: 'C', source: 'transcript' });
    expect(out[1]).toMatchObject({ kind: 'behavior', sec: null, source: 'manual' });
    expect(out[2]).toMatchObject({ kind: 'quote', sec: 0, spk: null });
    expect(out.every((e) => e.id)).toBe(true);
  });

  it('player normalizeMarkers keeps analysis fields instead of dropping them', () => {
    const [m] = normalizeMarkers([{ id: 'a', sec: 10, text: 't', surface: 's', intent: 'i', evidence: [{ id: 'e', text: 'q' }] }], 100);
    expect(m).toMatchObject({ surface: 's', intent: 'i', evidence: [{ id: 'e', text: 'q' }] });
    const [legacy] = normalizeMarkers([{ id: 'b', sec: 5 }], 100);
    expect(legacy).toMatchObject({ surface: '', intent: '', evidence: [] });
  });
});

describe('evidenceStrength', () => {
  it('is empty until an intent is written', () => {
    expect(evidenceStrength({ intent: '', evidence: [{ text: 'q' }] }).level).toBe('empty');
  });

  it('flags intent without evidence as 只有我覺得', () => {
    const s = evidenceStrength({ intent: '她怕被推銷', evidence: [] });
    expect(s.level).toBe('none');
    expect(s.label).toContain('我覺得');
  });

  it('is weak with a single piece of evidence or behavior-only', () => {
    expect(evidenceStrength({ intent: 'x', evidence: [{ text: '原句' }] }).level).toBe('weak');
    expect(
      evidenceStrength({
        intent: 'x',
        evidence: [
          { kind: 'behavior', text: '停頓' },
          { kind: 'behavior', text: '回答變短' },
        ],
      }).level
    ).toBe('weak');
  });

  it('is solid with at least one quote plus another piece of evidence', () => {
    const s = evidenceStrength({
      intent: 'x',
      evidence: [
        { kind: 'quote', text: '我再考慮' },
        { kind: 'behavior', text: '停頓 3 秒' },
      ],
    });
    expect(s.level).toBe('solid');
    expect(s.quotes).toBe(1);
    expect(s.behaviors).toBe(1);
  });
});

describe('suggestEvidence', () => {
  const transcript = [
    { start: 0, end: 5, text: '您好我是小美', spk: 'S' },
    { start: 60, end: 64, text: '我現在很忙', spk: 'C' },
    { start: 80, end: 85, text: '那我改天再打', spk: 'S' },
    { start: 90, end: 96, text: '我再考慮看看', spk: 'C' },
    { start: 300, end: 305, text: '好，掰掰', spk: 'C' },
    { start: 100, end: 102, text: '   ' },
  ];

  it('returns lines within the window, sorted by time', () => {
    const out = suggestEvidence(transcript, 92);
    expect(out.map((s) => s.sec)).toEqual([80, 90]);
    expect(out[1]).toMatchObject({ text: '我再考慮看看', spk: 'C' });
  });

  it('respects windowSec and limit', () => {
    expect(suggestEvidence(transcript, 92, { windowSec: 40 }).map((s) => s.sec)).toEqual([60, 80, 90]);
    expect(suggestEvidence(transcript, 92, { windowSec: 40, limit: 2 }).map((s) => s.sec)).toEqual([80, 90]);
  });

  it('handles missing transcript', () => {
    expect(suggestEvidence(null, 10)).toEqual([]);
  });
});

describe('parseTimeInput', () => {
  it('parses m:ss, plain seconds and 1m23s', () => {
    expect(parseTimeInput('1:23')).toBe(83);
    expect(parseTimeInput('83')).toBe(83);
    expect(parseTimeInput('1m23s')).toBe(83);
    expect(parseTimeInput('45s')).toBe(45);
    expect(parseTimeInput('')).toBeNull();
    expect(parseTimeInput('abc')).toBeNull();
  });
});

describe('buildMindmap', () => {
  it('expands each marker into surface + intent + evidence branches, sorted by time', () => {
    const g = buildMindmap([call()], { dayLabel: '10/02' });
    const types = g.nodes.map((n) => n.type);
    expect(g.nodes[0]).toMatchObject({ id: 'root', label: '10/02' });
    expect(types.filter((t) => t === 'call')).toHaveLength(1);
    expect(types.filter((t) => t === 'marker')).toHaveLength(2);
    const markers = g.nodes.filter((n) => n.type === 'marker');
    expect(markers.map((n) => n.sec)).toEqual([30, 95]);
    const intent = g.nodes.find((n) => n.id === 'in:c1:m2');
    expect(intent).toMatchObject({ parent: 'mk:c1:m2', label: '還不信任我', strength: { level: 'none' } });
    expect(g.nodes.find((n) => n.id === 'nv:c1:m2')).toMatchObject({ type: 'noevidence', parent: 'in:c1:m2' });
    expect(g.nodes.find((n) => n.id === 'sf:c1:m1')).toMatchObject({ empty: true, parent: 'mk:c1:m1' });
    expect(g.edges.every((e) => g.nodes.some((n) => n.id === e.from) && g.nodes.some((n) => n.id === e.to))).toBe(true);
  });

  it('renders evidence nodes with time and speaker', () => {
    const c = call({
      devMarkers: [{ id: 'm1', sec: 30, text: 't', intent: 'i', evidence: [{ id: 'e1', kind: 'quote', text: '我再考慮', sec: 31, spk: 'C' }] }],
    });
    const g = buildMindmap([c]);
    const ev = g.nodes.find((n) => n.type === 'evidence');
    expect(ev).toMatchObject({ id: 'ev:c1:m1:e1', parent: 'in:c1:m1', sec: 31, label: '我再考慮' });
    expect(ev.sub).toContain('原句');
    expect(ev.sub).toContain('客戶');
    expect(g.nodes.some((n) => n.type === 'noevidence')).toBe(false);
  });

  it('skips calls without markers and collapses calls on request', () => {
    const g = buildMindmap([call(), call({ id: 'c2', devMarkers: [] })], { collapsed: new Set(['c1']) });
    expect(g.nodes.filter((n) => n.type === 'call')).toHaveLength(1);
    expect(g.nodes.find((n) => n.type === 'call')).toMatchObject({ collapsed: true });
    expect(g.nodes.some((n) => n.type === 'marker')).toBe(false);
  });
});

describe('autoLayout', () => {
  it('places depth on x, keeps siblings on distinct rows and centers parents', () => {
    const g = buildMindmap([call()]);
    const { positions, width, height } = autoLayout(g, {}, { colW: 100, rowH: 10, padX: 0, padY: 0 });
    expect(positions.root.x).toBe(0);
    expect(positions['call:c1'].x).toBe(100);
    expect(positions['mk:c1:m1'].x).toBe(200);
    expect(positions['sf:c1:m1'].x).toBe(300);
    expect(positions['nv:c1:m2'].x).toBe(400);
    const leafYs = g.nodes.filter((n) => !g.edges.some((e) => e.from === n.id)).map((n) => positions[n.id].y);
    expect(new Set(leafYs).size).toBe(leafYs.length);
    const mk = positions['mk:c1:m1'];
    const kids = [positions['sf:c1:m1'].y, positions['in:c1:m1'].y];
    expect(mk.y).toBeGreaterThanOrEqual(Math.min(...kids));
    expect(mk.y).toBeLessThanOrEqual(Math.max(...kids));
    expect(width).toBeGreaterThan(400);
    expect(height).toBeGreaterThan(Math.max(...leafYs));
  });

  it('keeps saved (dragged) positions and ignores junk', () => {
    const g = buildMindmap([call()]);
    const { positions } = autoLayout(g, { 'mk:c1:m1': { x: 999, y: 5 }, 'sf:c1:m1': { x: 'nope' }, root: { x: -40, y: -10 } });
    expect(positions['mk:c1:m1']).toEqual({ x: 999, y: 5 });
    expect(positions['sf:c1:m1'].x).not.toBeNaN();
    expect(positions.root).toEqual({ x: 0, y: 0 });
  });

  it('positionsForCall only returns nodes of that call', () => {
    const g = buildMindmap([call(), call({ id: 'c2' })]);
    const { positions } = autoLayout(g);
    const only = positionsForCall(g, positions, 'c2');
    expect(Object.keys(only).every((k) => k.includes(':c2'))).toBe(true);
    expect(only.root).toBeUndefined();
    expect(Object.keys(only).length).toBeGreaterThan(5);
  });
});
