/**
 * DEMO 轉錄：瀏覽器直連遠端 Worker（不需本機 Call Coach 助手）。
 * 適合公司電腦無法安裝／執行 .exe 時，將 MP4 上傳到新竹 GPU Worker，收回 SRT 後在網頁分析。
 */
import { escapeHTML } from './utils.js';

const STORAGE_URL = 'callCoachBrowserWorkerUrl';
const STORAGE_TOKEN = 'callCoachBrowserWorkerToken';
const STORAGE_CONSENT = 'callCoachBrowserWorkerConsent';
const WORKER_TOKEN_HEADER = 'X-Call-Coach-Worker-Token';

let busy = false;
let abortUpload = null;

function loadSettings() {
  try {
    return {
      url: (localStorage.getItem(STORAGE_URL) || '').trim(),
      token: (localStorage.getItem(STORAGE_TOKEN) || '').trim(),
      consent: localStorage.getItem(STORAGE_CONSENT) === '1',
    };
  } catch {
    return { url: '', token: '', consent: false };
  }
}

function saveSettings({ url, token, consent }) {
  try {
    localStorage.setItem(STORAGE_URL, url || '');
    localStorage.setItem(STORAGE_TOKEN, token || '');
    localStorage.setItem(STORAGE_CONSENT, consent ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function normalizeWorkerUrl(raw) {
  const u = String(raw || '').trim().replace(/\/+$/, '');
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) return `http://${u}`;
  return u;
}

async function workerFetch(url, token, path, { method = 'GET', body = null, headers = {} } = {}) {
  const base = normalizeWorkerUrl(url);
  const res = await fetch(`${base}${path}`, {
    method,
    body,
    headers: {
      ...headers,
      [WORKER_TOKEN_HEADER]: token,
    },
  });
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text || res.statusText };
  }
  if (!res.ok) {
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return { res, data, text };
}

export async function testBrowserWorker(url, token) {
  const { data } = await workerFetch(url, token, '/worker/health');
  return data;
}

function uploadMp4(url, token, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    abortUpload = () => xhr.abort();
    const base = normalizeWorkerUrl(url);
    xhr.open('POST', `${base}/worker/jobs`);
    xhr.setRequestHeader(WORKER_TOKEN_HEADER, token);
    xhr.setRequestHeader('Content-Type', 'video/mp4');
    xhr.setRequestHeader('X-Job-Name', file.name || 'demo.mp4');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      abortUpload = null;
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 400 || !data.job_id) {
          reject(new Error(data.message || `上傳失敗（HTTP ${xhr.status}）`));
          return;
        }
        resolve(data.job_id);
      } catch {
        reject(new Error('Worker 回應異常'));
      }
    };
    xhr.onerror = () => {
      abortUpload = null;
      reject(
        new Error(
          '無法連線遠端主機。請確認 Tailscale／Tunnel 網址、Token，且此頁為 https 時 Worker 也需為 https（避免混合內容被瀏覽器封鎖）'
        )
      );
    };
    xhr.onabort = () => {
      abortUpload = null;
      reject(new Error('已取消上傳'));
    };
    xhr.send(file);
  });
}

async function pollWorkerJob(url, token, jobId, onLog) {
  let since = 0;
  for (;;) {
    const { data } = await workerFetch(url, token, `/worker/jobs/${jobId}?since=${since}`);
    for (const line of data.lines || []) onLog?.(String(line));
    since = Number(data.next ?? since);
    const state = String(data.state || '');
    if (state === 'done') return data;
    if (state === 'failed' || state === 'cancelled') {
      throw new Error(state === 'cancelled' ? '遠端工作已取消' : `遠端轉錄失敗（exit ${data.exit_code ?? '?'})`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

async function downloadWorkerSrt(url, token, jobId) {
  const { text } = await workerFetch(url, token, `/worker/jobs/${jobId}/srt`);
  if (!text.trim()) throw new Error('SRT 為空');
  return text;
}

export function mountBrowserWorkerUI(container, { onTranscriptReady, showToast }) {
  if (!container) return;
  const st = loadSettings();
  container.innerHTML = `
    <div class="browser-worker">
      <p class="hint">填新竹 Worker 視窗上的網址與 Token；MP4 會<strong>直傳你的 GPU 主機</strong>轉錄（不經 Call Coach 網站、不需安裝助手）。完成後自動載入逐字稿，報告在下方「把結果帶走」下載。</p>
      <input type="text" id="bwWorkerUrl" class="bridge-token" placeholder="http://100.x.x.x:8766 或 https://tunnel…" value="${escapeHTML(st.url)}" autocomplete="off">
      <input type="password" id="bwWorkerToken" class="bridge-token" placeholder="Worker Token" value="${escapeHTML(st.token)}" autocomplete="off">
      <label class="bridge-consent">
        <input type="checkbox" id="bwConsent" ${st.consent ? 'checked' : ''}>
        我了解 DEMO 影片將透過網路傳送到<strong>我自己指定的遠端主機</strong>轉錄（僅產生逐字稿，遠端處理完即刪除）
      </label>
      <div class="bridge-actions">
        <button type="button" class="btn" id="bwTest">測試連線</button>
        <button type="button" class="btn" id="bwPick" ${busy ? 'disabled' : ''}>選擇 MP4</button>
        <button type="button" class="btn primary" id="bwStart" disabled>開始遠端轉錄</button>
        <button type="button" class="btn bridge-cancel hidden" id="bwCancel">取消</button>
      </div>
      <input type="file" id="bwFile" accept=".mp4,video/mp4" hidden>
      <div class="bridge-upload-status hidden" id="bwStatus"></div>
      <div class="bridge-log-panel hidden" id="bwLog"></div>
    </div>
  `;

  let picked = null;
  const urlEl = container.querySelector('#bwWorkerUrl');
  const tokenEl = container.querySelector('#bwWorkerToken');
  const consentEl = container.querySelector('#bwConsent');
  const startBtn = container.querySelector('#bwStart');
  const statusEl = container.querySelector('#bwStatus');
  const logEl = container.querySelector('#bwLog');
  const fileInput = container.querySelector('#bwFile');

  const persist = () =>
    saveSettings({
      url: urlEl?.value?.trim() || '',
      token: tokenEl?.value?.trim() || '',
      consent: !!consentEl?.checked,
    });

  const setStatus = (msg, kind = 'busy') => {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.classList.remove('hidden', 'busy', 'ok', 'err');
    statusEl.classList.add(kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : 'busy');
    statusEl.textContent = msg;
  };

  const appendLog = (line) => {
    if (!logEl) return;
    logEl.classList.remove('hidden');
    logEl.textContent = (logEl.textContent ? `${logEl.textContent}\n` : '') + line;
  };

  const refreshStart = () => {
    if (!startBtn) return;
    startBtn.disabled = busy || !picked || !consentEl?.checked || !urlEl?.value?.trim() || !tokenEl?.value?.trim();
  };

  urlEl?.addEventListener('input', () => {
    persist();
    refreshStart();
  });
  tokenEl?.addEventListener('input', () => {
    persist();
    refreshStart();
  });
  consentEl?.addEventListener('change', () => {
    persist();
    refreshStart();
  });

  container.querySelector('#bwTest')?.addEventListener('click', async () => {
    persist();
    try {
      const h = await testBrowserWorker(urlEl.value, tokenEl.value);
      showToast?.(`已連上 ${h.name || 'Worker'}｜${h.gpu || 'CPU'}｜${h.model || ''}`);
    } catch (e) {
      showToast?.(e.message || '連線失敗');
    }
  });

  container.querySelector('#bwPick')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (e) => {
    const f = e.target.files?.[0];
    picked = f || null;
    if (f) setStatus(`已選擇 ${f.name}（${(f.size / (1024 * 1024)).toFixed(1)} MB）`, 'ok');
    refreshStart();
  });

  container.querySelector('#bwCancel')?.addEventListener('click', () => {
    abortUpload?.();
    busy = false;
    container.querySelector('#bwCancel')?.classList.add('hidden');
    refreshStart();
    setStatus('已取消', 'err');
  });

  startBtn?.addEventListener('click', async () => {
    if (!picked || !consentEl?.checked) return;
    persist();
    busy = true;
    refreshStart();
    container.querySelector('#bwCancel')?.classList.remove('hidden');
    logEl.textContent = '';
    logEl.classList.remove('hidden');
    let jobId = null;
    try {
      setStatus('上傳 MP4 到遠端主機…');
      jobId = await uploadMp4(urlEl.value, tokenEl.value, picked, (pct) =>
        setStatus(`上傳中 ${Math.round(pct)}%…`)
      );
      setStatus('遠端 GPU 轉錄中（可在 DeskIn 看新竹主機）…');
      await pollWorkerJob(urlEl.value, tokenEl.value, jobId, appendLog);
      const srt = await downloadWorkerSrt(urlEl.value, tokenEl.value, jobId);
      const name = picked.name.replace(/\.mp4$/i, '.srt');
      onTranscriptReady?.(srt, name);
      setStatus('轉錄完成，已載入逐字稿', 'ok');
      showToast?.('遠端轉錄完成 — 請繼續標記與分析，報告在「把結果帶走」下載');
    } catch (e) {
      setStatus(e.message || '失敗', 'err');
      showToast?.(e.message || '遠端轉錄失敗');
    } finally {
      busy = false;
      container.querySelector('#bwCancel')?.classList.add('hidden');
      refreshStart();
      if (jobId) {
        try {
          await workerFetch(urlEl.value, tokenEl.value, `/worker/jobs/${jobId}/delete`, { method: 'POST', body: '' });
        } catch {
          /* ignore */
        }
      }
    }
  });

  refreshStart();
}
