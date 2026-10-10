/**
 * DEMO 簡報工作區的操作邏輯（不碰 DOM）：清單文字、鍵盤對應、頁面增刪、帶入客戶資料。
 * demo-deck-ui.js 負責畫面與事件，實際改資料的規則都在這裡。
 */
import { DECK_STYLES, hasCustomerInput, newDeckRecord, normalizeSlide, SLIDE_TYPE_LABELS } from './demo-deck.js';

export function deckLabel(rec) {
  return String(rec?.input?.name || '').trim() || rec?.deck?.customer || '未命名客戶';
}

/** 左側清單第二行：DEMO 時間 · 頁數（範本產生的加註） */
export function deckListMeta(rec) {
  const pages = rec?.deck ? `${rec.deck.slides.length} 頁${rec.source === 'template' ? '・範本' : ''}` : '尚未產生';
  return [String(rec?.input?.demoAt || '').trim(), pages].filter(Boolean).join(' · ');
}

/** 「開啟簡報編輯器」卡片上的說明：頁數 · 風格 */
export function deckOpenMeta(rec) {
  if (!rec?.deck) return '';
  const style = DECK_STYLES.find((x) => x.key === rec.deck.theme?.style)?.label || DECK_STYLES[0].label;
  return `${rec.deck.slides.length} 頁 · ${style}${rec.source === 'template' ? ' · 範本' : ''}`;
}

export function clampSlideIndex(i, count) {
  if (!count) return 0;
  return Math.min(Math.max(0, i), count - 1);
}

const PRESENT_KEYS = {
  ArrowRight: 'next',
  PageDown: 'next',
  ' ': 'next',
  Enter: 'next',
  ArrowLeft: 'prev',
  PageUp: 'prev',
  Backspace: 'prev',
  Home: 'first',
  End: 'last',
  n: 'notes',
  N: 'notes',
  Escape: 'exit',
};

const EDITOR_KEYS = {
  ArrowRight: 'next',
  PageDown: 'next',
  ArrowLeft: 'prev',
  PageUp: 'prev',
  f: 'maximize',
  F: 'maximize',
  Escape: 'close',
};

/** 全螢幕簡報模式的按鍵 → 動作；不處理的鍵回傳 null（讓瀏覽器照常處理） */
export function presentKeyAction(key) {
  return PRESENT_KEYS[key] || null;
}

/** 編輯器視窗（非輸入框焦點、沒按修飾鍵時）的按鍵 → 動作 */
export function editorKeyAction(key, { typing = false, modifier = false } = {}) {
  if (typing || modifier) return null;
  return EDITOR_KEYS[key] || null;
}

/** 把動作換成新的頁碼；不是換頁的動作回傳 null */
export function slideIndexAfter(action, idx, count) {
  if (action === 'next') return clampSlideIndex(idx + 1, count);
  if (action === 'prev') return clampSlideIndex(idx - 1, count);
  if (action === 'first') return 0;
  if (action === 'last') return clampSlideIndex(count - 1, count);
  return null;
}

/** 複製目前這頁並插在後面（新頁換新 id），回傳新頁的位置 */
export function duplicateSlide(deck, idx) {
  const copy = normalizeSlide({ ...JSON.parse(JSON.stringify(deck.slides[idx])), id: '' });
  deck.slides.splice(idx + 1, 0, copy);
  return idx + 1;
}

/** 刪除前的確認文字；只剩一頁時回傳 { blocked } 不能刪 */
export function deleteSlidePrompt(deck, idx) {
  if (deck.slides.length <= 1) return { blocked: '至少要留一頁' };
  const s = deck.slides[idx];
  return { confirm: `刪除第 ${idx + 1} 頁「${s.title || SLIDE_TYPE_LABELS[s.type]}」？` };
}

/** 編輯投影片文字後寫回資料前的清理：最多保留一個空行 */
export function cleanEditedText(text) {
  return String(text || '').replace(/\n{3,}/g, '\n\n').trim();
}

/** 從自寫複盤帶入時接在「開發紀錄」原文後面 */
export function appendRawNote(raw, text) {
  return [String(raw || '').trim(), text].filter(Boolean).join('\n\n');
}

/**
 * 從其他模式帶入客戶資料開新簡報：只收已知欄位的字串，並移除還沒填任何東西的空白簡報。
 * @returns {{ rec, decks }} 新紀錄與新的清單（新紀錄在最前面）
 */
export function addDeckFromInput(decks, input = {}, { source = 'call' } = {}) {
  const rec = newDeckRecord();
  Object.keys(rec.input).forEach((k) => {
    if (typeof input[k] === 'string') rec.input[k] = input[k];
  });
  rec.source = source;
  const kept = (decks || []).filter((d) => d.deck || hasCustomerInput(d.input));
  return { rec, decks: [rec, ...kept] };
}
