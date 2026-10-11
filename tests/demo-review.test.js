import { beforeEach, describe, expect, it } from 'vitest';
import { isAppKey } from '../src/backup.js';
import {
  REVIEWS_STORAGE_KEY,
  emptyReview,
  filterReviews,
  followUpStatus,
  loadReviews,
  normalizeReview,
  outcomeLabel,
  removeReview,
  reviewForDeck,
  reviewHasContent,
  reviewMissing,
  reviewStats,
  reviewToText,
  reviewsToCsv,
  saveReviews,
  upsertReview,
} from '../src/demo-review.js';

const TODAY = '2026-10-11';

function rev(over = {}) {
  return normalizeReview({ ...emptyReview({ customer: '涵小姐' }), ...over });
}

describe('demo review: normalize', () => {
  it('fills defaults and drops invalid values', () => {
    const r = normalizeReview({ customer: '  王小姐  ', outcome: 'bogus', tier: 'enjoy', fit: 'Z', followUpDate: '2026-02-31', nextStep: 'x'.repeat(500), improve: 'a'.repeat(5000) });
    expect(r.customer).toBe('王小姐');
    expect(r.outcome).toBe('');
    expect(r.tier).toBe('enjoy');
    expect(r.fit).toBe('');
    expect(r.followUpDate).toBe('');
    expect(r.nextStep).toHaveLength(300);
    expect(r.improve).toHaveLength(2000);
    expect(r.id).toMatch(/^rev_/);
  });

  it('keeps valid dates and outcomes', () => {
    const r = normalizeReview({ outcome: 'next', followUpDate: '2026-10-14', fit: 'B' });
    expect([r.outcome, r.followUpDate, r.fit]).toEqual(['next', '2026-10-14', 'B']);
  });

  it('does not count prefilled customer/demoAt as content', () => {
    expect(reviewHasContent(emptyReview({ customer: '涵小姐', demoAt: '1011 20:00' }))).toBe(false);
    expect(reviewHasContent(rev({ improve: '示範前先問' }))).toBe(true);
    expect(reviewHasContent(rev({ outcome: 'closed' }))).toBe(true);
  });
});

describe('demo review: completeness and follow-up', () => {
  it('lists what is missing', () => {
    expect(reviewMissing(rev())).toEqual(['DEMO 結果', '我做得好的', '下次要改的一件事']);
    expect(reviewMissing(rev({ outcome: 'thinking', wentWell: 'a', improve: 'b' }))).toEqual(['下一步', '跟進日期']);
    expect(reviewMissing(rev({ outcome: 'declined', wentWell: 'a', improve: 'b' }))).toEqual([]);
    expect(reviewMissing(rev({ outcome: 'next', nextStep: '週三諮詢', followUpDate: '2026-10-14', wentWell: 'a', improve: 'b' }))).toEqual([]);
  });

  it('computes follow-up status only for outcomes that need one', () => {
    expect(followUpStatus(rev({ outcome: 'closed' }), TODAY)).toBe('');
    expect(followUpStatus(rev({ outcome: 'next' }), TODAY)).toBe('nodate');
    expect(followUpStatus(rev({ outcome: 'next', followUpDate: '2026-10-10' }), TODAY)).toBe('overdue');
    expect(followUpStatus(rev({ outcome: 'thinking', followUpDate: TODAY }), TODAY)).toBe('today');
    expect(followUpStatus(rev({ outcome: 'thinking', followUpDate: '2026-10-20' }), TODAY)).toBe('upcoming');
  });

  it('labels outcomes', () => {
    expect(outcomeLabel('closed')).toBe('當場成交');
    expect(outcomeLabel('')).toBe('未填結果');
  });
});

describe('demo review: storage', () => {
  beforeEach(() => {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
  });

  it('round-trips and sorts newest first', () => {
    let list = [];
    list = upsertReview(list, rev({ customer: 'A' }), 1000).list;
    const b = upsertReview(list, rev({ customer: 'B' }), 2000);
    saveReviews(b.list);
    const loaded = loadReviews();
    expect(loaded.map((r) => r.customer)).toEqual(['B', 'A']);
  });

  it('upsert replaces by id and moves it to the front', () => {
    const a = upsertReview([], rev({ customer: 'A' }), 1000);
    const b = upsertReview(a.list, rev({ customer: 'B' }), 2000);
    const a2 = upsertReview(b.list, { ...a.review, outcome: 'closed' }, 3000);
    expect(a2.list).toHaveLength(2);
    expect(a2.list[0].id).toBe(a.review.id);
    expect(a2.list[0].outcome).toBe('closed');
    expect(a2.list[0].updatedAt).toBe(3000);
  });

  it('survives corrupt storage', () => {
    localStorage.setItem(REVIEWS_STORAGE_KEY, '{not json');
    expect(loadReviews()).toEqual([]);
    localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify([null, 5, { customer: 'ok' }]));
    expect(loadReviews().map((r) => r.customer)).toEqual(['ok']);
  });

  it('finds the review of a deck and removes by id', () => {
    const a = upsertReview([], rev({ deckId: 'deck_1' })).review;
    const list = [a];
    expect(reviewForDeck(list, 'deck_1')).toBe(a);
    expect(reviewForDeck(list, 'deck_2')).toBeNull();
    expect(reviewForDeck(list, '')).toBeNull();
    expect(removeReview(list, a.id)).toEqual([]);
  });

  it('is included in full backups', () => {
    expect(isAppKey(REVIEWS_STORAGE_KEY)).toBe(true);
  });
});

describe('demo review: filter and stats', () => {
  const list = [
    rev({ customer: '涵小姐', outcome: 'next', followUpDate: '2026-10-09', nextStep: '週三諮詢', reaction: '想看自動回覆' }),
    rev({ customer: '陳先生', outcome: 'closed', tier: 'fear', wentWell: 'a', improve: 'b' }),
    rev({ customer: '林姐', outcome: 'declined', wentWell: 'a', improve: 'b' }),
    rev({ customer: '小張' }),
  ];

  it('filters by outcome, follow-up and keyword', () => {
    expect(filterReviews(list, { outcome: 'closed' }, TODAY).map((r) => r.customer)).toEqual(['陳先生']);
    expect(filterReviews(list, { outcome: 'none' }, TODAY).map((r) => r.customer)).toEqual(['小張']);
    expect(filterReviews(list, { followUp: true }, TODAY).map((r) => r.customer)).toEqual(['涵小姐']);
    expect(filterReviews(list, { q: '自動回覆' }, TODAY).map((r) => r.customer)).toEqual(['涵小姐']);
    expect(filterReviews(list, {}, TODAY)).toHaveLength(4);
  });

  it('summarizes counts and close rate over decided reviews', () => {
    const s = reviewStats(list, TODAY);
    expect(s.total).toBe(4);
    expect(s.decided).toBe(3);
    expect(s.byOutcome).toMatchObject({ closed: 1, next: 1, declined: 1 });
    expect(s.byTier).toEqual({ fear: 1 });
    expect(s.closeRate).toBeCloseTo(1 / 3);
    expect(s.due).toBe(1);
    expect(s.incomplete).toBe(2);
    expect(reviewStats([], TODAY).closeRate).toBeNull();
  });
});

describe('demo review: export', () => {
  it('builds an Excel-safe CSV with BOM, quoting and formula guard', () => {
    const csv = reviewsToCsv([rev({ customer: '=HYPERLINK("x")', outcome: 'closed', improve: '第一行\n"第二行"' })]);
    expect(csv.startsWith('\uFEFF"客戶","DEMO 時間","結果"')).toBe(true);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"當場成交"');
    expect(csv).toContain('"第一行\n""第二行"""');
    expect(csv.trim().split('\r\n')).toHaveLength(2);
  });

  it('formats a single review as text', () => {
    const t = reviewToText(rev({ demoAt: '1011 20:00', outcome: 'next', tier: 'enjoy', fit: 'B', nextStep: '週三諮詢', followUpDate: '2026-10-14', improve: '先問最花時間的事' }));
    expect(t).toContain('【DEMO 複盤】涵小姐（1011 20:00）');
    expect(t).toContain('結果：約好下一步｜分級：爽什麼｜適配：B');
    expect(t).toContain('下一步：週三諮詢（2026-10-14 跟進）');
    expect(t).toContain('下次要改的一件事：先問最花時間的事');
    expect(t).not.toContain('其他備註');
  });
});
