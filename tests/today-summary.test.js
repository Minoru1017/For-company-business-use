import { describe, expect, it } from 'vitest';
import { commitmentLabel, latestCommitment, weekFunnel, weekStartKey } from '../src/today-summary.js';

describe('today-summary', () => {
  it('starts the week on Monday', () => {
    expect(weekStartKey('2026-10-21')).toBe('2026-10-19');
    expect(weekStartKey('2026-10-19')).toBe('2026-10-19');
    expect(weekStartKey('2026-10-25')).toBe('2026-10-19');
  });

  it("uses the most recent commitment before today, not today's own note", () => {
    const days = [
      { date: '2026-10-21', note: { action: '今天寫給明天的' } },
      { date: '2026-10-18', note: { action: '舊的' } },
      { date: '2026-10-20', note: { action: '  先問誰拍板  ', symptom: '費用卡住', verify: '問到決策者' } },
      { date: '2026-10-19', note: { action: '' } },
    ];
    expect(latestCommitment(days, '2026-10-21')).toEqual({
      date: '2026-10-20',
      action: '先問誰拍板',
      symptom: '費用卡住',
      verify: '問到決策者',
      daysAgo: 1,
    });
  });

  it('ignores commitments older than the lookback window', () => {
    expect(latestCommitment([{ date: '2026-09-01', note: { action: '太久了' } }], '2026-10-21')).toBeNull();
    expect(latestCommitment([], '2026-10-21')).toBeNull();
  });

  it('labels how long ago the commitment was written', () => {
    expect(commitmentLabel(1)).toBe('昨天你說要改的');
    expect(commitmentLabel(2)).toBe('前天你說要改的');
    expect(commitmentLabel(5)).toBe('5 天前你說要改的');
  });

  it('sums the week funnel and derives retention from connected calls', () => {
    const days = [
      { date: '2026-10-19', dialed: 10, connected: 4, invites: 1 },
      { date: '2026-10-20', dialed: 8, connected: 6, over5Manual: 2, invites: 0 },
    ];
    const summary = { '2026-10-19': { durations: [400, 100, 360] }, '2026-10-21': { durations: [900] } };
    const week = weekFunnel(days, summary, { shortMin: 5, longMin: 15 });
    expect(week).toEqual({ dialed: 18, connected: 10, over: 5, invites: 1, retention: 0.5 });
  });

  it('reports no retention when nothing connected', () => {
    expect(weekFunnel([], {}).retention).toBeNull();
  });
});
