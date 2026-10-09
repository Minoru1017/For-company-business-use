/**
 * 開發症狀紀錄 · 每月總結（主管复盘四问）
 */
import { summarizeDrills } from './drill-log.js';

export const MONTHLY_REVIEW_FIELDS = [
  {
    key: 'q1',
    label: '這個月你花了多少時間？你都在什麼時候分析？回頭看，自己哪裡卡住？',
    placeholder: '例：開發約 40 小時；多半晚上 8–10 點聽錄音；卡在邀約前講太多服務…',
  },
  {
    key: 'q2',
    label: '你是怎麼分析的？聽了什麼、看了什麼？找出了哪些具體問題？（請列 2～3 個）',
    placeholder: '例：聽了 9/12 短通；看了 Terry 8/25；問題①太早推方案 ②沒問清時間…',
  },
  {
    key: 'q3',
    label: '用這個分析結果，你這個月具體哪裡進步了？',
    placeholder: '例：>5 分通變多、開始會問客戶「不做的話會怎樣」…',
  },
  {
    key: 'q4',
    label: null, // 動態：下個月
    placeholder: '例：10 月每天三通自寫複盤；每週只改「邀約前多問一層」…',
  },
];

export function reviewMonthKey(year, month) {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function nextMonthLabel(year, month) {
  const d = new Date(year, month, 1);
  return `${d.getMonth() + 1} 月`;
}

export function q4Label(year, month) {
  return `${nextMonthLabel(year, month)}的會想要怎麼做？具體行動是什麼？`;
}

export function emptyMonthlyReview() {
  return { q1: '', q2: '', q3: '', q4: '', updatedAt: 0 };
}

export function getMonthlyReviewFromSettings(settings, year, month) {
  const key = reviewMonthKey(year, month);
  const bag = settings?.monthlyReviews || {};
  return { key, ...emptyMonthlyReview(), ...(bag[key] || {}) };
}

export function patchMonthlyReviews(settings, year, month, patch) {
  const key = reviewMonthKey(year, month);
  const bag = { ...(settings?.monthlyReviews || {}) };
  bag[key] = { ...emptyMonthlyReview(), ...(bag[key] || {}), ...patch, updatedAt: Date.now() };
  return bag;
}

export function monthlyReviewFilled(review) {
  return MONTHLY_REVIEW_FIELDS.every((f) => String(review?.[f.key] || '').trim().length >= 8);
}

/**
 * 從當月彙總產生提示（輔助填 Q1/Q2，非代替自寫）
 */
export function buildMonthlyStatsHint(stats) {
  if (!stats) return '';
  const parts = [];
  if (stats.analyzedCalls > 0) {
    parts.push(`本機紀錄：已分析 ${stats.analyzedCalls} 通`);
    if (stats.totalTalkMin > 0) parts.push(`錄音合計約 ${stats.totalTalkMin} 分鐘`);
  }
  if (stats.daysWithNotes > 0) parts.push(`${stats.daysWithNotes} 天有改善筆記`);
  if (stats.daysWithDiagnosis > 0) parts.push(`${stats.daysWithDiagnosis} 天做過 AI 共同病症診斷`);
  if (stats.topSymptoms?.length) parts.push(`常見病症：${stats.topSymptoms.join('、')}`);
  const d = stats.drills;
  if (d?.count) {
    let line = `陪練 ${d.count} 次（${d.days} 天）、平均 ${d.avgScore} 分`;
    if (d.prevAvgScore != null) line += `，比上月${formatDelta(d.avgScore - d.prevAvgScore)}`;
    else if (d.trend != null) line += `，月中後段比前段${formatDelta(d.trend)}`;
    parts.push(line);
  }
  if (!parts.length) return '這個月尚無批次分析紀錄——數字會在你分析錄音後自動出現，但仍請用自己的話回答四問。';
  return `數據提示（僅輔助）：${parts.join('；')}。`;
}

export function formatDelta(n) {
  const v = Math.round(Number(n) * 10) / 10;
  if (!Number.isFinite(v) || v === 0) return '持平';
  return v > 0 ? `進步 ${v} 分` : `退步 ${Math.abs(v)} 分`;
}

export function monthRange(year, month) {
  const lastDay = new Date(year, month, 0).getDate();
  return { from: `${reviewMonthKey(year, month)}-01`, to: `${reviewMonthKey(year, month)}-${String(lastDay).padStart(2, '0')}` };
}

/** 當月陪練彙總，並帶上個月平均分做比較 */
export function monthlyDrillStats(drillLog, year, month) {
  const cur = monthRange(year, month);
  const stats = summarizeDrills(drillLog, cur.from, cur.to);
  const prevDate = new Date(year, month - 2, 1);
  const prev = monthRange(prevDate.getFullYear(), prevDate.getMonth() + 1);
  const prevStats = summarizeDrills(drillLog, prev.from, prev.to);
  return { ...stats, prevCount: prevStats.count, prevAvgScore: prevStats.avgScore };
}

export async function computeMonthlyStats({ year, month, summarizeRange, listDays, listCallsBetween, drillLog = [] }) {
  const { from, to } = monthRange(year, month);
  const [summary, days, calls] = await Promise.all([
    summarizeRange(from, to),
    listDays(from, to),
    listCallsBetween(from, to),
  ]);
  let analyzedCalls = 0;
  let totalTalkSec = 0;
  const symCount = {};
  (calls || []).forEach((c) => {
    if (c.symptoms?.keys) analyzedCalls += 1;
    if (Number(c.durationSec) > 0) totalTalkSec += Number(c.durationSec);
    (c.symptoms?.keys || []).forEach((k) => {
      symCount[k] = (symCount[k] || 0) + 1;
    });
  });
  let daysWithNotes = 0;
  let daysWithDiagnosis = 0;
  (days || []).forEach((d) => {
    const n = d.note || {};
    if (n.symptom || n.action || n.verify || n.free) daysWithNotes += 1;
    if (d.diagnosis?.at) daysWithDiagnosis += 1;
  });
  const topSymptoms = Object.entries(symCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k]) => k);
  let invites = 0;
  let over = 0;
  Object.keys(summary || {}).forEach((k) => {
    invites += Number(summary[k].invites) || 0;
    over += Number(summary[k].over) || 0;
  });
  return {
    analyzedCalls,
    totalTalkMin: Math.round(totalTalkSec / 60),
    daysWithNotes,
    daysWithDiagnosis,
    topSymptoms,
    invites,
    over,
    drills: monthlyDrillStats(drillLog, year, month),
  };
}
