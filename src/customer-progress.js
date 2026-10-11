/**
 * 首頁「每位客戶的進度條」：把 DEMO 簡報與 DEMO 後複盤對起來，算出每位客戶走到哪一步。
 * 只讀 localStorage 裡已存的資料，不依賴簡報／複盤的畫面模組（首頁不必先載入它們）。
 */
import { DECKS_STORAGE_KEY } from './demo-deck.js';
import { followUpStatus, loadReviews, outcomeLabel, reviewHasContent, reviewMissing, todayKey } from './demo-review.js';

export const PROGRESS_STAGES = [
  { key: 'customer', label: '建客戶' },
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
        updatedAt: Number(d.updatedAt) || 0,
        name: String(d.input?.name || '').trim() || String(d.deck?.customer || '').trim(),
        filled: Object.values(d.input || {}).some((v) => String(v || '').trim()),
        generated: !!(d.deck && Array.isArray(d.deck.slides) ? d.deck.slides.length : d.deck),
      }));
  } catch {
    return [];
  }
}

function nextHint(stages, review) {
  const todo = stages.find((s) => !s.done);
  if (!todo) return '';
  if (todo.key === 'customer') return '先填客戶資料';
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
 * @returns {Array} 每位客戶一筆：{ key, name, deckId, reviewId, stages, done, percent, next, outcome, followUp, followUpDate, updatedAt }
 *   排序：該跟進的最前面 → 進行中（最近更新優先）→ 已走完
 */
export function buildCustomerProgress(decks, reviews, today = todayKey()) {
  const reviewByDeck = new Map();
  const reviewsLeft = [];
  (reviews || []).forEach((r) => {
    if (r.deckId && (decks || []).some((d) => d.id === r.deckId) && !reviewByDeck.has(r.deckId)) reviewByDeck.set(r.deckId, r);
    else reviewsLeft.push(r);
  });

  const entries = [];
  (decks || []).forEach((d) => entries.push({ deck: d, review: reviewByDeck.get(d.id) || null }));
  reviewsLeft.forEach((r) => entries.push({ deck: null, review: r }));

  const out = [];
  entries.forEach(({ deck, review }) => {
    const hasReview = !!(review && (reviewHasContent(review) || review.customer));
    const name = String(review?.customer || deck?.name || '').trim();
    if (!name && !deck?.filled && !hasReview) return;

    const done = {
      customer: !!name || !!deck?.filled || hasReview,
      deck: !!deck?.generated,
      demo: !!(review?.outcome || review?.video || review?.analysis),
      video: !!review?.analysis,
      review: !!(review && reviewHasContent(review) && !reviewMissing(review).length),
    };
    const stages = PROGRESS_STAGES.map((s) => ({ ...s, done: done[s.key] }));
    const count = stages.filter((s) => s.done).length;
    const fu = review ? followUpStatus(review, today) : '';
    out.push({
      key: deck ? `d:${deck.id}` : `r:${review.id}`,
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
      updatedAt: Math.max(deck?.updatedAt || 0, review?.updatedAt || 0),
    });
  });

  const rank = (c) => (['overdue', 'today', 'nodate'].includes(c.followUp) ? 0 : c.done < PROGRESS_STAGES.length ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt);
}

export function loadCustomerProgress(today = todayKey()) {
  return buildCustomerProgress(loadDeckBriefs(), loadReviews(), today);
}
