/**
 * 開發症狀紀錄——純函式引擎（不碰 DOM／IndexedDB，可在 node 測試）。
 *   - 公司電話系統匯出的錄音檔：從檔名解析日期時間，解析不到就退回檔案修改時間
 *   - 每日漏斗：撥出 → 接通 → 超過 N 分 → 長 Call → 進邀約
 *   - 從單通 runAnalysis 結果萃取「症狀 key」，跨多通彙總找共同病症
 *   - AI 診斷 prompt／解析（只把彙總數字與少量客戶原話送出去，不送整份逐字稿）
 */
import { RULES } from './rules.js';
import { isQuestion } from './speaker.js';
import { disclosureLevel } from './trust.js';

export const DEFAULT_THRESHOLDS = { shortMin: 5, longMin: 15 };

const pad2 = (n) => String(n).padStart(2, '0');

/** 本地日期 → 'YYYY-MM-DD' */
export function dateKey(d = new Date()) {
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/** 'YYYY-MM-DD' → 本地 Date（當天 00:00） */
export function parseDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function shiftDateKey(key, days) {
  const d = parseDateKey(key);
  if (!d) return '';
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

function validYmd(y, mo, d) {
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

// 常見電話系統檔名：20260923_143012_0912345678.wav / 2026-09-23 14-30-12.wav / rec_2026.09.23_1430.wav
// / 0912345678-20260923143012.wav。日期前後不得緊接數字（避免把電話號碼切一段當日期）。
const FILENAME_DATE_RE =
  /(?<!\d)(20\d{2})([-._/]?)(0[1-9]|1[0-2])\2(0[1-9]|[12]\d|3[01])(?:[-._ T]?([01]\d|2[0-3])[-.:]?([0-5]\d)(?:[-.:]?([0-5]\d))?)?(?!\d)/;

/**
 * @returns {{date:string, time:string|null, source:'filename'|'modified'|null}}
 */
export function parseDateFromFilename(name, lastModified) {
  const m = FILENAME_DATE_RE.exec(String(name || ''));
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[3]);
    const d = Number(m[4]);
    if (validYmd(y, mo, d)) {
      const time = m[5] != null ? `${m[5]}:${m[6]}` : null;
      return { date: `${y}-${pad2(mo)}-${pad2(d)}`, time, source: 'filename' };
    }
  }
  if (lastModified != null && Number.isFinite(Number(lastModified)) && Number(lastModified) > 0) {
    const dt = new Date(Number(lastModified));
    return { date: dateKey(dt), time: `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`, source: 'modified' };
  }
  return { date: '', time: null, source: null };
}

/**
 * 每日漏斗。超過 N 分／長 Call 優先用手填，沒填就從已匯入錄音的秒數自動算。
 * @param {{dialed?:number, connected?:number, invites?:number, over5Manual?:number|null, longManual?:number|null}} day
 * @param {Array<{durationSec?:number}>} calls
 */
export function funnelFromCalls(day = {}, calls = [], thresholds = DEFAULT_THRESHOLDS) {
  const shortMin = Number(thresholds?.shortMin ?? DEFAULT_THRESHOLDS.shortMin);
  const longMin = Number(thresholds?.longMin ?? DEFAULT_THRESHOLDS.longMin);
  const durations = (calls || []).map((c) => Number(c?.durationSec) || 0).filter((d) => d > 0);
  const autoOver = durations.filter((d) => d >= shortMin * 60).length;
  const autoLong = durations.filter((d) => d >= longMin * 60).length;
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Math.max(0, Math.floor(Number(v))));
  const over = num(day.over5Manual) ?? autoOver;
  const long = num(day.longManual) ?? autoLong;
  const dialed = num(day.dialed) ?? 0;
  const connected = num(day.connected) ?? 0;
  const invites = num(day.invites) ?? 0;
  const ratio = (a, b) => (b > 0 ? a / b : null);
  return {
    dialed,
    connected,
    over,
    long,
    invites,
    autoOver,
    autoLong,
    shortMin,
    longMin,
    connectRate: ratio(connected, dialed),
    overRate: ratio(over, connected),
    longRate: ratio(long, over),
    inviteRate: ratio(invites, over),
    inviteRateConnected: ratio(invites, connected),
    callsImported: (calls || []).length,
  };
}

/** 症狀定義：key → 顯示名稱、分組、一句話說明（給彙總面板與 AI prompt 用） */
export const SYMPTOM_DEFS = {
  talk_too_much: { label: '業務講太多', group: '開口', hint: '客戶說話比例 < 45%' },
  short_replies: { label: '客戶只在附和', group: '開口', hint: '客戶過半句子 ≤ 4 字' },
  stuck_L1: { label: '客戶沒說出困擾', group: '信任', hint: '客戶最深只到「事實」層，沒講到困擾' },
  trust_no_breakthrough: { label: '沒有信任突破', group: '信任', hint: '客戶全程沒說出私人／動機層資訊' },
  trust_shutdown: { label: '客戶說一半收回', group: '信任', hint: '講到困擾後又退回敷衍' },
  step_missing_connect: { label: '開場沒建立安全感', group: '六步驟', hint: 'Step 1 連結未偵測' },
  step_missing_discovery: { label: '問句太少', group: '六步驟', hint: 'Step 2 挖掘：業務問句 < 3' },
  step_missing_clarify: { label: '沒釐清不改變的代價', group: '六步驟', hint: 'Step 3 釐清未偵測' },
  step_missing_diagnose: { label: '沒做適配判斷', group: '六步驟', hint: 'Step 4 判斷未偵測' },
  step_missing_recommend: { label: '沒對接方案', group: '六步驟', hint: 'Step 5 對接未偵測' },
  step_missing_decision: { label: '沒收尾決策', group: '六步驟', hint: 'Step 6 決策未偵測' },
  premature_pitch: { label: '急著介紹產品', group: '節奏', hint: '第一次提方案前問句 < 3' },
  pitch_without_verdict: { label: '推方案沒講適配結論', group: '節奏', hint: '有推方案，沒說適合／不適合與理由' },
  layer_shallow: { label: '五層只到 L1–L2', group: '挖掘', hint: '資訊不足就往下走' },
  layer_incomplete: { label: '五層到 L3–L4 就停', group: '挖掘', hint: '沒挖到動機／未來' },
  no_converge: { label: '沒做完成標準驗證', group: '挖掘', hint: '沒說「所以你真正想解決的是…我理解對嗎」' },
  purpose_unclassified: { label: '沒判斷目的分級', group: '分級', hint: '要／怕／想／愛／爽 未判斷' },
  wrong_probe: { label: '問錯方向', group: '分級', hint: '硬導向別的分級' },
  no_amplify: { label: '沒依分級強化', group: '分級', hint: '未引用客戶原話強化' },
  fear_words: { label: '用了恐嚇式用語', group: '底線', hint: '製造恐懼而非放大客戶自述' },
};

export const SYMPTOM_KEYS = Object.keys(SYMPTOM_DEFS);

function quote(seg) {
  if (!seg || typeof seg.text !== 'string') return null;
  const text = seg.text.length > 60 ? `${seg.text.slice(0, 60)}…` : seg.text;
  return { text, start: Number(seg.start) || 0 };
}

/**
 * 從 runAnalysis 結果 + 已 enrich 的 segs 萃取症狀。
 * @returns {{keys:string[], evidence:Record<string,{text:string,start:number}>, metrics:object}}
 */
export function extractSymptoms(result, segs = []) {
  const keys = [];
  const evidence = {};
  const add = (key, seg) => {
    if (!SYMPTOM_DEFS[key] || keys.includes(key)) return;
    keys.push(key);
    const q = quote(seg);
    if (q) evidence[key] = q;
  };

  const S = segs.filter((s) => s.spk === 'S');
  const C = segs.filter((s) => s.spk === 'C');
  const stats = result?.stats || {};
  const custRatio = Number(stats.custRatio) || 0;
  const totalDur = Number(stats.totalDur) || (segs.length ? segs[segs.length - 1].end - segs[0].start : 0);

  if (custRatio < 0.45) add('talk_too_much');
  const shortReplies = C.filter((s) => (s.chars ?? s.text?.length ?? 0) <= 4).length;
  if (C.length && shortReplies / C.length > 0.5) add('short_replies', C.find((s) => (s.chars ?? 0) <= 4));

  const stepHit = result?.stepHit || {};
  ['connect', 'discovery', 'clarify', 'diagnose', 'recommend', 'decision'].forEach((k) => {
    if (!stepHit[k]) add(`step_missing_${k}`);
  });

  const firstPitchIdx = segs.findIndex((s) => s.spk === 'S' && (RULES.steps[4].re.test(s.text) || RULES.products.test(s.text)));
  let firstPitchMin = null;
  if (firstPitchIdx >= 0) {
    firstPitchMin = (segs[firstPitchIdx].start - (segs[0]?.start || 0)) / 60;
    const qBefore = segs.slice(0, firstPitchIdx).filter((s) => s.spk === 'S' && isQuestion(s.text)).length;
    if (qBefore < 3) add('premature_pitch', segs[firstPitchIdx]);
    const hasVerdict = S.some((s) => RULES.fitA.test(s.text) || RULES.fitC.test(s.text));
    if (!hasVerdict && stepHit.recommend) add('pitch_without_verdict', stepHit.recommend);
  }

  const deepest = Number(result?.deepest) || 0;
  if (deepest < 3) add('layer_shallow');
  else if (deepest < 5) add('layer_incomplete');
  if (!S.some((s) => RULES.converge.test(s.text))) add('no_converge');

  const pp = result?.purposeProfile;
  if (pp) {
    if (!pp.classified) add('purpose_unclassified');
    else {
      if (pp.wrongProbes?.length) add('wrong_probe', pp.wrongProbes[0]?.seg);
      if (!pp.matchedAmplify) add('no_amplify');
    }
  }

  const fear = S.find((s) => RULES.fearWords.test(s.text));
  if (fear) add('fear_words', fear);

  const traj = result?.trust?.trajectory;
  let firstTroubleMin = null;
  let custPeak = 0;
  if (traj) {
    custPeak = Number(traj.peak) || 0;
    if (!traj.breakthrough) add('trust_no_breakthrough');
    if (traj.shutDown) add('trust_shutdown');
    if (traj.levels?.length >= 3 && custPeak <= 1) add('stuck_L1');
    const firstTrouble = (traj.levels || []).find((l) => l.level >= 2);
    if (firstTrouble) firstTroubleMin = (firstTrouble.start - (segs[0]?.start || 0)) / 60;
  } else if (C.length) {
    const levels = C.map((s) => disclosureLevel(s.text));
    custPeak = Math.max(0, ...levels);
    const idx = levels.findIndex((l) => l >= 2);
    if (idx >= 0) firstTroubleMin = (C[idx].start - (segs[0]?.start || 0)) / 60;
    if (C.length >= 3 && custPeak <= 1) add('stuck_L1');
  }

  return {
    keys,
    evidence,
    metrics: {
      totalDur,
      custRatio,
      sQuestions: Number(stats.sQuestions) || S.filter((s) => isQuestion(s.text)).length,
      deepest,
      custPeak,
      firstTroubleMin: firstTroubleMin == null ? null : Math.round(firstTroubleMin * 10) / 10,
      firstPitchMin: firstPitchMin == null ? null : Math.round(firstPitchMin * 10) / 10,
      trustStatus: result?.trust?.status || null,
    },
  };
}

function avg(list) {
  const nums = list.filter((v) => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/**
 * 跨多通彙總。每通 call 需有 { name, symptoms: {keys, evidence, metrics} }。
 * @returns {{total:number, symptoms:Array<{key,label,group,hint,count,ratio,evidence:Array}>, metrics:object}}
 */
export function aggregateSymptoms(calls = []) {
  const analyzed = (calls || []).filter((c) => c?.symptoms && Array.isArray(c.symptoms.keys));
  const total = analyzed.length;
  const counts = new Map();
  analyzed.forEach((c) => {
    c.symptoms.keys.forEach((k) => {
      if (!SYMPTOM_DEFS[k]) return;
      const entry = counts.get(k) || { count: 0, evidence: [] };
      entry.count += 1;
      const ev = c.symptoms.evidence?.[k];
      if (ev && entry.evidence.length < 3) entry.evidence.push({ ...ev, call: c.name || '' });
      counts.set(k, entry);
    });
  });
  const symptoms = [...counts.entries()]
    .map(([key, e]) => ({ key, ...SYMPTOM_DEFS[key], count: e.count, ratio: total ? e.count / total : 0, evidence: e.evidence }))
    .sort((a, b) => b.count - a.count || SYMPTOM_KEYS.indexOf(a.key) - SYMPTOM_KEYS.indexOf(b.key));
  const m = (k) => analyzed.map((c) => c.symptoms.metrics?.[k]);
  return {
    total,
    symptoms,
    common: symptoms.filter((s) => total >= 2 && s.ratio >= 0.5).map((s) => s.key),
    metrics: {
      avgCustRatio: avg(m('custRatio')),
      avgQuestions: avg(m('sQuestions')),
      avgDeepest: avg(m('deepest')),
      avgFirstTroubleMin: avg(m('firstTroubleMin')),
      troubleReached: analyzed.filter((c) => c.symptoms.metrics?.firstTroubleMin != null).length,
      avgFirstPitchMin: avg(m('firstPitchMin')),
      avgDurationMin: avg(m('totalDur').map((d) => (typeof d === 'number' ? d / 60 : null))),
    },
  };
}

/** 某症狀在連續幾天（含 endKey）都出現；dayKeys→keys 對照表 */
export function symptomStreak(historyByDay, key, endKey) {
  let streak = 0;
  let cur = endKey;
  for (let i = 0; i < 60 && cur; i++) {
    const keys = historyByDay?.[cur];
    if (!Array.isArray(keys) || !keys.includes(key)) break;
    streak += 1;
    cur = shiftDateKey(cur, -1);
  }
  return streak;
}

const fmtPct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fmtNum = (v, unit = '') => (v == null ? '—' : `${Math.round(v * 10) / 10}${unit}`);

/**
 * AI 診斷 prompt：只送彙總數字、症狀次數與 ≤3 句客戶／業務原話，不送整份逐字稿。
 */
export function buildDiagnosisPrompt(aggregate, { funnel, date, recentNotes = [] } = {}) {
  const lines = [];
  lines.push('你是電話業務教練。以下是一位業務「同一天多通開發電訪」的規則分析彙總（依公司顧問式銷售手冊：理解需求→判斷適配→幫助決策；讓客戶多說、先挖到困擾再談方案、強化只能放大客戶自述不能製造恐懼）。');
  lines.push('請找出他「跨通共同」的核心病症（不是逐通列缺點），並給明天只改一個動作的具體建議。');
  if (date) lines.push(`日期：${date}`);
  if (funnel) {
    lines.push(
      `漏斗：撥出 ${funnel.dialed}、接通 ${funnel.connected}（${fmtPct(funnel.connectRate)}）、超過 ${funnel.shortMin} 分 ${funnel.over}（接通的 ${fmtPct(funnel.overRate)}）、長 Call（≥${funnel.longMin} 分）${funnel.long}、進邀約 ${funnel.invites}（>${funnel.shortMin} 分的 ${fmtPct(funnel.inviteRate)}）`
    );
  }
  const mt = aggregate?.metrics || {};
  lines.push(
    `已分析 ${aggregate?.total || 0} 通：平均客戶說話比例 ${fmtPct(mt.avgCustRatio)}、平均業務問句 ${fmtNum(mt.avgQuestions)} 句、五層平均到 L${fmtNum(mt.avgDeepest)}、` +
      `客戶第一次說出困擾平均在第 ${fmtNum(mt.avgFirstTroubleMin, ' 分')}（${mt.troubleReached ?? 0}/${aggregate?.total || 0} 通有挖到）、業務第一次提方案平均在第 ${fmtNum(mt.avgFirstPitchMin, ' 分')}`
  );
  lines.push('症狀出現次數（次／通）：');
  (aggregate?.symptoms || []).forEach((s) => {
    const ev = s.evidence?.length ? `；例：${s.evidence.map((e) => `「${e.text}」`).join(' ')}` : '';
    lines.push(`- ${s.label}（${s.hint}）：${s.count}/${aggregate.total}${ev}`);
  });
  if (recentNotes.length) {
    lines.push('他前幾天自己寫的改善動作（請判斷是否有做到、是否該換方向）：');
    recentNotes.forEach((n) => lines.push(`- ${n.date}：${n.action || n.free || ''}`));
  }
  lines.push(
    '請只輸出 JSON（繁體中文，台灣用語）：{"core_symptoms":[{"name":"病症名","why":"為什麼這是根因（引用上面的數字或原話）","evidence":"對應的數據或原話","tomorrow_action":"明天在電話裡具體怎麼做（一句可以照講的話）"}],"pattern":"用兩句話說他的整體模式","one_thing":"如果明天只能改一件事，改什麼"}。core_symptoms 最多 3 個，按影響排序。'
  );
  return lines.join('\n');
}

function stripFence(raw) {
  return String(raw || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
}

/** 解析 AI 診斷 JSON；容錯：外層有 ```json、前後有雜字。 */
export function parseDiagnosis(raw) {
  const text = stripFence(raw);
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        data = JSON.parse(text.slice(s, e + 1));
      } catch {
        data = null;
      }
    }
  }
  if (!data || typeof data !== 'object') throw new Error('AI 回傳格式不是 JSON，請再試一次');
  const str = (v) => (v == null ? '' : String(v).trim());
  const core = Array.isArray(data.core_symptoms) ? data.core_symptoms : [];
  return {
    core_symptoms: core
      .filter((c) => c && (c.name || c.why))
      .slice(0, 3)
      .map((c) => ({ name: str(c.name), why: str(c.why), evidence: str(c.evidence), tomorrow_action: str(c.tomorrow_action) })),
    pattern: str(data.pattern),
    one_thing: str(data.one_thing),
  };
}

/**
 * 日曆格顏色：邀約 ≥ 2 → 'good'（綠）；有填漏斗但邀約 0（或沒填）→ 'zero'（紅）；其餘 ''。
 * 沒填任何數字的日子不上色，避免整個月都變紅。
 */
export function inviteTone(summary) {
  if (!summary) return '';
  const invites = summary.invites == null ? null : Number(summary.invites) || 0;
  if (invites != null && invites >= 2) return 'good';
  if (summary.hasFunnel && !invites) return 'zero';
  return '';
}

/** 月曆格：回傳 6×7 的 dateKey 陣列（前後月補齊），週日開頭 */
export function calendarGrid(year, month /* 1-12 */) {
  const first = new Date(year, month - 1, 1);
  const startOffset = first.getDay();
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month - 1, 1 - startOffset + i);
    cells.push({ key: dateKey(d), day: d.getDate(), inMonth: d.getMonth() === month - 1, weekday: d.getDay() });
  }
  return cells;
}

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${pad2(s % 60)}`;
}
