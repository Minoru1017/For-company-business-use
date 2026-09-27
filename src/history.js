/**
 * 最近分析紀錄（只存本機瀏覽器）：分析完自動存一筆，之後可一鍵回看／重跑，
 * 不用再找檔案重新上傳。逐字稿只保留必要欄位，總量有上限。
 */
const KEY = 'callCoachHistory';
export const HISTORY_LIMIT = 20;
const MAX_BYTES = 3 * 1024 * 1024;

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function read() {
  const s = storage();
  if (!s) return [];
  try {
    const arr = JSON.parse(s.getItem(KEY) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(list) {
  const s = storage();
  if (!s) return false;
  let items = list;
  while (items.length) {
    const json = JSON.stringify(items);
    if (json.length <= MAX_BYTES) {
      try {
        s.setItem(KEY, json);
        return true;
      } catch {
        // QuotaExceeded：丟掉最舊的再試
      }
    }
    items = items.slice(0, -1);
  }
  try {
    s.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return false;
}

export function minimalSegs(segs) {
  return (segs || []).map((s) => ({
    start: Math.round((s.start || 0) * 1000) / 1000,
    end: Math.round((s.end || 0) * 1000) / 1000,
    text: String(s.text || ''),
    spk: s.spk === 'C' ? 'C' : 'S',
  }));
}

export function summarizeResult(result) {
  if (!result) return null;
  const steps = Object.values(result.stepHit || {}).filter(Boolean).length;
  return {
    totalDur: result.stats?.totalDur || 0,
    custRatio: result.stats?.custRatio || 0,
    sQuestions: result.stats?.sQuestions || 0,
    steps,
    deepest: result.deepest || 0,
    dominant: result.purposeProfile?.dominant?.label || '',
    badCount: result.bad?.length || 0,
    goodCount: result.good?.length || 0,
  };
}

export function listHistory() {
  return read();
}

export function getHistory(id) {
  return read().find((h) => h.id === id) || null;
}

/** 新增一筆；同一來源在 2 分鐘內重複分析會覆蓋而非新增（避免調標籤重跑塞滿清單）。 */
export function saveHistory({ id = null, source, segs, result, reportText, mode = '' }) {
  const list = read();
  const now = Date.now();
  const entry = {
    id: id || `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: now,
    source: source || 'transcript',
    mode,
    segs: minimalSegs(segs),
    summary: summarizeResult(result),
    reportText: String(reportText || ''),
  };
  const dupIdx = list.findIndex(
    (h) => h.id === entry.id || (h.source === entry.source && now - h.savedAt < 2 * 60 * 1000)
  );
  if (dupIdx >= 0) {
    entry.id = list[dupIdx].id;
    list.splice(dupIdx, 1);
  }
  list.unshift(entry);
  write(list.slice(0, HISTORY_LIMIT));
  return entry;
}

export function updateHistoryReport(id, reportText) {
  const list = read();
  const item = list.find((h) => h.id === id);
  if (!item) return false;
  item.reportText = String(reportText || '');
  return write(list);
}

export function deleteHistory(id) {
  const list = read().filter((h) => h.id !== id);
  return write(list);
}

export function clearHistory() {
  const s = storage();
  try {
    s?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export function formatSavedAt(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Vibe 式側欄：今天／昨天／N 日前／月日 */
export function formatRelativeSavedAt(ts) {
  const t = Number(ts) || 0;
  if (!t) return '';
  const now = Date.now();
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const startSaved = new Date(t);
  startSaved.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  const days = Math.round((startToday - startSaved) / dayMs);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return `${days} 日前`;
  return `${startSaved.getMonth() + 1}月${startSaved.getDate()}日`;
}

const MODE_LABEL = { dev: '電訪', demo: 'DEMO', drill: '陪練', log: '症狀' };

/** 轉錄或載入逐字稿時先記一筆；已有分析摘要的項目不覆寫 summary／reportText。 */
export function upsertRecentTranscript({ source, segs, mode = '' }) {
  const list = read();
  const now = Date.now();
  const src = source || 'transcript';
  const idx = list.findIndex((h) => h.source === src);
  const prev = idx >= 0 ? list[idx] : null;
  const entry = {
    id: prev?.id || `${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    savedAt: now,
    source: src,
    mode: mode || prev?.mode || '',
    segs: minimalSegs(segs),
    summary: prev?.summary ?? null,
    reportText: prev?.reportText || '',
  };
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(entry);
  write(list.slice(0, HISTORY_LIMIT));
  return entry;
}

export function historyItemSubtitle(h) {
  if (!h) return '';
  const rel = formatRelativeSavedAt(h.savedAt);
  const mode = MODE_LABEL[h.mode] || '';
  const s = h.summary;
  if (s?.totalDur) {
    const min = Math.round(s.totalDur / 60);
    const analyzed = s.steps != null ? ` · 已分析` : '';
    return [rel, mode, min ? `${min} 分${analyzed}` : ''].filter(Boolean).join(' · ');
  }
  return [rel, mode, '逐字稿'].filter(Boolean).join(' · ');
}
