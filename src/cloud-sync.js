/**
 * 雲端同步：登入（Email 驗證碼）＋把整份 Call Coach 資料加密後存到自己的雲端帳號。
 *
 * - 後端是 Supabase（Auth＋Storage），直接打 REST，不載 SDK。
 * - 資料格式沿用「全部備份」的 zip（不含錄音、不含 API Key／Token），在瀏覽器裡用「同步密碼」
 *   AES-GCM 加密後才上傳；雲端只看得到密文，忘記同步密碼就無法解開。
 * - 一個帳號一份快照：meta.json 記版本（rev）、時間、裝置，snapshot 檔名帶 rev，換版後刪舊檔。
 * - 衝突判斷：這台裝置記得上次同步的 rev 與內容指紋；雲端 rev 變了＝別台裝置更新過，
 *   指紋變了＝這台有尚未上傳的變更，兩者同時發生就要使用者自己選。
 */
import { createBackup, readBackup, restoreBackup } from './backup.js';

export const CLOUD_BUCKET = 'callcoach-sync';
export const CLOUD_KEY_PREFIX = 'callCoachCloud';
export const CLOUD_SESSION_KEY = 'callCoachCloudSession';
export const CLOUD_CRYPTO_KEY = 'callCoachCloudKey';
export const CLOUD_STATE_KEY = 'callCoachCloudState';
export const CLOUD_CONFIG_KEY = 'callCoachCloudConfig';
export const CLOUD_DEVICE_KEY = 'callCoachCloudDevice';
export const CLOUD_FORMAT = 1;
export const MAX_SNAPSHOT_BYTES = 45 * 1024 * 1024;

const MAGIC = [0x43, 0x43, 0x53, 0x31]; // "CCS1"
const KDF_ITERATIONS = 310000;
const KEY_CHECK_TEXT = 'call-coach-sync-key-check';

export class CloudError extends Error {
  constructor(message, code = '', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/* ---------- 設定 ---------- */

function env(name) {
  try {
    return import.meta.env?.[name] || '';
  } catch {
    return '';
  }
}

/** 公司的 Supabase 專案；anon key 是設計給瀏覽器用的公開金鑰，資料權限由 Storage policy 控管 */
export const BUILT_IN_CLOUD = {
  url: 'https://tgmpwiuavzuzsqjcftrj.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRnbXB3aXVhdnp1enNxamNmdHJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NDM5MDIsImV4cCI6MjEwNzUxOTkwMn0.CK7B4_N-IfV9aOPxhJOs0xzHgQWBMlebisBiEwTk1JE',
};

/** 優先序：這台裝置手動填的設定 → 建置時的 VITE_SUPABASE_URL／VITE_SUPABASE_ANON_KEY → 內建專案 */
export function cloudConfig(storage) {
  let saved = {};
  try {
    saved = JSON.parse(storage?.getItem(CLOUD_CONFIG_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  const url = String(saved.url || env('VITE_SUPABASE_URL') || BUILT_IN_CLOUD.url).trim().replace(/\/+$/, '');
  const anonKey = String(saved.anonKey || env('VITE_SUPABASE_ANON_KEY') || BUILT_IN_CLOUD.anonKey).trim();
  return { url, anonKey, configured: /^https:\/\/\S+$/i.test(url) && anonKey.length > 20, custom: !!saved.url };
}

export function saveCloudConfig(storage, { url = '', anonKey = '' } = {}) {
  if (!url && !anonKey) storage.removeItem(CLOUD_CONFIG_KEY);
  else storage.setItem(CLOUD_CONFIG_KEY, JSON.stringify({ url: url.trim(), anonKey: anonKey.trim() }));
}

export function defaultDeviceName(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '') {
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Linux';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '瀏覽器';
  return `${os} ${br}`;
}

export function deviceName(storage) {
  return String(storage.getItem(CLOUD_DEVICE_KEY) || '').trim() || defaultDeviceName();
}

const readJson = (storage, key) => {
  try {
    return JSON.parse(storage.getItem(key) || 'null');
  } catch {
    return null;
  }
};

/* ---------- 位元組小工具 ---------- */

export function toBase64(bytes) {
  let s = '';
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  const bin = atob(String(text || ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
const randomId = () => toBase64(randomBytes(9)).replace(/[+/=]/g, (c) => ({ '+': '-', '/': '_', '=': '' })[c]);

/* ---------- 加密 ---------- */

export async function deriveKey(passphrase, salt, iterations = KDF_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC, 0);
  out.set(iv, 4);
  out.set(ct, 16);
  return out;
}

export async function decryptBytes(key, data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < 17 || MAGIC.some((b, i) => u8[i] !== b)) throw new CloudError('雲端檔案格式不對（不是 Call Coach 同步檔）', 'format');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(4, 16) }, key, u8.subarray(16)));
  } catch {
    throw new CloudError('同步密碼不對，無法解開雲端資料', 'bad-key');
  }
}

async function makeKeyCheck(key) {
  return toBase64(await encryptBytes(key, new TextEncoder().encode(KEY_CHECK_TEXT)));
}

export async function verifyKey(key, meta) {
  if (!meta?.keyCheck) return true;
  try {
    return new TextDecoder().decode(await decryptBytes(key, fromBase64(meta.keyCheck))) === KEY_CHECK_TEXT;
  } catch {
    return false;
  }
}

/** 記住在這台裝置：存 raw key＋對應的 salt（換了 salt 就要重新輸入密碼） */
export async function rememberKey(storage, key, salt) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  storage.setItem(CLOUD_CRYPTO_KEY, JSON.stringify({ key: toBase64(raw), salt }));
}

export async function loadRememberedKey(storage, salt) {
  const saved = readJson(storage, CLOUD_CRYPTO_KEY);
  if (!saved?.key || (salt && saved.salt !== salt)) return null;
  try {
    return await crypto.subtle.importKey('raw', fromBase64(saved.key), { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  } catch {
    return null;
  }
}

/* ---------- 快照 ---------- */

/** 備份內容指紋：排除 manifest（含時間戳），其他檔案依名稱排序後雜湊 */
export async function zipFingerprint(zip) {
  const names = Object.keys(zip.files)
    .filter((n) => n !== 'manifest.json' && !zip.files[n].dir)
    .sort();
  const enc = new TextEncoder();
  const parts = [];
  for (const n of names) {
    parts.push(enc.encode(`\u0000${n}\u0000`));
    parts.push(await zip.file(n).async('uint8array'));
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const all = new Uint8Array(total);
  let o = 0;
  parts.forEach((p) => {
    all.set(p, o);
    o += p.length;
  });
  return toBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', all)));
}

export async function buildSnapshot({ JSZip, storage, databases, appVersion = '', now = new Date(), onProgress }) {
  const { zip, manifest } = await createBackup({ JSZip, storage, databases, includeAudio: false, includeSecrets: false, appVersion, now, onProgress });
  const fingerprint = await zipFingerprint(zip);
  onProgress?.('壓縮中…');
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { bytes, manifest, fingerprint };
}

export async function localFingerprint({ JSZip, storage, databases }) {
  const { zip } = await createBackup({ JSZip, storage, databases, includeAudio: false, includeSecrets: false });
  return zipFingerprint(zip);
}

/* ---------- 同步狀態 ---------- */

export function loadSyncState(storage) {
  return readJson(storage, CLOUD_STATE_KEY);
}

function saveSyncState(storage, state) {
  storage.setItem(CLOUD_STATE_KEY, JSON.stringify(state));
}

/**
 * @returns {'empty'|'synced'|'local-ahead'|'cloud-ahead'|'conflict'}
 *  empty：雲端還沒有資料；first-link 的衝突用 reason 區分
 */
export function compareSync({ meta, state, fingerprint, hasLocalData = true }) {
  if (!meta) return { status: 'empty' };
  if (!state?.rev) return hasLocalData ? { status: 'conflict', reason: 'first-link' } : { status: 'cloud-ahead' };
  const dirty = !!fingerprint && fingerprint !== state.fingerprint;
  if (meta.rev === state.rev) return { status: dirty ? 'local-ahead' : 'synced' };
  return dirty ? { status: 'conflict', reason: 'both-changed' } : { status: 'cloud-ahead' };
}

/* ---------- 登入信連結回到網站 ---------- */

/**
 * Supabase 登入連結會回到網站並在網址 # 後面帶 access_token（或 error）。
 * 要在 App 讀 hash 決定模式之前取走，並把網址清乾淨，避免 token 留在網址列與瀏覽紀錄。
 * @returns {null | {tokens: object} | {error: string}}
 */
export function takeAuthRedirect(loc = typeof location !== 'undefined' ? location : null, hist = typeof history !== 'undefined' ? history : null) {
  const hash = String(loc?.hash || '').replace(/^#/, '');
  if (!/(^|&)(access_token|error_description|error_code)=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  try {
    hist?.replaceState(null, '', `${loc.pathname}${loc.search || ''}`);
  } catch {
    /* 無法改網址就算了 */
  }
  if (p.get('access_token')) {
    return {
      tokens: {
        access_token: p.get('access_token'),
        refresh_token: p.get('refresh_token') || '',
        expires_in: Number(p.get('expires_in')) || 3600,
        expires_at: Number(p.get('expires_at')) || 0,
      },
    };
  }
  const code = p.get('error_code') || '';
  const desc = p.get('error_description') || '';
  return { error: /expired|invalid/i.test(`${code} ${desc}`) ? '登入連結已過期或已使用過，請重新寄送登入信' : `登入失敗：${desc || code}` };
}

/* ---------- Supabase 用戶端 ---------- */

export function createCloudClient({ storage, fetchImpl = (...a) => fetch(...a), config = cloudConfig(storage), now = () => Date.now() }) {
  const base = config.url;
  const headers = (extra = {}) => ({ apikey: config.anonKey, ...extra });

  async function errorOf(res, fallback) {
    let body = {};
    try {
      body = await res.json();
    } catch {
      /* 非 JSON */
    }
    const msg = body.error_description || body.msg || body.message || body.error || fallback;
    const code = String(body.error_code || body.code || body.error || body.statusCode || '');
    return new CloudError(String(msg), code, res.status);
  }

  async function authPost(path, body, fallback) {
    let res;
    try {
      res = await fetchImpl(`${base}/auth/v1/${path}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
      });
    } catch {
      throw new CloudError('連不上雲端服務，請確認網路', 'network');
    }
    if (!res.ok) throw await errorOf(res, fallback);
    return res.json().catch(() => ({}));
  }

  const getSession = () => readJson(storage, CLOUD_SESSION_KEY);

  function saveSession(data) {
    const session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at ? data.expires_at * 1000 : now() + (Number(data.expires_in) || 3600) * 1000,
      user: { id: data.user?.id || '', email: data.user?.email || '' },
    };
    if (!session.access_token || !session.user.id) throw new CloudError('登入回應不完整，請再試一次', 'session');
    storage.setItem(CLOUD_SESSION_KEY, JSON.stringify(session));
    return session;
  }

  /** 寄登入信：信裡有登入連結（回到 redirectTo），自訂信件範本時也可以附數字驗證碼 */
  async function sendCode(email, { redirectTo = '' } = {}) {
    const e = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new CloudError('Email 格式不對', 'email');
    const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
    try {
      await authPost(`otp${q}`, { email: e, create_user: true }, '寄送登入信失敗');
    } catch (err) {
      if (err.status === 429 || /rate limit/i.test(err.message)) {
        throw new CloudError('寄信次數已達上限（每小時只能寄幾封），請稍後再試，或使用最近一封登入信', 'rate-limit', err.status);
      }
      throw err;
    }
  }

  /** 登入信連結回到網站時，用網址帶回的 token 建立登入狀態 */
  async function completeRedirect({ access_token, refresh_token, expires_in, expires_at }) {
    let res;
    try {
      res = await fetchImpl(`${base}/auth/v1/user`, { headers: headers({ Authorization: `Bearer ${access_token}` }) });
    } catch {
      throw new CloudError('連不上雲端服務，請確認網路', 'network');
    }
    if (!res.ok) throw new CloudError('登入連結已失效，請重新寄送登入信', 'otp', res.status);
    const user = await res.json();
    return saveSession({ access_token, refresh_token, expires_in, expires_at: Number(expires_at) || 0, user });
  }

  async function verifyCode(email, code) {
    const token = String(code || '').replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) throw new CloudError('請輸入 Email 裡的數字驗證碼', 'code');
    try {
      return saveSession(await authPost('verify', { type: 'email', email: String(email).trim(), token }, '驗證碼不對或已過期'));
    } catch (err) {
      if (err.status === 400 || err.status === 403 || err.status === 401) throw new CloudError('驗證碼不對或已過期，請重新寄送', 'otp', err.status);
      throw err;
    }
  }

  async function refresh() {
    const s = getSession();
    if (!s?.refresh_token) throw new CloudError('請重新登入', 'signed-out');
    try {
      return saveSession(await authPost('token?grant_type=refresh_token', { refresh_token: s.refresh_token }, '登入已過期'));
    } catch (err) {
      if (err.code !== 'network') storage.removeItem(CLOUD_SESSION_KEY);
      throw err.code === 'network' ? err : new CloudError('登入已過期，請重新登入', 'signed-out', err.status);
    }
  }

  async function validSession() {
    const s = getSession();
    if (!s?.access_token) throw new CloudError('請先登入', 'signed-out');
    if (s.expires_at - 60000 > now()) return s;
    return refresh();
  }

  async function authed(url, init = {}, retried = false) {
    const s = await validSession();
    let res;
    try {
      res = await fetchImpl(url, { cache: 'no-store', ...init, headers: headers({ Authorization: `Bearer ${s.access_token}`, ...(init.headers || {}) }) });
    } catch {
      throw new CloudError('連不上雲端服務，請確認網路', 'network');
    }
    if (res.status === 401 && !retried) {
      await refresh();
      return authed(url, init, true);
    }
    return res;
  }

  const objectUrl = (path, authenticated = false) => `${base}/storage/v1/object/${authenticated ? 'authenticated/' : ''}${CLOUD_BUCKET}/${path}`;
  const userPath = (name) => `${getSession()?.user?.id}/${name}`;

  const notFound = async (res) => {
    if (res.status === 404) return true;
    if (res.status !== 400) return false;
    const body = await res.clone().json().catch(() => ({}));
    return /not.?found/i.test(`${body.error || ''} ${body.message || ''} ${body.statusCode || ''}`) || String(body.statusCode) === '404';
  };

  async function getObject(name) {
    const res = await authed(objectUrl(userPath(name), true));
    if (await notFound(res)) return null;
    if (!res.ok) throw await errorOf(res, '讀取雲端資料失敗');
    return new Uint8Array(await res.arrayBuffer());
  }

  async function putObject(name, bytes, contentType) {
    const res = await authed(objectUrl(userPath(name)), {
      method: 'POST',
      headers: { 'Content-Type': contentType, 'x-upsert': 'true', 'cache-control': 'no-cache' },
      body: bytes,
    });
    if (!res.ok) {
      const err = await errorOf(res, '上傳雲端失敗');
      if (res.status === 413 || /too large|maximum allowed size/i.test(err.message)) {
        throw new CloudError('資料太大，超過雲端單檔上限；可先刪除不需要的簡報圖片後再試', 'too-large', res.status);
      }
      if (res.status === 403 || /row-level security|policy/i.test(err.message)) {
        throw new CloudError('雲端拒絕寫入：Storage 權限尚未設定（請管理者依設定說明建立 Policy）', 'policy', res.status);
      }
      throw err;
    }
  }

  async function removeObject(name) {
    await authed(`${base}/storage/v1/object/${CLOUD_BUCKET}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [userPath(name)] }),
    }).catch(() => {});
  }

  async function getMeta() {
    const bytes = await getObject('meta.json');
    if (!bytes) return null;
    try {
      const meta = JSON.parse(new TextDecoder().decode(bytes));
      if (meta?.format > CLOUD_FORMAT) throw new CloudError('雲端資料來自較新版本的 Call Coach，請先重新整理頁面更新', 'format');
      return meta?.rev ? meta : null;
    } catch (err) {
      if (err instanceof CloudError) throw err;
      throw new CloudError('雲端 meta.json 已損壞', 'format');
    }
  }

  async function signOut() {
    const s = getSession();
    if (s?.access_token) {
      fetchImpl(`${base}/auth/v1/logout`, { method: 'POST', headers: headers({ Authorization: `Bearer ${s.access_token}` }) }).catch(() => {});
    }
    [CLOUD_SESSION_KEY, CLOUD_CRYPTO_KEY, CLOUD_STATE_KEY].forEach((k) => storage.removeItem(k));
  }

  return { config, getSession, sendCode, verifyCode, completeRedirect, refresh, signOut, getMeta, getObject, putObject, removeObject };
}

/* ---------- 上傳／下載 ---------- */

/** 第一次設定同步密碼：產生新的 salt */
export async function newCloudKey(passphrase) {
  const salt = randomBytes(16);
  return { key: await deriveKey(passphrase, salt), salt: toBase64(salt), iterations: KDF_ITERATIONS };
}

export async function keyForMeta(passphrase, meta) {
  return deriveKey(passphrase, fromBase64(meta.salt), meta.iterations || KDF_ITERATIONS);
}

/**
 * 上傳這台裝置的資料。
 * @param {{expectRev?: string|null, force?: boolean}} o  expectRev＝上次同步的 rev；雲端被別台更新過且沒 force 就丟 conflict
 */
export async function uploadSnapshot({ client, JSZip, storage, databases, key, salt, iterations = KDF_ITERATIONS, appVersion = '', force = false, onProgress, now = new Date() }) {
  const state = loadSyncState(storage);
  const before = await client.getMeta();
  if (before && !force && before.rev !== state?.rev) {
    throw new CloudError('雲端已被其他裝置更新，請先下載或選擇覆蓋', 'conflict');
  }
  if (before && before.salt !== salt && !force) throw new CloudError('同步密碼已在其他裝置變更，請重新輸入', 'bad-key');
  const { bytes, fingerprint } = await buildSnapshot({ JSZip, storage, databases, appVersion, now, onProgress });
  if (bytes.length > MAX_SNAPSHOT_BYTES) throw new CloudError('資料太大，超過雲端單檔上限；可先刪除不需要的簡報圖片後再試', 'too-large');
  onProgress?.('加密中…');
  const sealed = await encryptBytes(key, bytes);
  const rev = randomId();
  const file = `snapshot-${rev}.bin`;
  onProgress?.(`上傳中…（${Math.max(1, Math.round(sealed.length / 1024))} KB）`);
  await client.putObject(file, sealed, 'application/octet-stream');
  const meta = {
    format: CLOUD_FORMAT,
    rev,
    file,
    updatedAt: now.toISOString(),
    device: deviceName(storage),
    appVersion,
    bytes: sealed.length,
    salt,
    iterations,
    keyCheck: await makeKeyCheck(key),
  };
  await client.putObject('meta.json', new TextEncoder().encode(JSON.stringify(meta)), 'application/json');
  if (before?.file && before.file !== file) await client.removeObject(before.file);
  saveSyncState(storage, { rev, fingerprint, syncedAt: now.toISOString(), direction: 'up' });
  return meta;
}

/** 下載雲端資料並取代這台裝置的資料（錄音與 API Key 保留） */
export async function downloadSnapshot({ client, JSZip, storage, databases, key, meta: knownMeta, onProgress, now = new Date() }) {
  const meta = knownMeta || (await client.getMeta());
  if (!meta) throw new CloudError('雲端還沒有資料', 'empty');
  onProgress?.('下載中…');
  const sealed = await client.getObject(meta.file);
  if (!sealed) throw new CloudError('雲端資料不完整（找不到快照檔），請在最新的裝置重新上傳', 'missing');
  onProgress?.('解密中…');
  const bytes = await decryptBytes(key, sealed);
  const backup = await readBackup(JSZip, bytes);
  const fingerprint = await zipFingerprint(backup.zip);
  await restoreBackup(backup, { storage, databases, onProgress });
  saveSyncState(storage, { rev: meta.rev, fingerprint, syncedAt: now.toISOString(), direction: 'down' });
  return meta;
}
