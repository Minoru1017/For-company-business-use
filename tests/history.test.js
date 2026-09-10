import { beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

let hist;

beforeEach(async () => {
  globalThis.localStorage = memoryStorage();
  vi.resetModules();
  hist = await import('../src/history.js');
});

const segs = [
  { start: 0, end: 1.5, text: '喂你好', spk: 'S', chars: 3, dur: 1.5 },
  { start: 1.5, end: 3, text: '你好', spk: 'C', chars: 2, dur: 1.5 },
];
const result = {
  stats: { totalDur: 3, custRatio: 0.4, sQuestions: 1 },
  stepHit: { connect: {}, discovery: null },
  deepest: 2,
  purposeProfile: { dominant: { label: '要什麼' } },
  good: ['a'],
  bad: ['b', 'c'],
};

describe('history', () => {
  it('saves minimal segs and a summary, newest first', () => {
    const a = hist.saveHistory({ source: 'a.srt', segs, result, reportText: 'R1' });
    expect(a.segs[0]).toEqual({ start: 0, end: 1.5, text: '喂你好', spk: 'S' });
    expect(a.summary).toMatchObject({ steps: 1, deepest: 2, dominant: '要什麼', badCount: 2 });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 10 * 60 * 1000);
    hist.saveHistory({ source: 'b.srt', segs, result, reportText: 'R2' });
    vi.useRealTimers();
    const list = hist.listHistory();
    expect(list.map((h) => h.source)).toEqual(['b.srt', 'a.srt']);
    expect(hist.getHistory(a.id).reportText).toBe('R1');
  });

  it('re-analysing the same source shortly after replaces instead of duplicating', () => {
    hist.saveHistory({ source: 'a.srt', segs, result, reportText: 'R1' });
    hist.saveHistory({ source: 'a.srt', segs, result, reportText: 'R2' });
    expect(hist.listHistory().length).toBe(1);
    expect(hist.listHistory()[0].reportText).toBe('R2');
  });

  it('saving with an existing id updates that entry', () => {
    const a = hist.saveHistory({ source: 'a.srt', segs, result, reportText: 'R1' });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 60 * 60 * 1000);
    const b = hist.saveHistory({ id: a.id, source: 'a.srt', segs, result, reportText: 'R3' });
    vi.useRealTimers();
    expect(b.id).toBe(a.id);
    expect(hist.listHistory().length).toBe(1);
    expect(hist.getHistory(a.id).reportText).toBe('R3');
  });

  it('caps the list and supports update/delete/clear', () => {
    let t = Date.now();
    for (let i = 0; i < hist.HISTORY_LIMIT + 5; i++) {
      vi.useFakeTimers();
      vi.setSystemTime((t += 5 * 60 * 1000));
      hist.saveHistory({ source: `f${i}.srt`, segs, result, reportText: `R${i}` });
      vi.useRealTimers();
    }
    const list = hist.listHistory();
    expect(list.length).toBe(hist.HISTORY_LIMIT);
    expect(list[0].source).toBe(`f${hist.HISTORY_LIMIT + 4}.srt`);
    const id = list[0].id;
    expect(hist.updateHistoryReport(id, 'NEW')).toBe(true);
    expect(hist.getHistory(id).reportText).toBe('NEW');
    hist.deleteHistory(id);
    expect(hist.getHistory(id)).toBeNull();
    hist.clearHistory();
    expect(hist.listHistory()).toEqual([]);
  });

  it('survives corrupted storage', () => {
    localStorage.setItem('callCoachHistory', '{not json');
    expect(hist.listHistory()).toEqual([]);
    hist.saveHistory({ source: 'a.srt', segs, result, reportText: 'R' });
    expect(hist.listHistory().length).toBe(1);
  });

  it('formatSavedAt is compact', () => {
    expect(hist.formatSavedAt(new Date(2026, 8, 10, 9, 5).getTime())).toBe('09/10 09:05');
  });
});
