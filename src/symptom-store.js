/**
 * 開發症狀紀錄的本機儲存（IndexedDB）。錄音 Blob、逐字稿、每日漏斗與筆記全部留在這台電腦的瀏覽器裡。
 * localStorage 的 callCoachHistory 只有幾 MB 上限，放不下多天多通的錄音，所以另開一個 DB。
 * 載入模組本身不碰 indexedDB（node 測試／module-smoke 可安全 import）。
 */
const DB_NAME = 'callCoachSymptomLog';
const DB_VERSION = 1;
const STORE_DAYS = 'days';
const STORE_CALLS = 'calls';
const STORE_AUDIO = 'audio';
const STORE_SETTINGS = 'settings';

let dbPromise = null;

function hasIndexedDb() {
  return typeof indexedDB !== 'undefined' && indexedDB != null;
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 操作失敗'));
  });
}

export function openSymptomDb() {
  if (dbPromise) return dbPromise;
  if (!hasIndexedDb()) return Promise.reject(new Error('此瀏覽器不支援 IndexedDB，無法保存症狀紀錄'));
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE_DAYS)) db.createObjectStore(STORE_DAYS, { keyPath: 'date' });
      if (!db.objectStoreNames.contains(STORE_CALLS)) {
        const calls = db.createObjectStore(STORE_CALLS, { keyPath: 'id' });
        calls.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIO)) db.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_SETTINGS)) db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    open.onerror = () => {
      dbPromise = null;
      reject(open.error || new Error('無法開啟 IndexedDB'));
    };
    open.onblocked = () => reject(new Error('IndexedDB 被其他分頁佔用，請關閉其他 Call Coach 分頁後重試'));
  });
  return dbPromise;
}

async function withStore(name, mode, fn) {
  const db = await openSymptomDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result;
    try {
      const out = fn(store);
      if (out && typeof out.then === 'function') {
        out.then((v) => {
          result = v;
        }, reject);
      } else result = out;
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('IndexedDB 交易失敗'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB 交易中止'));
  });
}

export function newId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------- days ---------- */

export function getDay(date) {
  return withStore(STORE_DAYS, 'readonly', (s) => req(s.get(date)));
}

export function putDay(day) {
  const record = { ...day, updatedAt: Date.now() };
  return withStore(STORE_DAYS, 'readwrite', (s) => req(s.put(record))).then(() => record);
}

export function listDays(fromKey, toKey) {
  const range = fromKey && toKey ? IDBKeyRange.bound(fromKey, toKey) : undefined;
  return withStore(STORE_DAYS, 'readonly', (s) => req(s.getAll(range)));
}

/* ---------- calls ---------- */

export function getCall(id) {
  return withStore(STORE_CALLS, 'readonly', (s) => req(s.get(id)));
}

export function putCall(call) {
  return withStore(STORE_CALLS, 'readwrite', (s) => req(s.put(call))).then(() => call);
}

export function listCalls(date) {
  return withStore(STORE_CALLS, 'readonly', (s) => req(s.index('date').getAll(date))).then((rows) =>
    (rows || []).sort((a, b) => String(a.startTime || '').localeCompare(String(b.startTime || '')) || String(a.name).localeCompare(String(b.name)))
  );
}

export function listCallsBetween(fromKey, toKey) {
  return withStore(STORE_CALLS, 'readonly', (s) => req(s.index('date').getAll(IDBKeyRange.bound(fromKey, toKey))));
}

export async function deleteCall(id) {
  await deleteAudio(id);
  return withStore(STORE_CALLS, 'readwrite', (s) => req(s.delete(id)));
}

/* ---------- audio ---------- */

export function putAudio(id, blob) {
  return withStore(STORE_AUDIO, 'readwrite', (s) => req(s.put({ id, blob, size: blob?.size || 0 })));
}

export function getAudio(id) {
  return withStore(STORE_AUDIO, 'readonly', (s) => req(s.get(id))).then((r) => r?.blob || null);
}

export function deleteAudio(id) {
  return withStore(STORE_AUDIO, 'readwrite', (s) => req(s.delete(id)));
}

/* ---------- settings ---------- */

export const DEFAULT_SETTINGS = { shortMin: 5, longMin: 15, engine: 'gemini' };

export function getSettings() {
  return withStore(STORE_SETTINGS, 'readonly', (s) => req(s.get('main'))).then((r) => ({ ...DEFAULT_SETTINGS, ...(r?.value || {}) }));
}

export async function saveSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await withStore(STORE_SETTINGS, 'readwrite', (s) => req(s.put({ key: 'main', value: next })));
  return next;
}

/* ---------- 月摘要（日曆徽章） ---------- */

/**
 * @returns {Promise<Record<string,{calls:number, analyzed:number, hasFunnel:boolean, hasNote:boolean, symptoms:string[]}>>}
 */
export async function summarizeRange(fromKey, toKey) {
  const [days, calls] = await Promise.all([listDays(fromKey, toKey), listCallsBetween(fromKey, toKey)]);
  const out = {};
  const ensure = (k) => (out[k] ||= { calls: 0, analyzed: 0, hasFunnel: false, hasNote: false, symptoms: [], durations: [] });
  (days || []).forEach((d) => {
    const e = ensure(d.date);
    e.hasFunnel = [d.dialed, d.connected, d.invites].some((v) => v != null && v !== '' && Number(v) > 0);
    const n = d.note || {};
    e.hasNote = !!(n.symptom || n.action || n.verify || n.free);
  });
  (calls || []).forEach((c) => {
    const e = ensure(c.date);
    e.calls += 1;
    if (Number(c.durationSec) > 0) e.durations.push(Number(c.durationSec));
    if (c.symptoms?.keys) {
      e.analyzed += 1;
      c.symptoms.keys.forEach((k) => {
        if (!e.symptoms.includes(k)) e.symptoms.push(k);
      });
    }
  });
  return out;
}

export async function storageEstimate() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    return { usage: usage || 0, quota: quota || 0 };
  } catch {
    return null;
  }
}
