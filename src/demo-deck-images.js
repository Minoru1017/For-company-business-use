/**
 * DEMO 簡報匯入的圖片：先在瀏覽器縮圖壓縮，再以 data URL 存進 IndexedDB
 * （localStorage 只有約 5MB，放不下圖片）。簡報 JSON 只記 imageId 與位置。
 */
const DB_NAME = 'callCoachDeckImages';
const STORE = 'images';
const MAX_SIDE = 1600;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

let dbPromise = null;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('圖片儲存失敗'));
  });
}

export function openDb() {
  if (dbPromise) return dbPromise;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('此瀏覽器不支援圖片儲存'));
  dbPromise = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => {
      dbPromise = null;
      reject(open.error || new Error('無法開啟圖片資料庫'));
    };
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await openDb();
  const t = db.transaction(STORE, mode);
  const result = await fn(t.objectStore(STORE));
  await new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('圖片儲存中斷'));
  });
  return result;
}

export function putDeckImage(id, dataUrl) {
  return tx('readwrite', (s) => req(s.put({ id, dataUrl, savedAt: Date.now() })));
}

/** @returns {Promise<Map<string,string>>} id → data URL */
export async function loadAllDeckImages() {
  const rows = await tx('readonly', (s) => req(s.getAll()));
  return new Map((rows || []).map((r) => [r.id, r.dataUrl]));
}

export function deleteDeckImages(ids) {
  const list = [...(ids || [])];
  if (!list.length) return Promise.resolve();
  return tx('readwrite', (s) => Promise.all(list.map((id) => req(s.delete(id)))));
}

export function newImageId() {
  return `img_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function loadImageEl(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('無法讀取這張圖片'));
    img.src = src;
  });
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error || new Error('無法讀取檔案'));
    r.readAsDataURL(blob);
  });
}

/**
 * 縮到長邊 1600px；有透明度可能的格式（PNG／GIF／WebP）存 PNG，其餘存 JPEG。
 * @returns {Promise<{dataUrl:string, ratio:number}>} ratio = 高 / 寬
 */
export async function compressImageFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('請選擇圖片檔');
  if (file.size > MAX_IMAGE_BYTES) throw new Error('圖片超過 15MB，請先縮小再匯入');
  const src = await readAsDataUrl(file);
  const img = await loadImageEl(src);
  const w0 = img.naturalWidth || img.width;
  const h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) throw new Error('無法讀取圖片尺寸');
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));
  const ratio = h / w;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  const keepAlpha = /png|gif|webp|svg/.test(file.type);
  if (!keepAlpha) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = keepAlpha ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.86);
  return { dataUrl: scale === 1 && dataUrl.length > src.length ? src : dataUrl, ratio };
}
