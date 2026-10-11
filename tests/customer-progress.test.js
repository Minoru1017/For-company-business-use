import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROGRESS_STAGES, buildCustomerProgress, loadCustomerProgress, loadDeckBriefs } from '../src/customer-progress.js';
import { emptyReview, normalizeReview, saveReviews } from '../src/demo-review.js';

const TODAY = '2026-10-11';
const SUMMARY = { totalDur: 600, custRatio: 0.4, sQuestions: 5, steps: 3, deepest: 3, dominant: '', badCount: 0, goodCount: 0 };

const deck = (over = {}) => ({ id: 'd1', updatedAt: 1, name: '涵小姐', filled: true, generated: false, ...over });
const review = (over = {}) => normalizeReview({ ...emptyReview({ customer: '涵小姐', deckId: 'd1' }), ...over });
const stageKeys = (c) => c.stages.filter((s) => s.done).map((s) => s.key);

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

describe('customer progress: stages', () => {
  it('a new customer only has the first stage', () => {
    const [c] = buildCustomerProgress([deck()], [], TODAY);
    expect(stageKeys(c)).toEqual(['customer']);
    expect(c.percent).toBe(20);
    expect(c.next).toBe('產生這位客戶的 DEMO 簡報');
    expect(c.stages).toHaveLength(PROGRESS_STAGES.length);
  });

  it('a generated deck moves the bar forward and asks for DEMO result next', () => {
    const [c] = buildCustomerProgress([deck({ generated: true })], [], TODAY);
    expect(stageKeys(c)).toEqual(['customer', 'deck']);
    expect(c.next).toBe('DEMO 後填 DEMO 結果');
  });

  it('walks through video upload, transcript and analysis hints', () => {
    const d = deck({ generated: true });
    const hint = (r) => buildCustomerProgress([d], [r], TODAY)[0].next;
    const video = { name: 'a.mp4', size: 1, addedAt: 1 };
    expect(hint(review({ outcome: 'next', video }))).toBe('把錄影送進 DEMO 轉錄分析');
    expect(hint(review({ outcome: 'next', video: { ...video, sentAt: 2 } }))).toBe('到 DEMO 轉錄按「開始轉錄」');
    expect(hint(review({ outcome: 'next', video: { ...video, sentAt: 2, transcribedAt: 3 } }))).toContain('開始分析');
    expect(hint(review({ outcome: 'next' }))).toBe('上傳 DEMO 錄影做轉錄分析');
  });

  it('shows what the review is still missing, then completes', () => {
    const d = deck({ generated: true });
    const analysis = { historyId: 'h1', at: 1, summary: SUMMARY };
    const partial = buildCustomerProgress([d], [review({ outcome: 'closed', analysis })], TODAY)[0];
    expect(stageKeys(partial)).toEqual(['customer', 'deck', 'demo', 'video']);
    expect(partial.next).toContain('複盤還缺：');
    const full = buildCustomerProgress([d], [review({ outcome: 'closed', analysis, wentWell: 'a', improve: 'b' })], TODAY)[0];
    expect(full.percent).toBe(100);
    expect(full.next).toBe('');
    expect(full.outcomeLabel).toBe('當場成交');
  });
});

describe('customer progress: customers and order', () => {
  it('skips the blank starter deck but keeps review-only customers', () => {
    const blank = deck({ id: 'blank', name: '', filled: false });
    const orphan = review({ deckId: 'gone', customer: '王先生', outcome: 'declined' });
    const list = buildCustomerProgress([blank], [orphan], TODAY);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: '王先生', deckId: '', reviewId: orphan.id });
  });

  it('pairs one review with its deck instead of listing the customer twice', () => {
    const list = buildCustomerProgress([deck()], [review()], TODAY);
    expect(list).toHaveLength(1);
    expect(list[0].deckId).toBe('d1');
  });

  it('puts follow-ups first, then in-progress, then finished customers', () => {
    const finished = review({ deckId: 'd3', customer: 'C', outcome: 'closed', wentWell: 'a', improve: 'b', analysis: { historyId: 'h', at: 1, summary: SUMMARY } });
    const due = review({ deckId: 'd2', customer: 'B', outcome: 'thinking', nextStep: 'call', followUpDate: '2026-10-09' });
    const decks = [
      deck({ id: 'd1', name: 'A', updatedAt: 99 }),
      deck({ id: 'd2', name: 'B', generated: true, updatedAt: 1 }),
      deck({ id: 'd3', name: 'C', generated: true, updatedAt: 50 }),
    ];
    const list = buildCustomerProgress(decks, [finished, due], TODAY);
    expect(list.map((c) => c.name)).toEqual(['B', 'A', 'C']);
    expect(list[0].followUp).toBe('overdue');
  });
});

describe('customer progress: reading storage', () => {
  it('reads decks without loading the deck module and tolerates bad data', () => {
    expect(loadDeckBriefs()).toEqual([]);
    localStorage.setItem('call_coach_demo_decks_v1', JSON.stringify([{ id: 'd1', input: { name: '涵小姐' }, deck: { slides: [{}] }, updatedAt: 4 }, null, { nope: 1 }]));
    expect(loadDeckBriefs()).toEqual([{ id: 'd1', updatedAt: 4, name: '涵小姐', filled: true, generated: true }]);
    localStorage.setItem('call_coach_demo_decks_v1', '{bad');
    expect(loadDeckBriefs()).toEqual([]);
  });

  it('combines saved decks and reviews', () => {
    localStorage.setItem('call_coach_demo_decks_v1', JSON.stringify([{ id: 'd1', input: { name: '涵小姐' }, deck: null }]));
    saveReviews([review({ outcome: 'next', nextStep: 'x', followUpDate: '2999-01-01' })]);
    const [c] = loadCustomerProgress(TODAY);
    expect(c.name).toBe('涵小姐');
    expect(stageKeys(c)).toContain('demo');
    expect(c.followUp).toBe('upcoming');
  });
});
