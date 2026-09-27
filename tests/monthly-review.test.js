import { describe, expect, it } from 'vitest';
import {
  buildMonthlyStatsHint,
  getMonthlyReviewFromSettings,
  monthlyReviewFilled,
  patchMonthlyReviews,
  q4Label,
  reviewMonthKey,
} from '../src/monthly-review.js';

describe('monthly-review', () => {
  it('month key and dynamic q4', () => {
    expect(reviewMonthKey(2026, 9)).toBe('2026-09');
    expect(q4Label(2026, 9)).toContain('10 月');
  });

  it('persists in settings bag', () => {
    const bag = patchMonthlyReviews({}, 2026, 9, { q1: 'test time spent here ok' });
    const r = getMonthlyReviewFromSettings({ monthlyReviews: bag }, 2026, 9);
    expect(r.q1).toContain('test time');
  });

  it('filled when all four answered', () => {
    const r = { q1: '12345678', q2: '12345678', q3: '12345678', q4: '12345678' };
    expect(monthlyReviewFilled(r)).toBe(true);
    expect(monthlyReviewFilled({ ...r, q2: '短' })).toBe(false);
  });

  it('stats hint', () => {
    expect(buildMonthlyStatsHint({ analyzedCalls: 5, totalTalkMin: 40, daysWithNotes: 2, topSymptoms: ['early_hangup'] })).toContain('5 通');
  });
});
