/**
 * 非上班日學習進度庫（本機 localStorage）
 * 要求：一支或若干影片，分別寫 AI 趨勢與銷售技巧心得。
 */

export const LEARNING_STORAGE_KEY = 'call_coach_learning_library_v1';

export const FIELD_MIN = 16;

function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadRoot() {
  try {
    const raw = localStorage.getItem(LEARNING_STORAGE_KEY);
    if (!raw) return { entries: [] };
    const j = JSON.parse(raw);
    return j?.entries ? j : { entries: [] };
  } catch {
    return { entries: [] };
  }
}

function saveRoot(root) {
  localStorage.setItem(LEARNING_STORAGE_KEY, JSON.stringify(root));
}

export function listLearningEntries() {
  return loadRoot().entries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getLearningEntry(id) {
  return listLearningEntries().find((e) => e.id === id) || null;
}

export function fieldOk(text) {
  return String(text || '').trim().length >= FIELD_MIN;
}

/** 一筆紀錄是否算「填完」 */
export function isLearningEntryComplete(entry) {
  if (!entry) return false;
  const hasSource = String(entry.videoUrl || '').trim().length > 8 || String(entry.videoTitle || '').trim().length >= 4;
  return (
    hasSource &&
    fieldOk(entry.aiTakeaway) &&
    fieldOk(entry.salesTakeaway) &&
    fieldOk(entry.learnedSummary)
  );
}

export function hasLearningForDate(dateKey = todayKey()) {
  return listLearningEntries().some((e) => e.dateKey === dateKey && isLearningEntryComplete(e));
}

export function addLearningEntry(payload) {
  const entry = {
    id: `lr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    dateKey: payload.dateKey || todayKey(),
    videoUrl: String(payload.videoUrl || '').trim(),
    videoTitle: String(payload.videoTitle || '').trim(),
    aiTakeaway: String(payload.aiTakeaway || '').trim(),
    salesTakeaway: String(payload.salesTakeaway || '').trim(),
    learnedSummary: String(payload.learnedSummary || '').trim(),
    createdAt: Date.now(),
  };
  if (!isLearningEntryComplete(entry)) {
    throw new Error('INCOMPLETE');
  }
  const root = loadRoot();
  root.entries.push(entry);
  saveRoot(root);
  return entry;
}

export function deleteLearningEntry(id) {
  const root = loadRoot();
  root.entries = root.entries.filter((e) => e.id !== id);
  saveRoot(root);
}

export function learningStats() {
  const entries = listLearningEntries().filter(isLearningEntryComplete);
  const dates = new Set(entries.map((e) => e.dateKey));
  return { total: entries.length, days: dates.size };
}
