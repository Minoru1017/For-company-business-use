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
