/**
 * 顧問式 DEMO P1 的純函式：
 * 1) 從 P0 診斷產生最多三段「待驗證路線」
 * 2) 保存每段現場證據
 * 3) 根據驗證結果整理阻力與內／外兩種決策卡
 */
import { consultToText } from './demo-review-consult.js';

const MAX_TEXT = 1200;
const MAX_SHORT = 300;
const ROUTE_RESULTS = new Set(['pending', 'confirmed', 'revise', 'rejected']);
const REACTIONS = new Set(['none', 'inquiry', 'agreed', 'hesitant', 'objection']);
const RESISTANCE_CATEGORIES = new Set(['outcome', 'self', 'process', 'authority', 'timing', 'price', 'fit', 'none']);
const RESISTANCE_STATUS = new Set(['unconfirmed', 'confirmed', 'rejected']);

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
    note: clip(r.note, MAX_TEXT),
  };
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
      current: clip(external.current, MAX_TEXT),
      goal: clip(external.goal, MAX_TEXT),
      validatedScene: clip(external.validatedScene, MAX_TEXT),
      pilot: clip(external.pilot, MAX_TEXT),
      roles: clip(external.roles, MAX_TEXT),
      acceptance: clip(external.acceptance, MAX_TEXT),
      risks: clip(external.risks, MAX_TEXT),
      nextDecision: clip(external.nextDecision, MAX_TEXT),
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

function reviewContext(review = {}, deckInput = {}, courseNotes = '') {
  const lines = [];
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

export function buildDemoGuidePrompt({ review = {}, deckInput = {}, courseNotes = '' } = {}) {
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
    reviewContext(review, deckInput, courseNotes) || '目前資料不足',
    '',
    '只輸出 JSON，不要 markdown：',
    '{"routes":[{"id":"route_1","title":"短標題","customerQuote":"客戶原話／來源","hypothesis":"這段要驗證的單一假設","demo":"只展示哪個工作場景","beforeQuestion":"展示前的一句問題","signals":["觀察訊號"],"afterQuestion":"展示後的驗收問題","stopCondition":"停止條件","avoid":"不該展示的內容"}]}',
  ].join('\n');
}

export function guideStats(guide) {
  const routes = normalizeDemoGuide(guide)?.routes || [];
  const tested = routes.filter((r) => r.result !== 'pending').length;
  const confirmed = routes.filter((r) => r.result === 'confirmed').length;
  const revised = routes.filter((r) => r.result === 'revise').length;
  const rejected = routes.filter((r) => r.result === 'rejected').length;
  const withQuote = routes.filter((r) => r.observedQuote).length;
  return { total: routes.length, tested, confirmed, revised, rejected, withQuote, complete: routes.length > 0 && tested === routes.length };
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
    `客戶現場原話：${r.observedQuote || '未記錄'}`,
    `現場備註：${r.note || '無'}`,
  ]);
}

export function buildDecisionPrompt({ review = {}, guide, deckInput = {}, courseNotes = '' } = {}) {
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
    reviewContext(review, deckInput, courseNotes),
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
