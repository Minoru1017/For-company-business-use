/**
 * 顧問式 DEMO P1 的純函式：
 * 1) 從 P0 診斷產生最多三段「待驗證路線」
 * 2) 保存每段現場證據
 * 3) 根據驗證結果整理阻力與內／外兩種決策卡
 * 4) 逐字稿客戶句 × 假設的選擇題比對（AI 只回選項，原話與時間取自本機逐字稿）
 */
import { consultToText } from './demo-review-consult.js';

const MAX_TEXT = 1200;
const MAX_SHORT = 300;
const ROUTE_RESULTS = new Set(['pending', 'confirmed', 'revise', 'rejected']);
const REACTIONS = new Set(['none', 'inquiry', 'agreed', 'hesitant', 'objection']);
const RESISTANCE_CATEGORIES = new Set(['outcome', 'self', 'process', 'authority', 'timing', 'price', 'fit', 'none']);
const QUOTE_STANCES = new Set(['support', 'revise', 'reject']);
const QUOTE_CONFIDENCE = { high: 3, medium: 2, low: 1 };
const RESISTANCE_STATUS = new Set(['unconfirmed', 'confirmed', 'rejected']);
const EXTERNAL_FORBIDDEN_RE =
  /(?:^|[\s：:，,。；;])(?:A\s*高度適合|B\s*部分適合|C\s*不適合)|成交機率|業務評分|AI\s*可信度|客戶分級|[要怕想愛爽]什麼/u;

const clip = (v, n = MAX_SHORT) => String(v ?? '').trim().slice(0, n);

function stripFence(raw) {
  return String(raw || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function parseObject(raw) {
  const text = stripFence(raw);
  try {
    return JSON.parse(text);
  } catch {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(text.slice(a, b + 1));
      } catch {
        /* handled below */
      }
    }
  }
  throw new Error('AI 回傳格式不是 JSON，請再試一次');
}

function list(value, max = 6, itemMax = MAX_TEXT) {
  return (Array.isArray(value) ? value : []).map((x) => clip(x, itemMax)).filter(Boolean).slice(0, max);
}

/** 客戶版採內容防線：即使模型沒遵守 prompt，含內部標籤的整欄也不顯示。 */
function externalText(value) {
  const text = clip(value, MAX_TEXT);
  return EXTERNAL_FORBIDDEN_RE.test(text) ? '' : text;
}

function routeId(value, i) {
  const id = clip(value, 40).replace(/[^\w-]/g, '');
  return id || `route_${i + 1}`;
}

function normalizeRoute(value, i) {
  const r = value && typeof value === 'object' ? value : {};
  return {
    id: routeId(r.id, i),
    title: clip(r.title, 80),
    customerQuote: clip(r.customerQuote, MAX_TEXT),
    hypothesis: clip(r.hypothesis, MAX_TEXT),
    demo: clip(r.demo, MAX_TEXT),
    beforeQuestion: clip(r.beforeQuestion, MAX_TEXT),
    signals: list(r.signals, 5),
    afterQuestion: clip(r.afterQuestion, MAX_TEXT),
    stopCondition: clip(r.stopCondition, MAX_TEXT),
    avoid: clip(r.avoid, MAX_TEXT),
    result: ROUTE_RESULTS.has(r.result) ? r.result : 'pending',
    reaction: REACTIONS.has(r.reaction) ? r.reaction : 'none',
    observedQuote: clip(r.observedQuote, MAX_TEXT),
    quoteAt: quoteTime(r.quoteAt),
    note: clip(r.note, MAX_TEXT),
    matches: normalizeMatches(r.matches),
  };
}

function normalizeMatches(value) {
  return (Array.isArray(value) ? value : [])
    .map((m) => ({
      index: Math.max(0, Math.floor(Number(m?.index) || 0)),
      start: quoteTime(m?.start),
      text: clip(m?.text, MAX_SHORT),
      stance: QUOTE_STANCES.has(m?.stance) ? m.stance : '',
      confidence: QUOTE_CONFIDENCE[m?.confidence] ? m.confidence : 'low',
    }))
    .filter((m) => m.text && m.stance && m.start != null)
    .slice(0, 3);
}

function quoteTime(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null;
}

/** 秒數 → 「32:18」或「1:02:05」 */
export function formatClock(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 「32:18」「1:02:05」「95」→ 秒數；格式不對回 null */
export function parseClock(text) {
  const t = String(text || '').trim().replace(/：/g, ':');
  if (!t) return null;
  if (!/^\d+(?::[0-5]?\d){0,2}$/.test(t)) return null;
  return t.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

function grams(text) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

/**
 * 從逐字稿找客戶說過、最接近 query 的句子（字元雙字組重疊）。
 * query 空白時回傳最長的幾句客戶發言，方便業務直接挑。
 * @returns {{index:number, start:number, text:string, score:number}[]}
 */
export function findQuoteMoments(segs, query, { limit = 6 } = {}) {
  const customer = (Array.isArray(segs) ? segs : [])
    .map((s, index) => ({ index, start: Number(s?.start) || 0, text: String(s?.text || '').trim(), spk: s?.spk }))
    .filter((s) => s.spk === 'C' && s.text);
  const q = grams(query);
  if (!q.size) {
    return customer
      .filter((s) => s.text.length >= 8)
      .sort((a, b) => b.text.length - a.text.length)
      .slice(0, limit)
      .sort((a, b) => a.start - b.start)
      .map(({ index, start, text }) => ({ index, start, text, score: 0 }));
  }
  return customer
    .map((s) => {
      const g = grams(s.text);
      let hit = 0;
      q.forEach((x) => g.has(x) && hit++);
      return { index: s.index, start: s.start, text: s.text, score: hit / q.size };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, limit);
}

function normalizeDecision(value) {
  const d = value && typeof value === 'object' ? value : {};
  const internal = d.internal && typeof d.internal === 'object' ? d.internal : {};
  const external = d.external && typeof d.external === 'object' ? d.external : {};
  const resistance = d.resistance && typeof d.resistance === 'object' ? d.resistance : {};
  const normalized = {
    at: Math.max(0, Number(d.at) || 0),
    model: clip(d.model, 80),
    resistance: {
      customerWords: clip(resistance.customerWords, MAX_TEXT),
      category: RESISTANCE_CATEGORIES.has(resistance.category) ? resistance.category : 'none',
      hypothesis: clip(resistance.hypothesis, MAX_TEXT),
      verifyQuestion: clip(resistance.verifyQuestion, MAX_TEXT),
      action: clip(resistance.action, MAX_TEXT),
      status: RESISTANCE_STATUS.has(resistance.status) ? resistance.status : 'unconfirmed',
    },
    internal: {
      verdict: clip(internal.verdict, MAX_TEXT),
      validated: list(internal.validated),
      revised: list(internal.revised),
      risks: list(internal.risks),
      strategy: clip(internal.strategy, MAX_TEXT),
      investment: clip(internal.investment, MAX_TEXT),
    },
    external: {
      current: externalText(external.current),
      goal: externalText(external.goal),
      validatedScene: externalText(external.validatedScene),
      pilot: externalText(external.pilot),
      roles: externalText(external.roles),
      acceptance: externalText(external.acceptance),
      risks: externalText(external.risks),
      nextDecision: externalText(external.nextDecision),
    },
  };
  const has =
    normalized.resistance.customerWords ||
    normalized.resistance.hypothesis ||
    normalized.internal.verdict ||
    normalized.internal.validated.length ||
    Object.values(normalized.external).some(Boolean);
  return has ? normalized : null;
}

export function normalizeDemoGuide(value) {
  if (!value || typeof value !== 'object') return null;
  const routes = (Array.isArray(value.routes) ? value.routes : [])
    .slice(0, 3)
    .map(normalizeRoute)
    .filter((r) => r.title || r.hypothesis || r.demo);
  if (!routes.length) return null;
  return {
    at: Math.max(0, Number(value.at) || 0),
    model: clip(value.model, 80),
    routes,
    resistanceWords: clip(value.resistanceWords, MAX_TEXT),
    matchAt: Math.max(0, Number(value.matchAt) || 0),
    decision: normalizeDecision(value.decision),
  };
}

export function parseDemoGuideResponse(raw) {
  const parsed = parseObject(raw);
  const guide = normalizeDemoGuide({ routes: parsed.routes });
  if (!guide) throw new Error('AI 沒有產生可用的 DEMO 驗證路線，請補充 P0 診斷後再試');
  return guide;
}

export function parseDecisionResponse(raw) {
  const decision = normalizeDecision(parseObject(raw));
  if (!decision) throw new Error('AI 沒有產生可用的決策整理，請先記錄現場驗證結果');
  return decision;
}

function add(lines, label, value) {
  const text = clip(value, 2400);
  if (text) lines.push(`${label}：${text}`);
}

function reviewContext(review = {}, deckInput = {}, courseNotes = '', brand = '') {
  const lines = [];
  add(lines, '品牌', brand);
  add(lines, '客戶', review.customer || deckInput.name);
  add(lines, '背景', deckInput.background);
  add(lines, '原始目標', deckInput.goals);
  add(lines, '原始疑慮', deckInput.concerns);
  add(lines, '興趣方案／領域', deckInput.product);
  add(lines, '可投入時間／裝置', deckInput.availability);
  add(lines, '開發紀錄', deckInput.raw);
  add(lines, '公司實際方案資料', courseNotes);
  add(lines, '客戶最有反應', review.reaction);
  add(lines, '客戶疑慮與業務回應', review.objections);
  add(lines, 'DEMO 新資訊', review.newInfo);
  const consult = consultToText(review.consult);
  if (consult) lines.push('', consult);
  return lines.join('\n');
}

export function buildDemoGuidePrompt({ review = {}, deckInput = {}, courseNotes = '', brand = '' } = {}) {
  return [
    '你是 AI 落地顧問，請把顧問診斷轉成一場「驗證假設」的 DEMO，不是產品功能導覽。',
    '請產生 1–3 段路線，按重要性排序。每一段只能驗證一個會影響適配或方案設計的假設。',
    '',
    '規則：',
    '- customerQuote 必須引用下方資料中的原句或明確欄位；沒有直接依據就寫「目前無直接原話」。',
    '- demo 只寫要展示的客戶工作場景，不可杜撰公司未提供的功能。',
    '- beforeQuestion 用來確認現在流程；afterQuestion 必須驗收價值／可行性／決策其中之一，不能只問「覺得如何」。',
    '- signals 是現場可觀察訊號，例如主動追問、指出實際限制、確認節省哪一步。',
    '- stopCondition 說明何時應停止這段，不要硬講完。',
    '- avoid 明確寫這段不該展示什麼，防止功能轟炸。',
    '- 問句不施壓、不製造恐懼；繁體中文、台灣用語、短句。',
    '',
    '【現有資料】',
    reviewContext(review, deckInput, courseNotes, brand) || '目前資料不足',
    '',
    '只輸出 JSON，不要 markdown：',
    '{"routes":[{"id":"route_1","title":"短標題","customerQuote":"客戶原話／來源","hypothesis":"這段要驗證的單一假設","demo":"只展示哪個工作場景","beforeQuestion":"展示前的一句問題","signals":["觀察訊號"],"afterQuestion":"展示後的驗收問題","stopCondition":"停止條件","avoid":"不該展示的內容"}]}',
  ].join('\n');
}

/** AI 判斷 → 建議業務按的驗證結果（仍由業務自己按） */
export const STANCE_RESULT = { support: 'confirmed', revise: 'revise', reject: 'rejected' };

function routeQuery(r) {
  return [r.hypothesis, r.customerQuote, r.afterQuestion, ...(r.signals || [])].filter(Boolean).join(' ');
}

/**
 * 本機先篩：每條路線取字面最接近的客戶句，再補幾句最長的客戶發言，
 * 只有這些候選句會送出，不送完整逐字稿。
 * @returns {{id:string, index:number, start:number, text:string}[]}
 */
export function selectQuoteCandidates(segs, routes, { perRoute = 10, longest = 12, max = 40, maxChars = 160 } = {}) {
  const seen = new Set();
  const picked = [];
  const take = (hits) =>
    hits.forEach((h) => {
      if (seen.has(h.index)) return;
      seen.add(h.index);
      picked.push(h);
    });
  (routes || []).forEach((r) => take(findQuoteMoments(segs, routeQuery(r), { limit: perRoute })));
  take(findQuoteMoments(segs, '', { limit: longest }));
  return picked
    .slice(0, max)
    .sort((a, b) => a.start - b.start)
    .map((h, i) => ({ id: `L${i + 1}`, index: h.index, start: h.start, text: h.text.slice(0, maxChars) }));
}

export function buildQuoteMatchPrompt({ routes = [], candidates = [] } = {}) {
  return [
    '你是顧問式銷售的現場證據審核員。這是一題一題的選擇題，不需要寫任何說明。',
    '對每一條「假設」，從下方客戶發言中，挑出能當作現場證據的句子（每條假設最多 3 句）。',
    '',
    '每句只能選一個 stance：',
    '- support：客戶的話直接支持這個假設',
    '- revise：客戶的話顯示假設方向對但內容要修正（例如程度、對象、流程不同）',
    '- reject：客戶的話推翻這個假設',
    '- unrelated：跟這個假設無關（不要輸出）',
    'confidence 只能是 high（字面明確）、medium（需要一點推論）、low（勉強相關）。',
    '只根據客戶的話判斷，不要因為業務希望成交就偏向 support。沒有證據就不要輸出那條假設。',
    '',
    '【假設】',
    ...routes.map((r) => `${r.id}｜${r.title}｜${r.hypothesis}`),
    '',
    '【客戶發言候選】',
    ...candidates.map((c) => `${c.id}｜${c.text}`),
    '',
    '只輸出 JSON：{"judgments":[{"route":"route_1","line":"L3","stance":"support","confidence":"high"}]}',
  ].join('\n');
}

/** Gemini responseSchema：把答案限制成選項 */
export function quoteMatchSchema(routes = [], candidates = []) {
  const ids = (xs) => (xs.length ? xs : ['none']);
  return {
    type: 'OBJECT',
    properties: {
      judgments: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            route: { type: 'STRING', enum: ids(routes.map((r) => r.id)) },
            line: { type: 'STRING', enum: ids(candidates.map((c) => c.id)) },
            stance: { type: 'STRING', enum: ['support', 'revise', 'reject', 'unrelated'] },
            confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
          },
          required: ['route', 'line', 'stance', 'confidence'],
        },
      },
    },
    required: ['judgments'],
  };
}

/**
 * 只接受已知的路線與候選句代號；原話與時間一律用本機候選，不採用模型回傳的文字。
 * @returns {Record<string, object[]>} routeId → matches
 */
export function parseQuoteMatchResponse(raw, { routes = [], candidates = [] } = {}) {
  const parsed = typeof raw === 'string' ? parseObject(raw) : raw || {};
  const routeIds = new Set(routes.map((r) => r.id));
  const byLine = new Map(candidates.map((c) => [c.id, c]));
  const out = Object.fromEntries(routes.map((r) => [r.id, []]));
  (Array.isArray(parsed.judgments) ? parsed.judgments : []).forEach((j) => {
    const c = byLine.get(String(j?.line || '').trim());
    const id = String(j?.route || '').trim();
    if (!c || !routeIds.has(id) || !QUOTE_STANCES.has(j?.stance)) return;
    if (out[id].some((m) => m.index === c.index)) return;
    out[id].push({ index: c.index, start: c.start, text: c.text, stance: j.stance, confidence: QUOTE_CONFIDENCE[j.confidence] ? j.confidence : 'low' });
  });
  Object.values(out).forEach((ms) =>
    ms.sort((a, b) => QUOTE_CONFIDENCE[b.confidence] - QUOTE_CONFIDENCE[a.confidence] || a.start - b.start).splice(3)
  );
  return out;
}

export function applyQuoteMatches(guide, matchesByRoute, at = Date.now()) {
  const g = normalizeDemoGuide(guide);
  if (!g) return null;
  return normalizeDemoGuide({
    ...g,
    matchAt: at,
    routes: g.routes.map((r) => ({ ...r, matches: matchesByRoute?.[r.id] || [] })),
  });
}

export function guideStats(guide) {
  const routes = normalizeDemoGuide(guide)?.routes || [];
  const tested = routes.filter((r) => r.result !== 'pending').length;
  const confirmed = routes.filter((r) => r.result === 'confirmed').length;
  const revised = routes.filter((r) => r.result === 'revise').length;
  const rejected = routes.filter((r) => r.result === 'rejected').length;
  const withQuote = routes.filter((r) => r.observedQuote).length;
  const withTime = routes.filter((r) => r.observedQuote && r.quoteAt != null).length;
  return { total: routes.length, tested, confirmed, revised, rejected, withQuote, withTime, complete: routes.length > 0 && tested === routes.length };
}

export function patchGuideRoute(guide, id, patch) {
  const g = normalizeDemoGuide(guide);
  if (!g) return null;
  return normalizeDemoGuide({
    ...g,
    decision: null,
    routes: g.routes.map((r, i) => (r.id === id ? normalizeRoute({ ...r, ...patch }, i) : r)),
  });
}

function routeEvidenceLines(guide) {
  const g = normalizeDemoGuide(guide);
  if (!g) return [];
  return g.routes.flatMap((r, i) => [
    `路線 ${i + 1}｜${r.title}`,
    `原假設：${r.hypothesis}`,
    `驗證結果：${r.result}`,
    `客戶反應：${r.reaction}`,
    `客戶現場原話：${r.observedQuote || '未記錄'}${r.observedQuote && r.quoteAt != null ? `（錄影 ${formatClock(r.quoteAt)}）` : ''}`,
    `現場備註：${r.note || '無'}`,
  ]);
}

export function buildDecisionPrompt({ review = {}, guide, deckInput = {}, courseNotes = '', brand = '' } = {}) {
  const g = normalizeDemoGuide(guide);
  if (!g) throw new Error('尚未產生 DEMO 驗證路線');
  return [
    '你是 AI 落地顧問。請依「現場驗證結果」整理真正阻力，以及內部主管版與外部客戶決策版。',
    '',
    '硬性規則：',
    '- 現場證據優先於原本 AI 假設；被修正或否定的假設不得繼續當成事實。',
    '- resistance 必須先提出 verifyQuestion，再給 action；不可直接生成反駁話術。',
    '- category 只能是 outcome（成果不確定）、self（自我效能）、process（資料／流程）、authority（決策人）、timing（時機）、price（價格／回收）、fit（不適配）、none。',
    '- resistance.status 預設 unconfirmed；只有客戶現場原話直接證實時才可 confirmed。',
    '- internal 可以包含 A/B/C、風險與資源投入判斷。',
    '- external 絕對不能出現客戶分級、A/B/C、成交機率、業務評分、AI 可信度、私人備註或「客戶怕什麼」等內部標籤。',
    '- external 只能使用已確認內容；推測要改寫成「待雙方確認」。',
    '- 不杜撰產品功能或成效；繁體中文、短句。',
    '',
    '【原始資料與 P0】',
    reviewContext(review, deckInput, courseNotes, brand),
    '',
    '【P1 現場驗證】',
    ...routeEvidenceLines(g),
    `客戶阻力原話：${g.resistanceWords || review.objections || '未記錄'}`,
    '',
    '只輸出 JSON，不要 markdown：',
    '{"resistance":{"customerWords":"客戶原話","category":"outcome|self|process|authority|timing|price|fit|none","hypothesis":"可能根因，未確認要明說","verifyQuestion":"先問客戶的一句話","action":"確認後才採取的行動","status":"unconfirmed|confirmed|rejected"},"internal":{"verdict":"主管看的總結與 A/B/C 判斷","validated":["已證實"],"revised":["被修正或推翻"],"risks":["風險"],"strategy":"下一次策略","investment":"建議投入多少跟進資源"},"external":{"current":"客戶已確認的現況","goal":"客戶已確認的目標","validatedScene":"這次已驗證的場景","pilot":"最小落地範圍","roles":"雙方要提供什麼","acceptance":"可驗收標準","risks":"前置條件與風險","nextDecision":"下一個決策點"}}',
  ].join('\n');
}

export function guideToText(guide, type = 'internal') {
  const g = normalizeDemoGuide(guide);
  const d = g?.decision;
  if (!d) return '';
  if (type === 'external') {
    const labels = {
      current: '目前現況',
      goal: '希望達成',
      validatedScene: '已驗證場景',
      pilot: '建議先做',
      roles: '雙方準備',
      acceptance: '驗收方式',
      risks: '前置條件',
      nextDecision: '下一個決策點',
    };
    return ['【DEMO 決策共識】', ...Object.entries(d.external).filter(([, v]) => v).map(([k, v]) => `${labels[k]}：${v}`)].join('\n');
  }
  const lines = ['【DEMO 主管決策卡】'];
  if (d.internal.verdict) lines.push(`判斷：${d.internal.verdict}`);
  d.internal.validated.forEach((x) => lines.push(`已證實：${x}`));
  d.internal.revised.forEach((x) => lines.push(`已修正：${x}`));
  d.internal.risks.forEach((x) => lines.push(`風險：${x}`));
  if (d.internal.strategy) lines.push(`策略：${d.internal.strategy}`);
  if (d.internal.investment) lines.push(`投入建議：${d.internal.investment}`);
  if (d.resistance.customerWords || d.resistance.hypothesis) {
    lines.push(`阻力：${d.resistance.customerWords || d.resistance.hypothesis}`);
    if (d.resistance.verifyQuestion) lines.push(`先問：${d.resistance.verifyQuestion}`);
    if (d.resistance.action) lines.push(`確認後行動：${d.resistance.action}`);
  }
  return lines.join('\n');
}
