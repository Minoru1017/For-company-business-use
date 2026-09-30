/**
 * 主管早會連續音訊儲存。
 *
 * MediaRecorder 每秒產生一個 Blob；這裡立即寫入 IndexedDB，避免只放在記憶體中，
 * 分頁意外關閉時最多只遺失尚未送出的最後一小段。
 */
const DB_NAME = 'callCoachMeetingAudio';
const DB_VERSION = 1;
const STORE_SESSIONS = 'sessions';
const STORE_CHUNKS = 'chunks';

let dbPromise = null;

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('音訊儲存失敗'));
  });
}

function openDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('此瀏覽器不支援連續音訊儲存'));
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
        db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
        const chunks = db.createObjectStore(STORE_CHUNKS, { keyPath: 'key' });
        chunks.createIndex('sessionId', 'sessionId', { unique: false });
      }
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
      reject(open.error || new Error('無法開啟連續音訊儲存空間'));
    };
  });
  return dbPromise;
}

async function withStore(names, mode, fn) {
  const db = await openDb();
  const storeNames = Array.isArray(names) ? names : [names];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    try {
      result = fn(tx, ...storeNames.map((name) => tx.objectStore(name)));
    } catch (error) {
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('音訊儲存交易失敗'));
    tx.onabort = () => reject(tx.error || new Error('音訊儲存交易中止'));
  });
}

export function makeMeetingAudioSessionId(meetingId, startedAt = Date.now()) {
  return `brief_${String(meetingId || 'meeting')}_${Number(startedAt).toString(36)}`;
}

export function makeMeetingAudioChunkKey(sessionId, index) {
  return `${sessionId}:${String(Math.max(0, Number(index) || 0)).padStart(8, '0')}`;
}

export function assembleMeetingAudioBlob(chunks, mimeType = 'audio/webm') {
  const ordered = [...(chunks || [])].sort((a, b) => (a.index || 0) - (b.index || 0));
  return new Blob(ordered.map((row) => row.blob).filter(Boolean), { type: mimeType });
}

export function beginMeetingAudioSession(session) {
  const row = {
    id: String(session.id),
    meetingId: String(session.meetingId || ''),
    title: String(session.title || ''),
    mimeType: String(session.mimeType || 'audio/webm'),
    startedAt: Number(session.startedAt) || Date.now(),
    endedAt: null,
    status: 'recording',
    chunkCount: 0,
    bytes: 0,
    updatedAt: Date.now(),
  };
  return withStore(STORE_SESSIONS, 'readwrite', (_tx, store) => store.put(row)).then(() => row);
}

export function appendMeetingAudioChunk(sessionId, index, blob) {
  if (!blob?.size) return Promise.resolve(null);
  return withStore([STORE_CHUNKS, STORE_SESSIONS], 'readwrite', (_tx, chunks, sessions) => {
    chunks.put({
      key: makeMeetingAudioChunkKey(sessionId, index),
      sessionId,
      index,
      blob,
      bytes: blob.size,
      createdAt: Date.now(),
    });
    const get = sessions.get(sessionId);
    get.onsuccess = () => {
      const session = get.result;
      if (!session) return;
      session.chunkCount = Math.max(Number(session.chunkCount) || 0, index + 1);
      session.bytes = (Number(session.bytes) || 0) + blob.size;
      session.updatedAt = Date.now();
      sessions.put(session);
    };
  });
}

export function finalizeMeetingAudioSession(sessionId, { endedAt = Date.now(), interrupted = false } = {}) {
  return withStore(STORE_SESSIONS, 'readwrite', (_tx, store) => {
    const get = store.get(sessionId);
    get.onsuccess = () => {
      const session = get.result;
      if (!session) return;
      session.endedAt = endedAt;
      session.status = interrupted ? 'interrupted' : 'complete';
      session.updatedAt = Date.now();
      store.put(session);
    };
  });
}

export async function getMeetingAudioSession(sessionId) {
  const db = await openDb();
  return req(db.transaction(STORE_SESSIONS, 'readonly').objectStore(STORE_SESSIONS).get(sessionId));
}

export async function getMeetingAudioBlob(sessionId) {
  const session = await getMeetingAudioSession(sessionId);
  if (!session) return null;
  const db = await openDb();
  const tx = db.transaction(STORE_CHUNKS, 'readonly');
  const range = IDBKeyRange.only(sessionId);
  const chunks = await req(tx.objectStore(STORE_CHUNKS).index('sessionId').getAll(range));
  return assembleMeetingAudioBlob(chunks, session.mimeType);
}

export async function listInterruptedMeetingAudioSessions() {
  const db = await openDb();
  const sessions = await req(db.transaction(STORE_SESSIONS, 'readonly').objectStore(STORE_SESSIONS).getAll());
  return (sessions || [])
    .filter((session) => session.status === 'recording' || session.status === 'interrupted')
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function deleteMeetingAudioSession(sessionId) {
  return withStore([STORE_SESSIONS, STORE_CHUNKS], 'readwrite', (_tx, sessions, chunks) => {
    sessions.delete(sessionId);
    const request = chunks.index('sessionId').openCursor(IDBKeyRange.only(sessionId));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
  });
}
