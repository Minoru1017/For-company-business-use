/**
 * 全部備份／還原：把這台電腦瀏覽器裡的 Call Coach 資料（localStorage＋IndexedDB，含錄音與簡報圖片）
 * 打包成一個 .zip；清除瀏覽器資料、換電腦或換瀏覽器後可以整包還原。
 *
 * zip 內容：manifest.json、localStorage.json、idb/<資料庫>/<資料表>.json，二進位（錄音 Blob 等）放 bin/。
 * 只碰 Call Coach 自己的 key：GitHub Pages 同網域（minoru1017.github.io）的其他網站共用同一份 localStorage。
 */
import { openSymptomDb } from './symptom-store.js';
import { openDb as openMeetingAudioDb } from './meeting-audio-store.js';
import { openDb as openDeckImageDb } from './demo-deck-images.js';

export const BACKUP_APP = 'sales-call-coach';
export const BACKUP_FORMAT = 1;
export const LAST_BACKUP_KEY = 'callCoachLastBackupAt';
export const BACKUP_REMIND_DAYS = 7;

const KEY_PREFIXES = ['callCoach', 'call_coach'];
const EXTRA_KEYS = ['gemini_key', 'gemini_limit', 'gemini_model', 'gemini_remember_key', 'gemini_usage', 'dev_notes_agent_name'];
/** 金鑰與 Token：預設不進備份；還原時保留這台電腦原本的值 */
export const SECRET_KEYS = ['gemini_key', 'callCoachBrowserWorkerToken'];

export function isAppKey(key) {
  if (!key || key === LAST_BACKUP_KEY) return false;
  return EXTRA_KEYS.includes(key) || KEY_PREFIXES.some((p) => key.startsWith(p));
}

function appKeys(storage) {
  const keys = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (isAppKey(k)) keys.push(k);
  }
  return keys.sort();
}

export function collectLocalStorage(storage, { includeSecrets = false } = {}) {
  const out = {};
  appKeys(storage).forEach((k) => {
    if (!includeSecrets && SECRET_KEYS.includes(k)) return;
    out[k] = storage.getItem(k);
  });
  return out;
}

/**
 * @typedef {object} DbSpec
 * @property {string} name IndexedDB 名稱
 * @property {string} label 給使用者看的名稱
 * @property {() => Promise<IDBDatabase>} open 用模組自己的開啟函式（確保資料表結構與 App 一致）
 * @property {Record<string,string>} stores 資料表 → 顯示名稱
 * @property {string[]} [audioStores] 錄音資料表（可選擇不備份）
 * @property {Record<string,string[]>} [secretFields] 資料表 → 金鑰欄位路徑（如 value.scriptToken）
 */

/** @returns {DbSpec[]} */
export function appDatabases() {
  return [
    {
      name: 'callCoachSymptomLog',
      label: '症狀紀錄',
      open: openSymptomDb,
      stores: { days: '每日紀錄', calls: '通話', audio: '通話錄音', settings: '設定' },
      audioStores: ['audio'],
      secretFields: { settings: ['value.scriptToken'] },
    },
    {
      name: 'callCoachMeetingAudio',
      label: '主管早會錄音',
      open: openMeetingAudioDb,
      stores: { sessions: '錄音場次', chunks: '錄音片段' },
      audioStores: ['chunks'],
    },
    {
      name: 'callCoachDeckImages',
      label: 'DEMO 簡報圖片',
      open: openDeckImageDb,
      stores: { images: '圖片' },
    },
  ];
}

/* ---------- 值的序列化：Blob／ArrayBuffer 拆成 bin/ 檔，Date 轉字串 ---------- */

const isPlainObject = (v) => Object.prototype.toString.call(v) === '[object Object]';

async function pack(value, addBin) {
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    const ref = { __ccbin: addBin(new Uint8Array(await value.arrayBuffer())), kind: 'blob', type: value.type || '' };
    if (typeof value.name === 'string') ref.name = value.name;
    return ref;
  }
  if (value instanceof ArrayBuffer) return { __ccbin: addBin(new Uint8Array(value.slice(0))), kind: 'arraybuffer' };
  if (ArrayBuffer.isView(value)) return { __ccbin: addBin(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()), kind: 'u8' };
  if (value instanceof Date) return { __ccdate: value.toISOString() };
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) out.push(await pack(v, addBin));
    return out;
  }
  if (isPlainObject(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = await pack(v, addBin);
    return out;
  }
  return value;
}

async function unpack(value, readBin) {
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) out.push(await unpack(v, readBin));
    return out;
  }
  if (!isPlainObject(value)) return value;
  if (typeof value.__ccbin === 'string') {
    const bytes = await readBin(value.__ccbin);
    if (value.kind === 'arraybuffer') return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    if (value.kind === 'u8') return bytes;
    if (value.name != null && typeof File !== 'undefined') return new File([bytes], value.name, { type: value.type || '' });
    return new Blob([bytes], { type: value.type || '' });
  }
  if (typeof value.__ccdate === 'string' && Object.keys(value).length === 1) return new Date(value.__ccdate);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = await unpack(v, readBin);
  return out;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function setPath(obj, path, val) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) {
    if (!isPlainObject(o[k])) return;
    o = o[k];
  }
  o[keys.at(-1)] = val;
}

/* ---------- IndexedDB 小工具 ---------- */

function idbReq(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** 讀整張資料表；沒有 keyPath 的資料表連 key 一起存成 {k, v} */
async function readStore(db, name) {
  const t = db.transaction(name, 'readonly');
  const store = t.objectStore(name);
  const values = await idbReq(store.getAll());
  if (store.keyPath != null) return values;
  const keys = await idbReq(store.getAllKeys());
  return values.map((v, i) => ({ k: keys[i], v }));
}

function writeStores(db, entries) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(
      entries.map((e) => e.store),
      'readwrite'
    );
    for (const { store, rows } of entries) {
      const s = t.objectStore(store);
      s.clear();
      rows.forEach((r) => (s.keyPath != null ? s.put(r) : s.put(r.v, r.k)));
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('還原中斷'));
  });
}

async function tryOpen(spec) {
  try {
    return await spec.open();
  } catch {
    return null;
  }
}

/* ---------- 備份 ---------- */

/**
 * 建立備份 zip（不產生檔案，呼叫端決定 generateAsync 的型別）
 * @returns {Promise<{zip: any, manifest: object}>}
 */
export async function createBackup({
  JSZip,
  storage,
  databases = appDatabases(),
  includeSecrets = false,
  includeAudio = true,
  appVersion = '',
  now = new Date(),
  onProgress,
}) {
  const zip = new JSZip();
  const ls = collectLocalStorage(storage, { includeSecrets });
  zip.file('localStorage.json', JSON.stringify(ls));
  const manifest = {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    appVersion,
    createdAt: now.toISOString(),
    includeSecrets,
    includeAudio,
    localStorage: Object.keys(ls).length,
    databases: {},
    binaryBytes: 0,
  };
  let seq = 0;
  const addBin = (bytes) => {
    seq += 1;
    const path = `bin/${String(seq).padStart(6, '0')}`;
    zip.file(path, bytes, { binary: true, compression: 'STORE' });
    manifest.binaryBytes += bytes.byteLength;
    return path;
  };
  for (const spec of databases) {
    const db = await tryOpen(spec);
    if (!db) continue;
    const counts = {};
    for (const store of Object.keys(spec.stores)) {
      if (!includeAudio && spec.audioStores?.includes(store)) continue;
      if (!db.objectStoreNames.contains(store)) continue;
      onProgress?.(`讀取${spec.label}・${spec.stores[store]}…`);
      const rows = await readStore(db, store);
      const packed = [];
      for (const row of rows) {
        const v = await pack(row, addBin);
        if (!includeSecrets) (spec.secretFields?.[store] || []).forEach((p) => getPath(v, p) && setPath(v, p, ''));
        packed.push(v);
      }
      zip.file(`idb/${spec.name}/${store}.json`, JSON.stringify(packed));
      counts[store] = rows.length;
    }
    manifest.databases[spec.name] = counts;
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  return { zip, manifest };
}

export function backupFileName(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `CallCoach-備份-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.zip`;
}

/* ---------- 讀取／還原 ---------- */

export async function readBackup(JSZip, data) {
  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('這不是 Call Coach 備份檔（無法解壓縮）');
  }
  const mf = zip.file('manifest.json');
  if (!mf) throw new Error('這不是 Call Coach 備份檔（缺少 manifest.json）');
  let manifest;
  try {
    manifest = JSON.parse(await mf.async('string'));
  } catch {
    throw new Error('備份檔已損壞（manifest.json 無法讀取）');
  }
  if (manifest?.app !== BACKUP_APP) throw new Error('這不是 Call Coach 備份檔');
  if (!(manifest.format <= BACKUP_FORMAT)) throw new Error('這個備份檔來自較新版本的 Call Coach，請先重新整理頁面更新後再還原');
  return { zip, manifest };
}

/** 給確認畫面用的摘要：[{label, count}] */
export function summarizeBackup(manifest, databases = appDatabases()) {
  const rows = [{ label: '設定與文字紀錄（複盤、簡報、歷史、陪練…）', count: manifest.localStorage || 0 }];
  databases.forEach((spec) => {
    const counts = manifest.databases?.[spec.name];
    if (!counts) return;
    Object.entries(counts).forEach(([store, n]) => n > 0 && rows.push({ label: `${spec.label}・${spec.stores[store] || store}`, count: n }));
  });
  return rows;
}

/**
 * 用備份取代這台電腦的 Call Coach 資料。
 * 先把整包解開（檔案有問題就在動到任何資料前失敗），每個資料庫在單一交易裡清空＋寫入；
 * 備份裡沒有的資料表（例如不含錄音的備份）保留原狀。
 */
export async function restoreBackup({ zip, manifest }, { storage, databases = appDatabases(), onProgress } = {}) {
  const lsFile = zip.file('localStorage.json');
  if (!lsFile) throw new Error('備份檔已損壞（缺少 localStorage.json）');
  const ls = JSON.parse(await lsFile.async('string'));
  const readBin = async (path) => {
    const f = zip.file(path);
    if (!f) throw new Error(`備份檔已損壞（缺少 ${path}）`);
    return f.async('uint8array');
  };

  const plans = [];
  for (const spec of databases) {
    const counts = manifest.databases?.[spec.name];
    if (!counts) continue;
    const entries = [];
    for (const store of Object.keys(counts)) {
      const f = zip.file(`idb/${spec.name}/${store}.json`);
      if (!f) throw new Error(`備份檔已損壞（缺少 ${spec.label}・${store}）`);
      onProgress?.(`解開${spec.label}・${spec.stores[store] || store}…`);
      entries.push({ store, rows: await unpack(JSON.parse(await f.async('string')), readBin) });
    }
    plans.push({ spec, entries });
  }

  for (const { spec, entries } of plans) {
    const db = await spec.open();
    const usable = entries.filter((e) => db.objectStoreNames.contains(e.store));
    if (!manifest.includeSecrets) await keepLocalSecrets(db, spec, usable);
    onProgress?.(`寫入${spec.label}…`);
    if (usable.length) await writeStores(db, usable);
  }

  onProgress?.('寫入設定與文字紀錄…');
  const before = collectLocalStorage(storage, { includeSecrets: true });
  const keep = manifest.includeSecrets ? [] : SECRET_KEYS;
  try {
    Object.keys(before).forEach((k) => !keep.includes(k) && storage.removeItem(k));
    Object.entries(ls).forEach(([k, v]) => isAppKey(k) && typeof v === 'string' && storage.setItem(k, v));
  } catch (err) {
    Object.keys(collectLocalStorage(storage, { includeSecrets: true })).forEach((k) => storage.removeItem(k));
    Object.entries(before).forEach(([k, v]) => storage.setItem(k, v));
    throw new Error(`設定與文字紀錄還原失敗，已恢復原狀（${err?.message || err}）`);
  }
  if (manifest.createdAt && !storage.getItem(LAST_BACKUP_KEY)) storage.setItem(LAST_BACKUP_KEY, manifest.createdAt);
}

/** 備份不含金鑰時：把這台電腦原本的金鑰欄位補回要寫入的資料 */
async function keepLocalSecrets(db, spec, entries) {
  for (const e of entries) {
    const paths = spec.secretFields?.[e.store];
    if (!paths?.length) continue;
    const current = await readStore(db, e.store);
    const keyPath = db.transaction(e.store, 'readonly').objectStore(e.store).keyPath;
    if (typeof keyPath !== 'string') continue;
    const byKey = new Map(current.map((r) => [r[keyPath], r]));
    e.rows.forEach((row) => {
      const old = byKey.get(row[keyPath]);
      paths.forEach((p) => {
        const v = getPath(old, p);
        if (v && !getPath(row, p)) setPath(row, p, v);
      });
    });
  }
}

/* ---------- 提醒 ---------- */

/** @returns {{lastAt: string|null, days: number|null, due: boolean}} */
export function backupStatus(storage, now = Date.now()) {
  const lastAt = storage.getItem(LAST_BACKUP_KEY) || null;
  const t = lastAt ? Date.parse(lastAt) : NaN;
  const days = Number.isFinite(t) ? Math.floor((now - t) / 86400000) : null;
  const hasData = appKeys(storage).length > 0;
  return { lastAt, days, due: days == null ? hasData : days >= BACKUP_REMIND_DAYS };
}

export function markBackedUp(storage, now = new Date()) {
  storage.setItem(LAST_BACKUP_KEY, now.toISOString());
}
