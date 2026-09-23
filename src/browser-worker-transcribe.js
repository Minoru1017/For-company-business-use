/**
 * 瀏覽器直連遠端 Worker（不需本機 Call Coach 助手）。
 * 適合公司電腦無法安裝／執行 .exe 時，將 MP4（DEMO）或錄音檔（開發電訪）上傳到新竹 GPU Worker，
 * 收回 SRT 後在網頁分析。可在同一頁多次掛載（idPrefix 區分）。
 */
import { safeWorkerJobName } from './audio-transcribe.js';
import { escapeHTML } from './utils.js';

const STORAGE_URL = 'callCoachBrowserWorkerUrl';
const STORAGE_TOKEN = 'callCoachBrowserWorkerToken';
const STORAGE_CONSENT = 'callCoachBrowserWorkerConsent';
const WORKER_TOKEN_HEADER = 'X-Call-Coach-Worker-Token';

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

function saveSettings({ url, token, consent }, { persistConsent = true } = {}) {
  try {
    localStorage.setItem(STORAGE_URL, url || '');
    localStorage.setItem(STORAGE_TOKEN, token || '');
    if (persistConsent) localStorage.setItem(STORAGE_CONSENT, consent ? '1' : '0');
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

function uploadMedia(url, token, file, onProgress, registerAbort) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    registerAbort?.(() => xhr.abort());
    const base = normalizeWorkerUrl(url);
    xhr.open('POST', `${base}/worker/jobs`);
    xhr.setRequestHeader(WORKER_TOKEN_HEADER, token);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-Job-Name', safeWorkerJobName(file.name || 'demo.mp4', 'mp4'));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    xhr.onload = () => {
      registerAbort?.(null);
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
      registerAbort?.(null);
      reject(
        new Error(
          '無法連線遠端主機。請確認 Tailscale／Tunnel 網址、Token，且此頁為 https 時 Worker 也需為 https（避免混合內容被瀏覽器封鎖）'
        )
      );
    };
    xhr.onabort = () => {
      registerAbort?.(null);
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

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {(text:string, filename:string)=>void} opts.onTranscriptReady  收到 SRT 後回呼
 * @param {(msg:string)=>void} [opts.showToast]
 * @param {string} [opts.accept]        file input accept（預設 MP4）
 * @param {string} [opts.mediaLabel]    UI 上對檔案的稱呼（預設「MP4」）
 * @param {string} [opts.idPrefix]      同頁多次掛載時避免 id 衝突
 * @param {boolean} [opts.persistConsent] false = 每次上傳都要重新勾選知情同意
 * @param {string} [opts.intro]         覆寫說明文字（HTML）
 * @returns {{ setFile(file: File): void } | undefined}
 */
export function mountBrowserWorkerUI(
  container,
  {
    onTranscriptReady,
    showToast,
    accept = '.mp4,video/mp4',
    mediaLabel = 'MP4',
    idPrefix = 'bw',
    persistConsent = true,
    intro = '',
  }
) {
  if (!container) return undefined;
  const st = loadSettings();
  const id = (suffix) => `${idPrefix}${suffix}`;
  const consentChecked = persistConsent && st.consent;
  let busy = false;
  let abortUpload = null;
  const registerAbort = (fn) => {
    abortUpload = fn;
  };
  const defaultIntro = `填新竹 Worker 視窗上的網址與 Token；${escapeHTML(mediaLabel)}會<strong>直傳你的 GPU 主機</strong>轉錄（不經 Call Coach 網站、不需安裝助手）。完成後自動載入逐字稿，報告在下方「把結果帶走」下載。`;
  container.innerHTML = `
    <div class="browser-worker">
      <p class="hint">${intro || defaultIntro}</p>
      <input type="text" id="${id('WorkerUrl')}" class="bridge-token" placeholder="http://100.x.x.x:8766 或 https://tunnel…" value="${escapeHTML(st.url)}" autocomplete="off">
      <input type="password" id="${id('WorkerToken')}" class="bridge-token" placeholder="Worker Token" value="${escapeHTML(st.token)}" autocomplete="off">
      <label class="bridge-consent">
        <input type="checkbox" id="${id('Consent')}" ${consentChecked ? 'checked' : ''}>
        我了解這個${escapeHTML(mediaLabel)}將透過網路傳送到<strong>我自己指定的遠端主機</strong>轉錄（僅產生逐字稿，遠端處理完即刪除）${persistConsent ? '' : '——每次上傳都需重新勾選'}
      </label>
      <div class="bridge-actions">
        <button type="button" class="btn" id="${id('Test')}">測試連線</button>
        <button type="button" class="btn" id="${id('Pick')}">選擇 ${escapeHTML(mediaLabel)}</button>
        <button type="button" class="btn primary" id="${id('Start')}" disabled>開始遠端轉錄</button>
        <button type="button" class="btn bridge-cancel hidden" id="${id('Cancel')}">取消</button>
      </div>
      <input type="file" id="${id('File')}" accept="${escapeHTML(accept)}" hidden>
      <div class="bridge-upload-status hidden" id="${id('Status')}"></div>
      <div class="bridge-log-panel hidden" id="${id('Log')}"></div>
    </div>
  `;

  let picked = null;
  const urlEl = container.querySelector(`#${id('WorkerUrl')}`);
  const tokenEl = container.querySelector(`#${id('WorkerToken')}`);
  const consentEl = container.querySelector(`#${id('Consent')}`);
  const startBtn = container.querySelector(`#${id('Start')}`);
  const statusEl = container.querySelector(`#${id('Status')}`);
  const logEl = container.querySelector(`#${id('Log')}`);
  const fileInput = container.querySelector(`#${id('File')}`);
  const cancelBtn = container.querySelector(`#${id('Cancel')}`);

  const persist = () =>
    saveSettings(
      {
        url: urlEl?.value?.trim() || '',
        token: tokenEl?.value?.trim() || '',
        consent: !!consentEl?.checked,
      },
      { persistConsent }
    );

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
    const blocked =
      busy || !picked || !consentEl?.checked || !urlEl?.value?.trim() || !tokenEl?.value?.trim();
    startBtn.disabled = blocked;
    if (startBtn.title) startBtn.removeAttribute('title');
    if (blocked && !busy) {
      if (!picked) startBtn.title = `請先選擇 ${mediaLabel}`;
      else if (!urlEl?.value?.trim() || !tokenEl?.value?.trim()) startBtn.title = '請填 Worker 網址與 Token';
      else if (!consentEl?.checked) startBtn.title = '請勾選知情同意';
    }
  };

  const setFile = (f) => {
    picked = f || null;
    if (f) setStatus(`已選擇 ${f.name}（${(f.size / (1024 * 1024)).toFixed(1)} MB）`, 'ok');
    refreshStart();
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

  container.querySelector(`#${id('Test')}`)?.addEventListener('click', async () => {
    persist();
    try {
      const h = await testBrowserWorker(urlEl.value, tokenEl.value);
      showToast?.(`已連上 ${h.name || 'Worker'}｜${h.gpu || 'CPU'}｜${h.model || ''}`);
    } catch (e) {
      showToast?.(e.message || '連線失敗');
    }
  });

  container.querySelector(`#${id('Pick')}`)?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', (e) => setFile(e.target.files?.[0]));

  cancelBtn?.addEventListener('click', () => {
    abortUpload?.();
    busy = false;
    cancelBtn.classList.add('hidden');
    refreshStart();
    setStatus('已取消', 'err');
  });

  startBtn?.addEventListener('click', async () => {
    if (!picked || !consentEl?.checked) return;
    persist();
    busy = true;
    refreshStart();
    cancelBtn?.classList.remove('hidden');
    logEl.textContent = '';
    logEl.classList.remove('hidden');
    let jobId = null;
    try {
      setStatus(`上傳 ${mediaLabel} 到遠端主機…`);
      jobId = await uploadMedia(
        urlEl.value,
        tokenEl.value,
        picked,
        (pct) => setStatus(`上傳中 ${Math.round(pct)}%…`),
        registerAbort
      );
      setStatus('遠端 GPU 轉錄中（可在 DeskIn 看新竹主機）…');
      await pollWorkerJob(urlEl.value, tokenEl.value, jobId, appendLog);
      const srt = await downloadWorkerSrt(urlEl.value, tokenEl.value, jobId);
      const name = picked.name.replace(/\.[a-z0-9]+$/i, '') + '.srt';
      onTranscriptReady?.(srt, name);
      setStatus('轉錄完成，已載入逐字稿', 'ok');
      showToast?.('遠端轉錄完成 — 請繼續標記與分析，報告在「把結果帶走」下載');
    } catch (e) {
      setStatus(e.message || '失敗', 'err');
      showToast?.(e.message || '遠端轉錄失敗');
    } finally {
      busy = false;
      cancelBtn?.classList.add('hidden');
      if (!persistConsent && consentEl) consentEl.checked = false;
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
  return { setFile };
}
