import { beforeAll, describe, expect, it } from 'vitest';

let mod;

beforeAll(async () => {
  const m = new Map();
  globalThis.localStorage ??= {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
  mod = await import('../src/wait-progress.js');
});

const base = {
  percent: 42,
  phase_label: '本機辨識與分軌',
  phase_states: [
    { key: 'extract', label: '抽出音軌', state: 'done' },
    { key: 'transcribe', label: '本機辨識與分軌', state: 'active' },
    { key: 'save', label: '寫入逐字稿', state: 'pending' },
  ],
  detail: '語音辨識',
  elapsed_s: 125,
  duration_s: 2880,
  eta_remaining_low_s: 600,
  eta_remaining_high_s: 1200,
  overdue: false,
  done: false,
};

describe('formatDuration / formatEtaRange', () => {
  it('formats seconds, minutes and hours', () => {
    expect(mod.formatDuration(45)).toBe('45 秒');
    expect(mod.formatDuration(125)).toBe('2 分 5 秒');
    expect(mod.formatDuration(15 * 60)).toBe('15 分');
    expect(mod.formatDuration(3600 + 300)).toBe('1 小時 5 分');
    expect(mod.formatDuration(7200)).toBe('2 小時');
  });

  it('formats eta ranges in whole minutes', () => {
    expect(mod.formatEtaRange(600, 1200)).toBe('約 10～20 分鐘');
    expect(mod.formatEtaRange(50, 50)).toBe('不到 1 分鐘');
    expect(mod.formatEtaRange(0, 0)).toBe('應該快完成了');
    expect(mod.formatEtaRange(null, null)).toBe('');
    expect(mod.formatEtaRange(590, 600)).toBe('約 10 分鐘');
  });
});

describe('finishWindow / waitSummary / progressTitle', () => {
  const now = new Date(2026, 8, 10, 14, 0, 0).getTime();

  it('computes finish window from remaining eta', () => {
    expect(mod.finishWindow(now, 600, 1200)).toBe('預計 14:10～14:20 完成');
    expect(mod.finishWindow(now, 60, 60)).toBe('預計 14:01 完成');
    expect(mod.finishWindow(now, null, null)).toBe('');
  });

  it('summarises running / overdue / done states', () => {
    expect(mod.waitSummary(base, now)).toBe('本機辨識與分軌・還需約 10～20 分鐘・預計 14:10～14:20 完成');
    expect(mod.waitSummary({ ...base, overdue: true }, now)).toContain('已超過預估時間');
    expect(mod.waitSummary({ ...base, done: true, ok: true }, now)).toBe('轉錄完成');
    expect(mod.waitSummary(null)).toBe('');
  });

  it('prefixes tab title with percent while running only', () => {
    expect(mod.progressTitle(base, 'CALL COACH')).toBe('⏳ 42%・本機辨識與分軌 — CALL COACH');
    expect(mod.progressTitle({ ...base, done: true }, 'CALL COACH')).toBe('CALL COACH');
    expect(mod.progressTitle(null, 'CALL COACH')).toBe('CALL COACH');
  });
});

describe('renderProgressHtml', () => {
  it('renders steps, bar and eta', () => {
    const html = mod.renderProgressHtml(base, { now: new Date(2026, 8, 10, 14, 0).getTime() });
    expect(html).toContain('wait-step done');
    expect(html).toContain('wait-step active');
    expect(html).toContain('wait-step pending');
    expect(html).toContain('width:42%');
    expect(html).toContain('還需約 10～20 分鐘');
    expect(html).toContain('預計 14:10～14:20 完成');
    expect(html).toContain('音訊 48 分');
    expect(html).toContain('語音辨識');
  });

  it('escapes html and handles cancel / overdue', () => {
    const html = mod.renderProgressHtml({ ...base, detail: '<img src=x>' });
    expect(html).not.toContain('<img');
    expect(mod.renderProgressHtml(base, { cancelRequested: true })).toContain('正在停止');
    expect(mod.renderProgressHtml({ ...base, overdue: true })).toContain('不必重來');
    expect(mod.renderProgressHtml(null)).toBe('');
  });
});

describe('notify preference', () => {
  it('persists toggle in localStorage', () => {
    expect(mod.notifyEnabled()).toBe(false);
    mod.setNotifyEnabled(true);
    expect(mod.notifyEnabled()).toBe(true);
    mod.setNotifyEnabled(false);
    expect(mod.notifyEnabled()).toBe(false);
  });

  it('notifyJobDone is a no-op when disabled', () => {
    mod.setNotifyEnabled(false);
    expect(mod.notifyJobDone({ title: 'x', body: 'y' })).toBe(false);
  });
});
