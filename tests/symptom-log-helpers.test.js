import { describe, expect, it } from 'vitest';
import { buildSheetModel } from '../src/sheet-sync.js';
import {
  applyCellsToRows,
  drillSparkline,
  fmtDateLabel,
  fmtPct,
  plainSegs,
  selfMarkNamesFor,
  srtToSegments,
  startKey,
} from '../src/symptom-log-helpers.js';

describe('symptom log formatting', () => {
  it('formats percentages with a dash for missing values', () => {
    expect(fmtPct(null)).toBe('—');
    expect(fmtPct(undefined)).toBe('—');
    expect(fmtPct(0)).toBe('0%');
    expect(fmtPct(0.456)).toBe('46%');
  });

  it('formats date keys as M/D（週）', () => {
    expect(fmtDateLabel('2026-10-10')).toBe('10/10（六）');
    expect(fmtDateLabel('2026-10-04')).toBe('10/4（日）');
    expect(fmtDateLabel('not-a-date')).toBe('not-a-date');
  });

  it('returns start date only when valid', () => {
    expect(startKey({ startDate: '2026-09-01' })).toBe('2026-09-01');
    expect(startKey({ startDate: '' })).toBe('');
    expect(startKey({ startDate: 'garbage' })).toBe('');
    expect(startKey(null)).toBe('');
  });
});

describe('transcript helpers', () => {
  const srt = `1
00:00:00,000 --> 00:00:03,000
[SPEAKER_00] 您好，這裡是 AI 未來學院

2
00:00:03,500 --> 00:00:06,000
[SPEAKER_01] 喔你好

3
00:00:06,500 --> 00:00:09,000
[SPEAKER_00] 想跟您聊一下上次填的問卷
`;

  it('parses SRT into labelled segments', () => {
    const segs = srtToSegments(srt);
    expect(segs).toHaveLength(3);
    expect(segs.every((s) => s.spk === 'S' || s.spk === 'C')).toBe(true);
    expect(segs.map((s) => s.spk)).toEqual(['S', 'C', 'S']);
    expect(segs[0].text).toBe('您好，這裡是 AI 未來學院');
  });

  it('keeps only start/end/text/spk for storage', () => {
    const out = plainSegs([{ start: 1, end: 2, text: 'a', spk: 'S', extra: 9, words: [] }]);
    expect(out).toEqual([{ start: 1, end: 2, text: 'a', spk: 'S' }]);
  });
});

describe('drillSparkline', () => {
  it('needs at least two days', () => {
    expect(drillSparkline(null)).toBe('');
    expect(drillSparkline([{ date: '2026-10-01', avg: 70, count: 1 }])).toBe('');
  });

  it('draws one point per day with tooltips', () => {
    const svg = drillSparkline([
      { date: '2026-10-01', avg: 60, count: 2 },
      { date: '2026-10-02', avg: 80, count: 1 },
      { date: '2026-10-03', avg: 100, count: 3 },
    ]);
    expect(svg).toMatch(/^<svg class="slog-drill-spark"/);
    expect(svg.match(/<circle /g)).toHaveLength(3);
    expect(svg).toContain('10-02 · 1 次 · 平均 80');
    expect(svg).toContain('points="0,');
  });
});

describe('sheet helpers', () => {
  const rows = [
    ['日期', '開場太長', '沒問預算', ''],
    ['2026/10/09', '有', '', '有做到'],
    ['2026/10/10', '無', 'V', ''],
  ];

  it('lists symptoms marked on for a day', () => {
    const model = buildSheetModel(rows.map((r) => [...r]));
    expect(selfMarkNamesFor(model, '2026-10-09')).toEqual(['開場太長']);
    expect(selfMarkNamesFor(model, '2026-10-10')).toEqual(['沒問預算']);
    expect(selfMarkNamesFor(model, '2026-10-01')).toEqual([]);
    expect(selfMarkNamesFor(null, '2026-10-09')).toEqual([]);
  });

  it('applies written cells locally, growing rows and header width', () => {
    const local = rows.map((r) => [...r]);
    const out = applyCellsToRows(local, [
      { a1: 'C2', value: '有' },
      { a1: 'F4', value: 12 },
      { a1: 'bad', value: 'x' },
      { a1: 'B3', value: null },
    ]);
    expect(out).toBe(local);
    expect(out[1][2]).toBe('有');
    expect(out[2][1]).toBe('');
    expect(out[3][5]).toBe('12');
    expect(out[0]).toHaveLength(6);
  });

  it('starts from an empty sheet', () => {
    expect(applyCellsToRows(null, [{ a1: 'B1', value: '病症' }])).toEqual([['', '病症']]);
    expect(applyCellsToRows([], [{ a1: 'A1', value: 'x' }])).toEqual([['x']]);
  });
});
