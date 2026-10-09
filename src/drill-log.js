/**
 * 陪練紀錄：每次陪練結束存一筆分數摘要（不存逐句內容），給陪練首頁與每月總結看練習量與分數趨勢。
 * 存 localStorage（callCoach 前綴，全部備份會一起帶走）。
 */
export const DRILL_LOG_KEY = 'callCoachDrillLog';
export const DRILL_LOG_MAX = 1000;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function localDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function loadDrillLog(storage = globalThis.localStorage) {
  try {
    const raw = JSON.parse(storage?.getItem(DRILL_LOG_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((e) => e && Number.isFinite(e.at) && Number.isFinite(e.score)) : [];
  } catch {
    return [];
  }
}

/** 從 sessionStats 結果組一筆紀錄 */
export function drillLogEntry({ session, stats, focus = null, now = Date.now() }) {
  return {
    at: now,
    date: localDateKey(now),
    track: session?.track || 'full',
    persona: session?.persona?.key || '',
    difficulty: session?.difficulty || '',
    score: stats.score,
    verdict: stats.verdict,
    endReason: stats.endReason || '',
    lines: stats.salesLines,
    timeouts: stats.timeouts,
    fear: stats.fear,
    tooEarly: stats.tooEarly,
    canned: stats.canned,
    goodQuestions: stats.goodQuestions,
    generalLayers: stats.generalLayers,
    focus: focus?.key || '',
    focusMet: focus ? !!focus.met : null,
  };
}

export function appendDrillLog(entry, storage = globalThis.localStorage) {
  const list = loadDrillLog(storage);
  list.push(entry);
  const trimmed = list.slice(-DRILL_LOG_MAX);
  try {
    storage?.setItem(DRILL_LOG_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota full：陪練本身不受影響 */
  }
  return trimmed;
}

const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);

/**
 * 依日期區間（含頭尾，'YYYY-MM-DD'）彙總。
 * trend＝區間後半次數的平均分 − 前半次數的平均分（至少 4 次才算）。
 */
export function summarizeDrills(log, fromKey, toKey) {
  const items = (log || []).filter((e) => e.date >= fromKey && e.date <= toKey).sort((a, b) => a.at - b.at);
  const scores = items.map((e) => e.score);
  const byDay = new Map();
  items.forEach((e) => {
    const cur = byDay.get(e.date) || [];
    cur.push(e.score);
    byDay.set(e.date, cur);
  });
  const half = Math.floor(scores.length / 2);
  const trend = scores.length >= 4 ? Math.round((avg(scores.slice(scores.length - half)) - avg(scores.slice(0, half))) * 10) / 10 : null;
  const focused = items.filter((e) => e.focus);
  return {
    count: items.length,
    days: byDay.size,
    avgScore: avg(scores),
    bestScore: scores.length ? Math.max(...scores) : null,
    trend,
    icebreak: items.filter((e) => e.track === 'icebreak').length,
    full: items.filter((e) => e.track !== 'icebreak').length,
    focusCount: focused.length,
    focusMet: focused.filter((e) => e.focusMet).length,
    daily: [...byDay.entries()].map(([date, xs]) => ({ date, count: xs.length, avg: avg(xs) })),
  };
}
