/**
 * DEMO 後複盤建檔：每場 DEMO 結束後把結果、客戶反應、疑慮、下一步記成一筆檔案，
 * 之後可以篩選、追蹤待跟進、匯出 CSV。資料只存本機 localStorage（會跟著「全部備份」一起走）。
 */
import { PURPOSE_TYPES } from './purpose-types.js';
import { consultToText, normalizeConsult } from './demo-review-consult.js';
import { guideToText, normalizeDemoGuide } from './demo-review-guide.js';

export const REVIEWS_STORAGE_KEY = 'call_coach_demo_reviews_v1';

export const OUTCOMES = [
  { key: 'closed', label: '當場成交', tone: 'ok', followUp: false },
  { key: 'next', label: '約好下一步', tone: 'ok', followUp: true },
  { key: 'thinking', label: '客戶考慮中', tone: 'warn', followUp: true },
  { key: 'notfit', label: '判斷不適合', tone: 'muted', followUp: false },
  { key: 'declined', label: '客戶婉拒', tone: 'bad', followUp: false },
];

export const FITS = ['A', 'B', 'C'];

export const TIER_OPTIONS = PURPOSE_TYPES.map((t) => ({ key: t.key, label: t.label }));

/** 表單文字欄位（順序＝畫面順序） */
export const REVIEW_TEXT_FIELDS = [
  { key: 'reaction', label: '客戶最有反應的地方', placeholder: '哪一頁／哪句話他眼睛一亮、主動追問或點頭？（盡量寫原話）', rows: 2 },
  { key: 'objections', label: '客戶的疑慮，以及我怎麼回', placeholder: '例：「我怕學不會」→ 我先接住，再問他之前卡在哪；他後來說…', rows: 3 },
  { key: 'newInfo', label: '這場新問出來的資訊', placeholder: '電話裡沒問到、DEMO 才透露的需求、預算、時間、決策人…', rows: 2 },
  { key: 'wentWell', label: '我做得好的', placeholder: '至少一件具體的事（例如：開場念他的原話，他主動補充了）', rows: 2 },
  { key: 'improve', label: '下次要改的一件事', placeholder: '只寫一件、可以直接動手改的（例如：示範前先問他最花時間的事）', rows: 2 },
  { key: 'note', label: '其他備註', placeholder: '', rows: 2 },
];

const TEXT_LIMIT = 2000;
const SHORT_LIMIT = 80;

const outcomeByKey = Object.fromEntries(OUTCOMES.map((o) => [o.key, o]));

export function outcomeLabel(key) {
  return outcomeByKey[key]?.label || '未填結果';
}

export function tierLabel(key) {
  return TIER_OPTIONS.find((t) => t.key === key)?.label || '';
}

function rid() {
  return `rev_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function clip(v, n) {
  return String(v ?? '').trim().slice(0, n);
}

function validDate(v) {
  const s = String(v || '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? s : '';
}

export function emptyReview({ deckId = '', customerId = '', customer = '', demoAt = '' } = {}) {
  const now = Date.now();
  return {
    id: rid(),
    deckId,
    customerId: clip(customerId, 60),
    createdAt: now,
    updatedAt: now,
    customer: clip(customer, SHORT_LIMIT),
    demoAt: clip(demoAt, 40),
    outcome: '',
    tier: '',
    fit: '',
    nextStep: '',
    followUpDate: '',
    video: null,
    analysis: null,
    consult: null,
    demoGuide: null,
    ...Object.fromEntries(REVIEW_TEXT_FIELDS.map((f) => [f.key, ''])),
  };
}

const ts = (v) => (Number(v) > 0 ? Number(v) : 0);

/** DEMO 錄影只記檔名與大小（影片本身不存瀏覽器） */
function normalizeVideo(v) {
  const name = clip(v?.name, 200);
  if (!name) return null;
  return {
    name,
    bridgeName: clip(v.bridgeName, 200),
    size: Math.max(0, Number(v.size) || 0),
    addedAt: ts(v.addedAt),
    sentAt: ts(v.sentAt),
    transcribedAt: ts(v.transcribedAt),
  };
}

/** 轉錄分析的結果摘要：只留數字與一個標籤，完整分析在「最近分析」裡 */
function normalizeAnalysis(a) {
  const historyId = clip(a?.historyId, 80);
  if (!historyId) return null;
  const s = a.summary && typeof a.summary === 'object' ? a.summary : {};
  const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : 0);
  return {
    historyId,
    at: ts(a.at),
    summary: {
      totalDur: num(s.totalDur),
      custRatio: num(s.custRatio),
      sQuestions: num(s.sQuestions),
      steps: num(s.steps),
      deepest: num(s.deepest),
      dominant: clip(s.dominant, 40),
      badCount: num(s.badCount),
      goodCount: num(s.goodCount),
    },
  };
}

/** 讀進來或使用者輸入後，補齊欄位並把不合法的值清掉 */
export function normalizeReview(r = {}) {
  const base = emptyReview();
  const out = { ...base, ...r };
  out.id = clip(r.id, 60) || base.id;
  out.deckId = clip(r.deckId, 60);
  out.customerId = clip(r.customerId, 60);
  out.customer = clip(out.customer, SHORT_LIMIT);
  out.demoAt = clip(out.demoAt, 40);
  out.outcome = outcomeByKey[out.outcome] ? out.outcome : '';
  out.tier = TIER_OPTIONS.some((t) => t.key === out.tier) ? out.tier : '';
  out.fit = FITS.includes(out.fit) ? out.fit : '';
  out.nextStep = clip(out.nextStep, 300);
  out.followUpDate = validDate(out.followUpDate);
  out.video = normalizeVideo(r.video);
  out.analysis = normalizeAnalysis(r.analysis);
  out.consult = normalizeConsult(r.consult);
  out.demoGuide = normalizeDemoGuide(r.demoGuide);
  REVIEW_TEXT_FIELDS.forEach((f) => {
    out[f.key] = clip(out[f.key], TEXT_LIMIT);
  });
  out.createdAt = Number(r.createdAt) || base.createdAt;
  out.updatedAt = Number(r.updatedAt) || out.createdAt;
  return out;
}

/** 有沒有填過任何東西（客戶名、DEMO 時間是從簡報帶入的，不算） */
export function reviewHasContent(r) {
  if (!r) return false;
  return (
    !!(r.outcome || r.tier || r.fit || r.nextStep || r.followUpDate || r.video || r.analysis || r.consult || r.demoGuide) ||
    REVIEW_TEXT_FIELDS.some((f) => String(r[f.key] || '').trim())
  );
}

/** 建檔還缺什麼（空陣列＝完整） */
export function reviewMissing(r) {
  const missing = [];
  if (!r?.outcome) missing.push('DEMO 結果');
  if (outcomeByKey[r?.outcome]?.followUp) {
    if (!String(r.nextStep || '').trim()) missing.push('下一步');
    if (!r.followUpDate) missing.push('跟進日期');
  }
  if (!String(r?.wentWell || '').trim()) missing.push('我做得好的');
  if (!String(r?.improve || '').trim()) missing.push('下次要改的一件事');
  return missing;
}

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 需要跟進的檔案（約下一步／考慮中）才有狀態：overdue 已過期、today 今天、upcoming 之後、nodate 還沒填日期 */
export function followUpStatus(r, today = todayKey()) {
  if (!outcomeByKey[r?.outcome]?.followUp) return '';
  if (!r.followUpDate) return 'nodate';
  if (r.followUpDate < today) return 'overdue';
  return r.followUpDate === today ? 'today' : 'upcoming';
}

/* ---- 儲存 ---- */

export function loadReviews() {
  try {
    const raw = JSON.parse(localStorage.getItem(REVIEWS_STORAGE_KEY) || '[]');
    return (Array.isArray(raw) ? raw : [])
      .filter((r) => r && typeof r === 'object')
      .map(normalizeReview)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function saveReviews(list) {
  localStorage.setItem(REVIEWS_STORAGE_KEY, JSON.stringify(list || []));
}

export function reviewForDeck(list, deckId) {
  return deckId ? (list || []).find((r) => r.deckId === deckId) || null : null;
}

/** 新增或更新一筆（以 id 認），回傳新清單（最近更新的在最前面） */
export function upsertReview(list, review, now = Date.now()) {
  const next = normalizeReview({ ...review, updatedAt: now });
  const rest = (list || []).filter((r) => r.id !== next.id);
  return { review: next, list: [next, ...rest] };
}

export function removeReview(list, id) {
  return (list || []).filter((r) => r.id !== id);
}

/* ---- DEMO 錄影 ↔ 轉錄分析 ---- */

export const REVIEWS_CHANGED_EVENT = 'callcoach:reviews-changed';

/** 影片檔名與轉錄出來的逐字稿名稱要能對上：忽略副檔名、大小寫、空白與符號（助手可能改過檔名） */
export function videoKey(name) {
  return String(name || '')
    .normalize('NFC')
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function videoFromFile(file, now = Date.now()) {
  return normalizeVideo({ name: file?.name, size: file?.size, addedAt: now });
}

const PENDING_KEY = 'call_coach_pending_review';

/** 剛從哪一筆複盤送出錄影（同名檔如 demo.mp4 有好幾筆時，轉錄結果優先回填這一筆）；只留在這個分頁 */
export function setPendingReview(id) {
  try {
    if (id) sessionStorage.setItem(PENDING_KEY, id);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

export function getPendingReview() {
  try {
    return sessionStorage.getItem(PENDING_KEY) || '';
  } catch {
    return '';
  }
}

/**
 * 逐字稿來源名稱對應到哪一筆複盤。比對原檔名與助手實際存下的檔名；
 * 有多筆符合時：指定的 preferId → 最近送出錄影的 → 最近更新的。
 */
export function matchReviewByVideo(list, source, preferId = '') {
  const key = videoKey(source);
  if (!key) return null;
  const hits = (list || []).filter((r) => r.video && (videoKey(r.video.name) === key || (r.video.bridgeName && videoKey(r.video.bridgeName) === key)));
  return (
    hits.find((r) => preferId && r.id === preferId) ||
    hits.sort((a, b) => (b.video.sentAt || 0) - (a.video.sentAt || 0) || b.updatedAt - a.updatedAt)[0] ||
    null
  );
}

/** 影片轉成逐字稿了：只在複盤還沒記過時補上時間，回傳新清單；沒有對應複盤回傳 null */
export function linkTranscript(list, source, now = Date.now(), preferId = '') {
  const hit = matchReviewByVideo(list, source, preferId);
  if (!hit) return null;
  if (hit.video.transcribedAt) return { review: hit, list, changed: false };
  return { ...upsertReview(list, { ...hit, video: { ...hit.video, transcribedAt: now } }, now), changed: true };
}

/** 逐字稿分析完了：把結果摘要與「最近分析」的 id 掛回對應複盤 */
export function linkAnalysis(list, source, { historyId, summary } = {}, now = Date.now(), preferId = '') {
  const hit = matchReviewByVideo(list, source, preferId);
  if (!hit || !historyId) return null;
  return upsertReview(
    list,
    {
      ...hit,
      video: { ...hit.video, transcribedAt: hit.video.transcribedAt || now },
      analysis: { historyId, at: now, summary },
    },
    now
  );
}

function persistLink(result) {
  if (!result) return null;
  saveReviews(result.list);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(REVIEWS_CHANGED_EVENT));
  return result.review;
}

/** 以下兩個直接讀寫 localStorage，給 app.js 在轉錄／分析完成時呼叫 */
export function linkTranscriptToReview(source) {
  try {
    const r = linkTranscript(loadReviews(), source, Date.now(), getPendingReview());
    return r?.changed ? persistLink(r) : null;
  } catch {
    return null;
  }
}

export function linkAnalysisToReview(source, info) {
  try {
    const review = persistLink(linkAnalysis(loadReviews(), source, info, Date.now(), getPendingReview()));
    if (review && review.id === getPendingReview()) setPendingReview('');
    return review;
  } catch {
    return null;
  }
}

/** 其他地方（app.js）改過複盤後，把連結欄位合併進畫面上還沒存檔的清單，避免互相覆蓋 */
export function mergeLinkFields(current, fresh) {
  const byId = new Map((fresh || []).map((r) => [r.id, r]));
  const merged = (current || []).map((r) => {
    const f = byId.get(r.id);
    return f ? { ...r, video: f.video, analysis: f.analysis, updatedAt: Math.max(r.updatedAt, f.updatedAt) } : r;
  });
  const known = new Set(merged.map((r) => r.id));
  return [...merged, ...(fresh || []).filter((r) => !known.has(r.id))].sort((a, b) => b.updatedAt - a.updatedAt);
}

export function formatAnalysisSummary(s) {
  if (!s) return '';
  const parts = [];
  if (s.totalDur) parts.push(`通話 ${Math.max(1, Math.round(s.totalDur / 60))} 分`);
  parts.push(`客戶說話 ${Math.round(s.custRatio * 100)}%`);
  parts.push(`顧問提問 ${s.sQuestions} 題`);
  parts.push(`五層資訊到 L${s.deepest || 0}`);
  if (s.dominant) parts.push(`客戶偏向「${s.dominant}」`);
  return parts.join(' · ');
}

/* ---- 篩選與統計 ---- */

/**
 * @param {object} filter
 * @param {string} [filter.outcome]  結果 key；'none' 表示還沒填結果
 * @param {boolean} [filter.followUp]  只看需要跟進的
 * @param {string} [filter.q]  客戶名／各文字欄位的關鍵字
 */
export function filterReviews(list, { outcome = '', followUp = false, q = '' } = {}, today = todayKey()) {
  const needle = String(q || '').trim().toLowerCase();
  return (list || []).filter((r) => {
    if (outcome === 'none' ? r.outcome : outcome && r.outcome !== outcome) return false;
    if (followUp && !['overdue', 'today', 'nodate'].includes(followUpStatus(r, today))) return false;
    if (needle) {
      const hay = [r.customer, r.demoAt, r.nextStep, ...REVIEW_TEXT_FIELDS.map((f) => r[f.key])].join('\n').toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
}

export function reviewStats(list, today = todayKey()) {
  const byOutcome = Object.fromEntries(OUTCOMES.map((o) => [o.key, 0]));
  const byTier = {};
  let decided = 0;
  let due = 0;
  let incomplete = 0;
  (list || []).forEach((r) => {
    if (r.outcome) {
      byOutcome[r.outcome] += 1;
      decided += 1;
    }
    if (r.tier) byTier[r.tier] = (byTier[r.tier] || 0) + 1;
    if (['overdue', 'today', 'nodate'].includes(followUpStatus(r, today))) due += 1;
    if (reviewMissing(r).length) incomplete += 1;
  });
  return {
    total: (list || []).length,
    decided,
    byOutcome,
    byTier,
    /** 當場成交占「已填結果」的比例；沒有資料回 null */
    closeRate: decided ? byOutcome.closed / decided : null,
    due,
    incomplete,
  };
}

/* ---- 匯出 ---- */

const CSV_COLUMNS = [
  ['客戶', (r) => r.customer],
  ['DEMO 時間', (r) => r.demoAt],
  ['結果', (r) => outcomeLabel(r.outcome)],
  ['客戶分級', (r) => tierLabel(r.tier)],
  ['適配', (r) => r.fit],
  ['下一步', (r) => r.nextStep],
  ['跟進日期', (r) => r.followUpDate],
  ['DEMO 錄影', (r) => r.video?.name || ''],
  ['錄影分析', (r) => formatAnalysisSummary(r.analysis?.summary)],
  ['顧問診斷', (r) => r.consult?.diagnosis?.recommendation || ''],
  ['下次必問', (r) => (r.consult?.gaps || []).map((x) => x.question).filter(Boolean).join('｜')],
  ['AI 落地驗收', (r) => r.consult?.implementation?.acceptance || ''],
  ['DEMO 已驗證', (r) => (r.demoGuide?.routes || []).filter((x) => x.result === 'confirmed').map((x) => x.title).join('｜')],
  ...REVIEW_TEXT_FIELDS.map((f) => [f.label, (r) => r[f.key]]),
  ['建檔時間', (r) => new Date(r.createdAt).toISOString().slice(0, 16).replace('T', ' ')],
];

/** CSV 欄位：加引號並跳脫；開頭是 = + - @ 的字串前面補單引號，避免被 Excel 當公式執行 */
function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function reviewsToCsv(list) {
  const rows = [CSV_COLUMNS.map(([h]) => csvCell(h)).join(',')];
  (list || []).forEach((r) => rows.push(CSV_COLUMNS.map(([, get]) => csvCell(get(r))).join(',')));
  return `\uFEFF${rows.join('\r\n')}\r\n`;
}

export function reviewFileName(today = todayKey()) {
  return `DEMO複盤檔案_${today}.csv`;
}

/** 單筆純文字（貼給主管或同事討論用） */
export function reviewToText(r) {
  const lines = [`【DEMO 複盤】${r.customer || '未命名客戶'}${r.demoAt ? `（${r.demoAt}）` : ''}`];
  lines.push(`結果：${outcomeLabel(r.outcome)}${r.tier ? `｜分級：${tierLabel(r.tier)}` : ''}${r.fit ? `｜適配：${r.fit}` : ''}`);
  if (r.nextStep || r.followUpDate) lines.push(`下一步：${r.nextStep || '（未填）'}${r.followUpDate ? `（${r.followUpDate} 跟進）` : ''}`);
  if (r.analysis) lines.push(`錄影分析：${formatAnalysisSummary(r.analysis.summary)}`);
  REVIEW_TEXT_FIELDS.forEach((f) => {
    if (r[f.key]) lines.push(`${f.label}：${r[f.key]}`);
  });
  const consultText = consultToText(r.consult);
  if (consultText) lines.push('', consultText);
  const guideText = guideToText(r.demoGuide, 'internal');
  if (guideText) lines.push('', guideText);
  return lines.join('\n');
}
