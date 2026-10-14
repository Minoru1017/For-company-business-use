/**
 * 首頁「每位客戶的進度條」：依客戶主檔把電訪邀約、DEMO 簡報、DEMO 後複盤對起來，算出每位客戶走到哪一步。
 * 只讀 localStorage 裡已存的資料，不依賴簡報／複盤的畫面模組（首頁不必先載入它們）。
 */
import { DECKS_STORAGE_KEY } from './demo-deck.js';
import { brandOf, customersInBrand, getBrandId, inBrand } from './brands.js';
import { loadCustomers } from './customers.js';
import { followUpStatus, loadReviews, outcomeLabel, reviewHasContent, reviewMissing, todayKey } from './demo-review.js';

export const PROGRESS_STAGES = [
  { key: 'invite', label: '邀約' },
  { key: 'deck', label: '簡報' },
  { key: 'demo', label: 'DEMO' },
  { key: 'video', label: '錄影分析' },
  { key: 'review', label: '複盤' },
];

/** 簡報只取進度用得到的欄位；不做完整正規化（那要載入整個簡報模組） */
export function loadDeckBriefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(DECKS_STORAGE_KEY) || '[]');
    return (Array.isArray(raw) ? raw : [])
      .filter((d) => d && typeof d === 'object' && d.id)
      .map((d) => ({
        id: String(d.id),
        brand: brandOf(d),
        customerId: String(d.customerId || ''),
        updatedAt: Number(d.updatedAt) || 0,
        name: String(d.input?.name || '').trim() || String(d.deck?.customer || '').trim(),
        filled: Object.values(d.input || {}).some((v) => String(v || '').trim()),
        generated: !!(d.deck && Array.isArray(d.deck.slides) ? d.deck.slides.length : d.deck),
      }));
  } catch {
    return [];
  }
}

const DAY_MS = 86400000;
const parseDay = (k) => {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** 跟進日期已經過了幾天（今天或還沒到＝0） */
export function overdueDays(followUpDate, today = todayKey()) {
  if (!followUpDate) return 0;
  return Math.max(0, Math.round((parseDay(today) - parseDay(followUpDate)) / DAY_MS));
}

export const DUE_STATUSES = ['overdue', 'today', 'nodate'];

/** 首頁「今天該跟進」：已過期、今天到期、還沒填日期的客戶；過期最久的排最前面，未填日期放最後 */
export function dueFollowUps(items) {
  const rank = (c) => (c.followUp === 'nodate' ? Number.MAX_SAFE_INTEGER : -c.overdueDays);
  return (items || []).filter((c) => DUE_STATUSES.includes(c.followUp)).sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

function nextHint(stages, review) {
  // 邀約是來源紀錄，不是業務下一步要做的事；其他都走完了才提醒歸戶
  const todo = stages.find((s) => !s.done && s.key !== 'invite') || stages.find((s) => !s.done);
  if (!todo) return '';
  if (todo.key === 'invite') return '把這位客戶的電訪邀約歸戶（客戶主檔）';
  if (todo.key === 'deck') return '產生這位客戶的 DEMO 簡報';
  if (todo.key === 'demo') return 'DEMO 後填 DEMO 結果';
  if (todo.key === 'video') {
    if (review?.video?.transcribedAt) return '逐字稿已轉好，標記說話者後按「開始分析」';
    if (review?.video?.sentAt) return '到 DEMO 轉錄按「開始轉錄」';
    if (review?.video) return '把錄影送進 DEMO 轉錄分析';
    return '上傳 DEMO 錄影做轉錄分析';
  }
  const miss = review ? reviewMissing(review) : [];
  return miss.length ? `複盤還缺：${miss.join('、')}` : '補齊複盤';
}

/**
 * @param {Array} decks  loadDeckBriefs() 的結果
 * @param {Array} reviews  loadReviews() 的結果
 * @param {Array} [customers]  客戶主檔；沒有歸戶的舊紀錄仍以 deckId 湊成一位
 * @returns {Array} 每位客戶一筆：{ key, customerId, name, deckId, reviewId, stages, done, percent, next, outcome, followUp, followUpDate, updatedAt }
 *   排序：該跟進的最前面 → 進行中（最近更新優先）→ 已走完
 */
export function buildCustomerProgress(decks, reviews, today = todayKey(), customers = []) {
  const latest = (list) => [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null;
  const usedDecks = new Set();
  const usedReviews = new Set();
  const entries = [];

  (customers || []).forEach((c) => {
    const myDecks = (decks || []).filter((d) => d.customerId === c.id);
    const myReviews = (reviews || []).filter((r) => r.customerId === c.id);
    myDecks.forEach((d) => usedDecks.add(d.id));
    myReviews.forEach((r) => usedReviews.add(r.id));
    const review = latest(myReviews);
    const deck = myDecks.find((d) => d.id === review?.deckId) || latest(myDecks.filter((d) => d.generated)) || latest(myDecks);
    entries.push({ customer: c, deck, review });
  });

  // 還沒歸戶的舊紀錄：簡報與複盤依 deckId 湊成一位
  const looseDecks = (decks || []).filter((d) => !usedDecks.has(d.id));
  const looseReviews = (reviews || []).filter((r) => !usedReviews.has(r.id));
  const reviewByDeck = new Map();
  const reviewsLeft = [];
  looseReviews.forEach((r) => {
    if (r.deckId && looseDecks.some((d) => d.id === r.deckId) && !reviewByDeck.has(r.deckId)) reviewByDeck.set(r.deckId, r);
    else reviewsLeft.push(r);
  });
  looseDecks.forEach((d) => entries.push({ customer: null, deck: d, review: reviewByDeck.get(d.id) || null }));
  reviewsLeft.forEach((r) => entries.push({ customer: null, deck: null, review: r }));

  const out = [];
  entries.forEach(({ customer, deck, review }) => {
    const hasReview = !!(review && (reviewHasContent(review) || review.customer));
    const name = String(customer?.name || review?.customer || deck?.name || '').trim();
    if (!customer && !name && !deck?.filled && !hasReview) return;

    const done = {
      invite: !!customer?.invites?.length,
      deck: !!deck?.generated,
      demo: !!(review?.outcome || review?.video || review?.analysis),
      video: !!review?.analysis,
      review: !!(review && reviewHasContent(review) && !reviewMissing(review).length),
    };
    const stages = PROGRESS_STAGES.map((s) => ({ ...s, done: done[s.key] }));
    const count = stages.filter((s) => s.done).length;
    const fu = review ? followUpStatus(review, today) : '';
    out.push({
      key: customer ? `c:${customer.id}` : deck ? `d:${deck.id}` : `r:${review.id}`,
      customerId: customer?.id || '',
      name: name || '未命名客戶',
      deckId: deck?.id || '',
      reviewId: review?.id || '',
      stages,
      done: count,
      percent: Math.round((count / stages.length) * 100),
      next: nextHint(stages, review),
      outcome: review?.outcome || '',
      outcomeLabel: review?.outcome ? outcomeLabel(review.outcome) : '',
      followUp: fu,
      followUpDate: review?.followUpDate || '',
      overdueDays: fu === 'overdue' ? overdueDays(review.followUpDate, today) : 0,
      nextStep: review?.nextStep || '',
      updatedAt: Math.max(customer?.updatedAt || 0, deck?.updatedAt || 0, review?.updatedAt || 0),
    });
  });

  const rank = (c) => (DUE_STATUSES.includes(c.followUp) ? 0 : c.done < PROGRESS_STAGES.length ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

export function loadCustomerProgress(today = todayKey(), brand = getBrandId()) {
  const decks = loadDeckBriefs();
  const reviews = loadReviews();
  const customers = customersInBrand(loadCustomers(), { decks, reviews }, brand);
  return buildCustomerProgress(inBrand(decks, brand), inBrand(reviews, brand), today, customers);
}
