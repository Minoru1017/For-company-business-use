/**
 * 開發模式：直接上傳電訪錄音檔，用 Gemini 轉錄成逐字稿（含業務／客戶標記），不需先經 Vibe。
 *
 * - 小檔（≤ INLINE_LIMIT_BYTES）直接以 base64 inline 隨 prompt 送出。
 * - 大檔走 Gemini File API（resumable upload → 等待 ACTIVE → file_data 引用 → 用完刪除）。
 * 全模組不碰 DOM，方便單元測試；UI 在 dev-audio-upload.js。
 */
import { callGeminiResilient } from './gemini.js';

export const AUDIO_EXTENSIONS = ['m4a', 'mp3', 'wav', 'ogg', 'oga', 'opus', 'webm', 'aac', 'flac', 'aiff', 'aif', 'amr', 'wma'];
export const AUDIO_ACCEPT = `${AUDIO_EXTENSIONS.map((e) => `.${e}`).join(',')},audio/*`;

/** Gemini generateContent 總請求上限 20 MB；base64 膨脹約 1.37 倍，留安全邊際。 */
export const INLINE_LIMIT_BYTES = 14 * 1024 * 1024;
/** 單檔上限（Gemini File API 上限 2 GB；轉錄品質與時間考量，先擋在 1 GB）。 */
export const MAX_AUDIO_BYTES = 1024 * 1024 * 1024;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const FILE_POLL_INTERVAL_MS = 2000;
const FILE_POLL_MAX_MS = 6 * 60 * 1000;

const MIME_BY_EXT = {
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  mp3: 'audio/mpeg',
  mpeg: 'audio/mpeg',
  mpga: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  aac: 'audio/aac',
  flac: 'audio/flac',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  amr: 'audio/amr',
  wma: 'audio/x-ms-wma',
};

export function fileExtension(name) {
  const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

export function isAudioFileName(name) {
  return AUDIO_EXTENSIONS.includes(fileExtension(name));
}

/** 瀏覽器常給空 type 或 video/webm（其實只有音軌），以副檔名為優先。 */
export function guessAudioMime(file) {
  const ext = fileExtension(file?.name);
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  const t = String(file?.type || '').toLowerCase();
  if (t.startsWith('audio/')) return t;
  return 'audio/mpeg';
}

export const TRANSCRIBE_PROMPT = `你是專業的繁體中文（台灣）電話錄音逐字稿員。請把這段「業務開發電訪」錄音完整轉成逐字稿。

規則：
1. 全程使用繁體中文（台灣用語）；數字、英文、品牌名照實記錄。
2. 兩位說話者：S = 業務（主動撥打、介紹公司／課程／諮詢、主要提問的人）、C = 客戶（接電話、回答問題的人）。判斷不出時依語境選最可能者，仍必須填 S 或 C。
3. 依對話自然斷句，每段一句到三句話；保留口語（好、對、嗯）但省略無意義重複的填充音。
4. start / end 為該段在錄音中的起訖時間，格式 mm:ss（超過一小時用 h:mm:ss），依時間先後排序、不可重疊。
5. 聽不清處以「（聽不清）」標記，不要臆測人名或金額。
6. 不要摘要、不要評論、不要翻譯，只輸出逐字稿。

輸出 JSON（不要 markdown 圍欄、不要多餘文字）：
{"segments":[{"start":"00:00","end":"00:04","speaker":"S","text":"喂，您好，請問是王先生嗎？"}]}`;

export function parseClock(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  const s = String(value ?? '').trim();
  if (!s) return NaN;
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
  const parts = s.split(':').map((p) => p.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  let secs = 0;
  for (const p of parts) secs = secs * 60 + Number(p);
  return secs;
}

function stripFence(raw) {
  return String(raw || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}

/** 輸出被 maxOutputTokens 截斷時，切到最後一個完整 segment 並補齊括號。 */
export function salvageTruncatedJson(text) {
  const s = String(text || '');
  const arrStart = s.indexOf('[');
  if (arrStart < 0) return null;
  let lastEnd = -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = arrStart + 1; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) lastEnd = i;
    } else if (ch === ']' && depth === 0) break;
  }
  if (lastEnd < 0) return null;
  return `{"segments":${s.slice(arrStart, lastEnd + 1)}]}`;
}

function normalizeSegments(list) {
  const segs = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const text = String(item.text ?? '').trim();
    if (!text) continue;
    let start = parseClock(item.start);
    let end = parseClock(item.end);
    if (!Number.isFinite(start)) start = segs.length ? segs[segs.length - 1].end : 0;
    if (!Number.isFinite(end) || end < start) end = start + Math.max(1, Math.round(text.length / 4));
    const spkRaw = String(item.speaker ?? item.spk ?? '').trim().toUpperCase();
    const spk = spkRaw.startsWith('C') || /客/.test(spkRaw) ? 'C' : 'S';
    segs.push({ start, end, text, spk, labeled: true });
  }
  segs.sort((a, b) => a.start - b.start);
  return segs;
}

/**
 * 解析 Gemini 回傳的逐字稿 JSON → segs（{start,end,text,spk,labeled}）。
 * 回傳陣列上另掛 `truncated: true` 表示輸出被截斷（僅取得前段）。
 */
export function parseTranscriptJson(raw, { finishReason } = {}) {
  const cleaned = stripFence(raw);
  if (!cleaned) throw new Error('AI 沒有回傳逐字稿內容');
  let json = null;
  let truncated = false;
  try {
    json = JSON.parse(cleaned);
  } catch {
    const fixed = salvageTruncatedJson(cleaned);
    if (!fixed) throw new Error('AI 回傳的逐字稿格式不正確（非 JSON）');
    json = JSON.parse(fixed);
    truncated = true;
  }
  const list = Array.isArray(json) ? json : json?.segments;
  if (!Array.isArray(list)) throw new Error('AI 回傳格式不正確（缺少 segments 陣列）');
  const segs = normalizeSegments(list);
  if (!segs.length) throw new Error('AI 未辨識出任何語句，請確認錄音有清楚的對話內容');
  if (truncated || finishReason === 'MAX_TOKENS') segs.truncated = true;
  return segs;
}

export function describeSize(bytes) {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function validateAudioFile(file) {
  if (!file) return '請先選擇錄音檔';
  if (!isAudioFileName(file.name) && !String(file.type || '').startsWith('audio/')) {
    return `不支援的檔案類型：${file.name}。請用 ${AUDIO_EXTENSIONS.slice(0, 6).join(' / ')} 等錄音格式`;
  }
  if (file.size <= 0) return '檔案是空的';
  if (file.size > MAX_AUDIO_BYTES) return `檔案過大（${describeSize(file.size)}），上限 ${describeSize(MAX_AUDIO_BYTES)}`;
  return '';
}

async function blobToBase64(file) {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('讀取檔案失敗'));
      r.onload = () => {
        const s = String(r.result || '');
        resolve(s.slice(s.indexOf(',') + 1));
      };
      r.readAsDataURL(file);
    });
  }
  const buf = new Uint8Array(await file.arrayBuffer());
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

function apiHeaders(apiKey, extra = {}) {
  return { 'x-goog-api-key': apiKey, ...extra };
}

async function readError(res, fallback) {
  const body = await res.json().catch(() => ({}));
  const msg = body?.error?.message || `${fallback}（HTTP ${res.status}）`;
  const err = new Error(msg);
  err.status = res.status;
  return err;
}

function sleep(ms, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

/** Gemini File API：resumable 上傳並等到 ACTIVE。回傳 { name, uri, mimeType }。 */
export async function uploadToGeminiFiles({ apiKey, file, mimeType, signal, fetchImpl = fetch, onProgress }) {
  onProgress?.('建立上傳工作…');
  const start = await fetchImpl(`${GEMINI_BASE}/upload/v1beta/files`, {
    method: 'POST',
    signal,
    headers: apiHeaders(apiKey, {
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ file: { display_name: file.name || 'call-audio' } }),
  });
  if (!start.ok) throw await readError(start, '無法建立 Gemini 檔案上傳');
  const uploadUrl = start.headers.get('X-Goog-Upload-URL') || start.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini 未回傳上傳網址（瀏覽器可能封鎖了回應標頭），請改用較小的檔案或新竹 Worker');
  }

  onProgress?.(`上傳 ${describeSize(file.size)} 到 Gemini…`);
  const finalize = await fetchImpl(uploadUrl, {
    method: 'POST',
    signal,
    headers: {
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
      'Content-Type': mimeType,
    },
    body: file,
  });
  if (!finalize.ok) throw await readError(finalize, '上傳錄音到 Gemini 失敗');
  const info = await finalize.json().catch(() => ({}));
  let meta = info?.file || {};
  if (!meta.name || !meta.uri) throw new Error('Gemini 上傳回應缺少檔案資訊');

  const startedAt = Date.now();
  while (String(meta.state || '').toUpperCase() === 'PROCESSING') {
    if (Date.now() - startedAt > FILE_POLL_MAX_MS) throw new Error('Gemini 處理上傳檔案逾時，請稍後再試');
    onProgress?.('Gemini 處理音檔中…');
    await sleep(FILE_POLL_INTERVAL_MS, signal);
    const poll = await fetchImpl(`${GEMINI_BASE}/v1beta/${meta.name}`, { signal, headers: apiHeaders(apiKey) });
    if (!poll.ok) throw await readError(poll, '查詢 Gemini 檔案狀態失敗');
    meta = await poll.json();
  }
  if (String(meta.state || '').toUpperCase() === 'FAILED') {
    throw new Error(`Gemini 無法處理此音檔：${meta?.error?.message || '格式可能不支援'}`);
  }
  return { name: meta.name, uri: meta.uri, mimeType: meta.mimeType || mimeType };
}

export async function deleteGeminiFile({ apiKey, name, fetchImpl = fetch }) {
  if (!name) return;
  try {
    await fetchImpl(`${GEMINI_BASE}/v1beta/${name}`, { method: 'DELETE', headers: apiHeaders(apiKey) });
  } catch {
    /* 48 小時後 Google 會自動清除 */
  }
}

/**
 * 主流程：檔案 → Gemini → segs。
 * 回傳 { segs, usedTokens, modelUsed, via: 'inline'|'file_api', truncated }
 */
export async function transcribeAudioWithGemini({
  apiKey,
  model,
  file,
  signal,
  fetchImpl = fetch,
  onProgress,
  onRetry,
  onModelSwitch,
  inlineLimit = INLINE_LIMIT_BYTES,
}) {
  const problem = validateAudioFile(file);
  if (problem) throw new Error(problem);
  if (!apiKey) throw new Error('請先貼上 Gemini API Key');

  const mimeType = guessAudioMime(file);
  let audioPart;
  let uploaded = null;
  let via = 'inline';
  if (file.size <= inlineLimit) {
    onProgress?.('讀取錄音檔…');
    const data = await blobToBase64(file);
    audioPart = { inline_data: { mime_type: mimeType, data } };
  } else {
    via = 'file_api';
    uploaded = await uploadToGeminiFiles({ apiKey, file, mimeType, signal, fetchImpl, onProgress });
    audioPart = { file_data: { mime_type: uploaded.mimeType, file_uri: uploaded.uri } };
  }

  try {
    onProgress?.('Gemini 轉錄中（依錄音長度約 1～5 分鐘）…');
    const result = await callGeminiResilient({
      apiKey,
      model,
      parts: [audioPart, { text: TRANSCRIBE_PROMPT }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 65536 },
      signal,
      fetchImpl,
      parse: parseTranscriptJson,
      onRetry,
      onModelSwitch,
    });
    return {
      segs: result.parsed,
      usedTokens: result.usedTokens,
      modelUsed: result.modelUsed,
      via,
      truncated: !!result.parsed.truncated,
    };
  } finally {
    if (uploaded) deleteGeminiFile({ apiKey, name: uploaded.name, fetchImpl });
  }
}

/** Worker 只接受 ^[A-Za-z0-9._ -]{1,120}$ 的檔名；中文檔名改成 upload.<ext>，保留副檔名給 WhisperX 判斷格式。 */
export function safeWorkerJobName(name, fallbackExt = 'wav') {
  const base = String(name || '').split(/[\\/]/).pop().trim();
  if (/^[A-Za-z0-9._ -]{1,120}$/.test(base)) return base;
  const ext = fileExtension(base) || fallbackExt;
  return `upload.${ext}`;
}
