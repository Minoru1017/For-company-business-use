/**
 * DEMO 後複盤的顧問式銷售 P0：
 * 把業務自填複盤＋簡報客戶資料整理成 Gemini 可判讀的結構，
 * 回傳「診斷／待追問／AI 落地定義／具體下一步」。
 *
 * 這個模組只做純函式，不碰 DOM 或 localStorage。
 */
import { PURPOSE_TYPES } from './purpose-types.js';

const TEXT_MAX = 1200;
const SHORT_MAX = 300;
const EVIDENCE_STATUSES = new Set(['confirmed', 'inferred', 'missing']);
const PRIORITIES = new Set(['high', 'medium', 'low']);
const OUTCOME_LABELS = {
  closed: '當場成交',
  next: '約好下一步',
  thinking: '客戶考慮中',
  notfit: '判斷不適合',
  declined: '客戶婉拒',
};
const TIER_LABELS = Object.fromEntries(PURPOSE_TYPES.map((x) => [x.key, x.label]));

const clip = (v, n = SHORT_MAX) => String(v ?? '').trim().slice(0, n);

function stripFence(raw) {
  return String(raw || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

function parseJsonObject(raw) {
  const text = stripFence(raw);
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* handled below */
      }
    }
  }
  throw new Error('AI 回傳格式不是 JSON，請再試一次');
}

function stringFields(value, keys, max = SHORT_MAX) {
  const src = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(keys.map((key) => [key, clip(src[key], max)]));
}

export const EMPTY_CONSULT = Object.freeze({
  at: 0,
  model: '',
  diagnosis: {
    current: '',
    goal: '',
    bottleneck: '',
    cost: '',
    decision: '',
    fit: '',
    recommendation: '',
    confidence: '',
  },
  evidence: [],
  gaps: [],
  implementation: {
    user: '',
    workflow: '',
    input: '',
    output: '',
    acceptance: '',
    review: '',
    risk: '',
  },
  next: {
    action: '',
    owner: '',
    counterpart: '',
    date: '',
    condition: '',
    message: '',
  },
});

/**
 * 防止 AI 輸出或舊資料把任意結構塞進 localStorage。
 */
export function normalizeConsult(value) {
  if (!value || typeof value !== 'object') return null;
  const diagnosis = stringFields(value.diagnosis, Object.keys(EMPTY_CONSULT.diagnosis), TEXT_MAX);
  const implementation = stringFields(value.implementation, Object.keys(EMPTY_CONSULT.implementation), TEXT_MAX);
  const next = stringFields(value.next, Object.keys(EMPTY_CONSULT.next), TEXT_MAX);
  if (next.date && !/^\d{4}-\d{2}-\d{2}$/.test(next.date)) next.date = '';

  const evidence = (Array.isArray(value.evidence) ? value.evidence : [])
    .filter((x) => x && typeof x === 'object')
    .slice(0, 10)
    .map((x) => ({
      claim: clip(x.claim, TEXT_MAX),
      source: clip(x.source, TEXT_MAX),
      status: EVIDENCE_STATUSES.has(x.status) ? x.status : 'inferred',
    }))
    .filter((x) => x.claim || x.source);

  const gaps = (Array.isArray(value.gaps) ? value.gaps : [])
    .filter((x) => x && typeof x === 'object')
    .slice(0, 6)
    .map((x) => ({
      topic: clip(x.topic),
      why: clip(x.why, TEXT_MAX),
      question: clip(x.question, TEXT_MAX),
      priority: PRIORITIES.has(x.priority) ? x.priority : 'medium',
    }))
    .filter((x) => x.topic || x.question);

  const hasContent =
    Object.values(diagnosis).some(Boolean) ||
    Object.values(implementation).some(Boolean) ||
    Object.values(next).some(Boolean) ||
    evidence.length ||
    gaps.length;
  if (!hasContent) return null;

  return {
    at: Math.max(0, Number(value.at) || 0),
    model: clip(value.model, 80),
    diagnosis,
    evidence,
    gaps,
    implementation,
    next,
  };
}

export function parseConsultResponse(raw) {
  const parsed = normalizeConsult(parseJsonObject(raw));
  if (!parsed) throw new Error('AI 沒有回傳可用的顧問診斷，請補充複盤內容後再試');
  return parsed;
}

function add(lines, label, value) {
  const text = clip(value, 2000);
  if (text) lines.push(`${label}：${text}`);
}

function analysisSummary(s) {
  if (!s) return '';
  const parts = [];
  if (s.totalDur) parts.push(`通話 ${Math.max(1, Math.round(s.totalDur / 60))} 分`);
  parts.push(`客戶說話 ${Math.round((Number(s.custRatio) || 0) * 100)}%`);
  parts.push(`顧問提問 ${Number(s.sQuestions) || 0} 題`);
  parts.push(`五層資訊到 L${Number(s.deepest) || 0}`);
  if (s.dominant) parts.push(`客戶偏向「${clip(s.dominant, 40)}」`);
  return parts.join(' · ');
}

/**
 * 只送使用者已填內容與分析數字，不會把影片或完整逐字稿送出。
 */
export function buildConsultPrompt({ review = {}, deckInput = {}, courseNotes = '', today = '' } = {}) {
  const lines = [
    '你是 AI 落地顧問兼顧問式銷售教練。你的角色是第二意見，不是替業務腦補答案。',
    '請根據「業務自填 DEMO 複盤」與「DEMO 前客戶資料」，完成四件事：',
    '1. 顧問診斷：現況、目標、流程斷點、不處理的代價、決策條件、A/B/C 適配、負責任的建議。',
    '2. 待追問：只列會影響適配判斷或方案設計的缺口，最多 5 題。',
    '3. AI 落地定義：把模糊的「想學 AI」轉成使用者、原始流程、輸入、輸出、驗收標準、人工審核點、風險。',
    '4. 具體下一步：清楚寫誰、何時、做什麼、完成條件；若尚未和客戶約定，必須明寫「建議」，不可假裝已承諾。',
    '',
    '硬性規則：',
    '- 不能把推測寫成事實。evidence.status 只能是 confirmed（資料中有直接依據）、inferred（合理推測）、missing（仍待確認）。',
    '- evidence.source 必須引用輸入中的短句或明確欄位；找不到就標 missing，不可杜撰客戶原話。',
    '- fit 必須是 A 高度適合、B 部分適合、C 不適合之一，並說明理由；不適合也要敢判 C。',
    '- 不可承諾產品資料沒有寫到的課程、功能、成效或服務。',
    '- acceptance 要可驗收，優先用時間、次數、產出物或人工檢查方式，不可只寫「提升效率」。',
    '- 問題要像顧問，不施壓、不製造恐懼、不直接反駁客戶。',
    '- 繁體中文、台灣用語、短句。',
    '',
    `今天日期：${today || '未提供'}`,
    '【DEMO 前客戶資料】',
  ];

  add(lines, '姓名', deckInput.name);
  add(lines, '背景', deckInput.background);
  add(lines, '有興趣的方案／領域', deckInput.product);
  add(lines, '目標', deckInput.goals);
  add(lines, '特質', deckInput.traits);
  add(lines, '故事／動機', deckInput.story);
  add(lines, '原有疑慮', deckInput.concerns);
  add(lines, '可投入時間／裝置', deckInput.availability);
  add(lines, '開發紀錄原文', deckInput.raw);
  add(lines, '公司實際方案資料', courseNotes);

  lines.push('', '【業務自填 DEMO 複盤】');
  add(lines, '客戶', review.customer);
  add(lines, 'DEMO 時間', review.demoAt);
  add(lines, 'DEMO 結果', OUTCOME_LABELS[review.outcome] || '未填結果');
  add(lines, '業務判斷的目的分級', TIER_LABELS[review.tier] || '');
  add(lines, '業務判斷的方案適配', review.fit);
  add(lines, '目前下一步', review.nextStep);
  add(lines, '跟進日期', review.followUpDate);
  add(lines, '客戶最有反應的地方', review.reaction);
  add(lines, '客戶疑慮與業務回應', review.objections);
  add(lines, 'DEMO 新問出的資訊', review.newInfo);
  add(lines, '業務做得好的', review.wentWell);
  add(lines, '業務下次要改的', review.improve);
  add(lines, '其他備註', review.note);
  if (review.analysis?.summary) add(lines, '錄影規則分析摘要', analysisSummary(review.analysis.summary));

  lines.push(
    '',
    '只輸出以下 JSON，不要 markdown 圍欄：',
    '{"diagnosis":{"current":"","goal":"","bottleneck":"","cost":"","decision":"","fit":"A 高度適合|B 部分適合|C 不適合（含理由）","recommendation":"","confidence":"高|中|低（含理由）"},"evidence":[{"claim":"診斷結論","source":"輸入中的原句或欄位","status":"confirmed|inferred|missing"}],"gaps":[{"topic":"缺口名稱","why":"為何會影響判斷","question":"下一次可直接問客戶的一句話","priority":"high|medium|low"}],"implementation":{"user":"實際使用者","workflow":"目前要改善的工作流程","input":"需要的資料／素材","output":"要產出的成果","acceptance":"可驗收標準","review":"人工審核點","risk":"主要風險或前置條件"},"next":{"action":"下一個最小行動","owner":"業務要做什麼","counterpart":"客戶／決策人要做什麼","date":"YYYY-MM-DD 或空字串","condition":"完成條件","message":"可直接傳給客戶的簡短訊息"}}',
    'evidence 3–6 筆；gaps 依優先順序最多 5 筆。若資料不足，寧可留下待確認，不要補故事。'
  );
  return lines.join('\n');
}

export function consultToText(consult) {
  const c = normalizeConsult(consult);
  if (!c) return '';
  const lines = ['【顧問診斷】'];
  [
    ['現況', c.diagnosis.current],
    ['目標', c.diagnosis.goal],
    ['流程斷點', c.diagnosis.bottleneck],
    ['不處理的代價', c.diagnosis.cost],
    ['決策條件', c.diagnosis.decision],
    ['適配', c.diagnosis.fit],
    ['建議', c.diagnosis.recommendation],
    ['可信度', c.diagnosis.confidence],
  ].forEach(([label, value]) => value && lines.push(`${label}：${value}`));
  if (c.gaps.length) {
    lines.push('', '【下次必問】');
    c.gaps.forEach((g, i) => lines.push(`${i + 1}. ${g.question}${g.why ? `（${g.why}）` : ''}`));
  }
  lines.push('', '【AI 落地定義】');
  Object.entries(c.implementation).forEach(([key, value]) => {
    const labels = { user: '使用者', workflow: '原始流程', input: '輸入', output: '輸出', acceptance: '可驗收標準', review: '人工審核', risk: '風險' };
    if (value) lines.push(`${labels[key]}：${value}`);
  });
  lines.push('', '【具體下一步】');
  if (c.next.action) lines.push(`行動：${c.next.action}`);
  if (c.next.owner) lines.push(`業務：${c.next.owner}`);
  if (c.next.counterpart) lines.push(`客戶／決策人：${c.next.counterpart}`);
  if (c.next.date) lines.push(`日期：${c.next.date}`);
  if (c.next.condition) lines.push(`完成條件：${c.next.condition}`);
  if (c.next.message) lines.push(`可傳訊息：${c.next.message}`);
  return lines.join('\n');
}
