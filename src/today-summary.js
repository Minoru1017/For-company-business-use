import { DEFAULT_THRESHOLDS, funnelFromCalls, parseDateKey, shiftDateKey } from './symptom-engine.js';

export const ACTION_LOOKBACK_DAYS = 14;

/** 本週＝週一到今天（含） */
export function weekStartKey(todayKey) {
  const dow = parseDateKey(todayKey).getDay();
  return shiftDateKey(todayKey, -((dow + 6) % 7));
}

/**
 * 首頁主句：今天以前最近一次寫下的「明天只改一件事」。
 * 今天已寫的不算——那是給明天的，今天要執行的是前一次的承諾。
 */
export function latestCommitment(days = [], todayKey) {
  const from = shiftDateKey(todayKey, -ACTION_LOOKBACK_DAYS);
  const hit = [...days]
    .filter((d) => d?.date && d.date < todayKey && d.date >= from && String(d.note?.action || '').trim())
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!hit) return null;
  return {
    date: hit.date,
    action: String(hit.note.action).trim(),
    symptom: String(hit.note.symptom || '').trim(),
    verify: String(hit.note.verify || '').trim(),
    daysAgo: Math.round((parseDateKey(todayKey) - parseDateKey(hit.date)) / 86400000),
  };
}

export function commitmentLabel(daysAgo) {
  if (daysAgo === 1) return '昨天你說要改的';
  if (daysAgo === 2) return '前天你說要改的';
  return `${daysAgo} 天前你說要改的`;
}

/** 本週留存＝>N 分通數 ÷ 接通；邀約＝進邀約加總。沒有接通就回 null，畫面顯示「—」 */
export function weekFunnel(days = [], summary = {}, thresholds = DEFAULT_THRESHOLDS) {
  let connected = 0;
  let over = 0;
  let invites = 0;
  let dialed = 0;
  const byKey = Object.fromEntries(days.map((d) => [d.date, d]));
  const keys = new Set([...Object.keys(byKey), ...Object.keys(summary)]);
  keys.forEach((k) => {
    const day = byKey[k] || {};
    const durations = summary[k]?.durations || [];
    const f = funnelFromCalls(day, durations.map((sec) => ({ durationSec: sec })), thresholds);
    connected += f.connected;
    over += f.over;
    invites += f.invites;
    dialed += f.dialed;
  });
  return { dialed, connected, over, invites, retention: connected > 0 ? over / connected : null };
}
