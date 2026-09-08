/**
 * Bridge Call Coach (GitHub Pages) ↔ local demo_app.py (127.0.0.1:8765).
 * DEMO audio never leaves the machine; only finished SRT is loaded into Call Coach.
 */
import { escapeHTML } from './utils.js';

const LOCAL_API = 'http://127.0.0.1:8765';
const API_TOKEN_HEADER = 'X-Call-Coach-Token';

let pollTimer = null;
let refreshTimer = null;
let offlinePollTimer = null;
let selectedMp4 = null;
let uploadBusy = false;
let transcribeBusy = false;
let uploadXhr = null;
let uploadStartAt = 0;
let bridgeApiToken = null;

const LARGE_FILE_MB = 80;
const HF_TOKEN_URL = 'https://huggingface.co/settings/tokens';
const TOKEN_PAGE_KEY = 'call_coach_hf_token_opened';
const REPO_ZIP_URL = 'https://github.com/Minoru1017/For-company-business-use/archive/refs/heads/main.zip';

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtSpeed(bps) {
  if (!bps || bps < 1024) return '計算中…';
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

async function openTokenPage(showToast, url = HF_TOKEN_URL) {
  try {
    await api('/api/open-url', { method: 'POST', body: JSON.stringify({ url }) });
    showToast?.('已開啟 Hugging Face Token 頁面 — 建立 Read Token 後貼回下方');
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
    showToast?.('已開啟 Token 頁面（若未跳出請允許彈出視窗）');
  }
}

function maybeAutoOpenTokenPage(st, showToast) {
  if (st.token_ok || !st.venv_ok || !st.whisperx_ok) return;
  if (sessionStorage.getItem(TOKEN_PAGE_KEY)) return;
  sessionStorage.setItem(TOKEN_PAGE_KEY, '1');
  openTokenPage(showToast);
}

function fmtElapsed(sec) {
  if (sec < 60) return `${sec} 秒`;
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

async function ensureApiToken() {
  if (bridgeApiToken) return bridgeApiToken;
  const res = await fetch(`${LOCAL_API}/api/bootstrap`, { mode: 'cors' });
  const data = await res.json();
  if (!res.ok || !data?.token) throw new Error('無法取得本機 API 授權');
  bridgeApiToken = data.token;
  return bridgeApiToken;
}

async function api(path, opts = {}, retried = false) {
  const token = await ensureApiToken();
  const headers = {
    ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(opts.headers || {}),
    [API_TOKEN_HEADER]: token,
  };
  const res = await fetch(`${LOCAL_API}${path}`, { ...opts, headers, mode: 'cors' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried) {
    bridgeApiToken = null;
    return api(path, opts, true);
  }
  if (!res.ok) {
    const err = new Error(data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export async function checkLocalBridge() {
  try {
    const st = await api('/api/status');
    return st && typeof st.python_ok === 'boolean' ? st : null;
  } catch {
    return null;
  }
}

function needsFullSetup(st) {
  return !st.ffmpeg_ok || !st.venv_ok || !st.whisperx_ok;
}

function renderOfflineWizard(offlineEl) {
  offlineEl.innerHTML = `
    <p><strong>尚未連線本機轉錄助手</strong></p>
    <p class="hint">首次使用請依下列步驟；助手啟動後此區會自動消失。</p>
    <ol class="setup-wizard-steps">
      <li>
        <strong>① 下載 demo-workspace</strong>
        <p class="hint">下載專案 ZIP，解壓後找到 <code>demo-workspace</code> 資料夾放到本機（例如桌面）。</p>
        <div class="bridge-actions">
          <a class="btn" href="${REPO_ZIP_URL}" target="_blank" rel="noopener noreferrer">下載專案 ZIP</a>
        </div>
      </li>
      <li>
        <strong>② 安裝並啟動（Windows）</strong>
        <p class="hint"><strong>公司電腦</strong>（setup_all 開不起來）：雙擊 <code>setup_portable.cmd</code> — 不需 winget、不需管理員，Python 會放在本資料夾 <code>runtime\python\</code>。</p>
        <p class="hint"><strong>一般電腦</strong>：雙擊 <code>setup_all.cmd</code> — 自動安裝 Python 3.12 + ffmpeg。</p>
        <p class="hint">若已裝 Python 3.10～3.12：雙擊 <code>start_call_coach.cmd</code>（命令指令檔，不是 .pyw）。<strong>黑窗請保持開啟。</strong></p>
      </li>
      <li>
        <strong>③ 等待連線</strong>
        <p class="hint"><span id="bridgeConnectStatus">正在偵測本機助手…</span></p>
      </li>
    </ol>
    <p class="hint">連線成功後，在下方按「完整環境安裝」即可一鍵安裝 ffmpeg 與 WhisperX。</p>
  `;
}

function scheduleOfflinePoll(refreshStatus) {
  if (offlinePollTimer) clearInterval(offlinePollTimer);
  offlinePollTimer = setInterval(async () => {
    const st = await checkLocalBridge();
    if (st) {
      clearInterval(offlinePollTimer);
      offlinePollTimer = null;
      await refreshStatus();
      return;
    }
    const el = document.getElementById('bridgeConnectStatus');
    if (el) el.textContent = `正在偵測本機助手…（${new Date().toLocaleTimeString()}）`;
  }, 2500);
}

export function initLocalTranscribe({ onTranscriptReady, showToast, getMode }) {
  const panel = document.getElementById('localBridgePanel');
  const offline = document.getElementById('demoOfflineHint');
  if (!panel) return;

  async function refreshStatus() {
    const st = await checkLocalBridge();
    const inDemo = getMode?.() === 'demo';
    if (!st) {
      panel.hidden = true;
      if (offline) {
        offline.hidden = !inDemo;
        if (inDemo) {
          renderOfflineWizard(offline);
          scheduleOfflinePoll(refreshStatus);
        }
      }
      return null;
    }
    if (offlinePollTimer) {
      clearInterval(offlinePollTimer);
      offlinePollTimer = null;
    }
    if (offline) offline.hidden = true;
    panel.hidden = false;
    if (!uploadBusy && !transcribeBusy) renderPanel(st);
    return st;
  }

  function renderPanel(st) {
    const checks = [
      ['python_ok', st.python_version ? `Python ${st.python_version}` : 'Python'],
      ['ffmpeg_ok', 'ffmpeg'],
      ['venv_ok', '轉錄環境'],
      ['whisperx_ok', 'WhisperX'],
      ['token_ok', 'HF_TOKEN'],
    ];
    const checkHtml = checks
      .map(([k, label]) => {
        const ok = st[k];
        return `<li><span class="bridge-badge ${ok ? 'ok' : 'bad'}">${ok ? 'OK' : '—'}</span>${escapeHTML(label)}</li>`;
      })
      .join('');
    const pythonWarn = st.python_warning
      ? `<p class="bridge-python-warn">${escapeHTML(st.python_warning)}</p>`
      : '';

    const files = st.mp4_files || [];
    if (!selectedMp4 || !files.includes(selectedMp4)) selectedMp4 = files[0] || null;

    const fileHtml = files.length
      ? files
          .map(
            (f) => `
        <label class="bridge-file ${f === selectedMp4 ? 'on' : ''}">
          <input type="radio" name="bridgeMp4" value="${escapeHTML(f)}" ${f === selectedMp4 ? 'checked' : ''}> ${escapeHTML(f)}
        </label>`
          )
          .join('')
      : '<p class="hint">請拖曳 MP4 到下方，或放到 demo-workspace\\input\\</p>';

    const setupBanner = needsFullSetup(st)
      ? `
      <div class="bridge-setup-banner">
        <strong>首次設定 — 一鍵安裝轉錄環境</strong>
        <p class="hint">會自動安裝 ffmpeg（若缺少）與 WhisperX 轉錄環境，首次約 5～15 分鐘。完成後再貼上 HF_TOKEN。</p>
        <div class="bridge-actions">
          <button type="button" class="btn primary" id="bridgeFullSetup">完整環境安裝</button>
          ${!st.ffmpeg_ok && st.winget_ok ? '<button type="button" class="btn" id="bridgeInstallFfmpeg">僅安裝 ffmpeg</button>' : ''}
          ${!st.venv_ok || !st.whisperx_ok ? '<button type="button" class="btn" id="bridgeSetup">僅安裝 WhisperX</button>' : ''}
        </div>
      </div>`
      : '';

    panel.innerHTML = `
      <p class="bridge-lead">錄影在本機轉成逐字稿後，會<strong>自動載入</strong>到上方分析區，不需手動上傳 SRT。</p>
      ${setupBanner}
      <ul class="bridge-checks">${checkHtml}</ul>
      ${pythonWarn}

      <div class="bridge-manual">
        <strong>推薦：大檔 DEMO 請手動複製（比拖曳快）</strong>
        <p class="hint" style="margin:6px 0 8px">用檔案總管將 MP4 <strong>複製</strong>到下方資料夾，再按「重新掃描」：</p>
        <code class="bridge-path">${escapeHTML(st.input_folder || 'demo-workspace\\input')}</code>
        <div class="bridge-actions" style="margin-top:10px">
          <button type="button" class="btn primary" id="bridgeOpenInput">開啟 input 資料夾</button>
          <button type="button" class="btn" id="bridgeRescan">重新掃描檔案</button>
        </div>
      </div>

      <p class="bridge-or">或透過瀏覽器拖曳（小檔較快；大檔可能需 5～15 分鐘）</p>
      <div class="bridge-files">${fileHtml}</div>
      <div class="bridge-drop" id="bridgeDrop">
        <span id="bridgeDropLabel">拖曳 MP4 到這裡，或點擊選擇檔案</span>
        <span class="bridge-drop-sub">將複製到本機 demo-workspace\\input\\（不上傳雲端）</span>
      </div>
      <input type="file" id="bridgeFileInput" accept=".mp4,video/mp4" hidden>
      <div class="bridge-upload-status hidden" id="bridgeUploadStatus"></div>
      <div class="bridge-progress hidden" id="bridgeProgress"><div id="bridgeProgressBar"></div></div>
      <button type="button" class="btn bridge-cancel hidden" id="bridgeCancelUpload">取消複製</button>
      <input type="password" id="bridgeToken" placeholder="HF_TOKEN（hf_...，首次請貼上）" class="bridge-token" ${st.token_ok ? 'style="display:none"' : ''}>
      <div class="bridge-actions">
        ${st.can_uninstall ? '<button type="button" class="btn bridge-uninstall" id="bridgeUninstall">解除安裝轉錄環境</button>' : ''}
        ${!st.token_ok ? '<button type="button" class="btn" id="bridgeOpenToken">前往取得 Token</button>' : ''}
        ${!st.token_ok ? '<button type="button" class="btn" id="bridgeSaveToken">儲存 Token</button>' : ''}
        <button type="button" class="btn primary" id="bridgeTranscribe" ${selectedMp4 && !transcribeBusy ? '' : 'disabled'}>開始本機轉錄</button>
        <button type="button" class="btn bridge-cancel hidden" id="bridgeCancelTranscribe">取消轉錄</button>
        <button type="button" class="btn" id="bridgeImport" ${st.srt_files?.length ? '' : 'disabled'}>載入最新 SRT</button>
      </div>
      <div class="bridge-transcribe-status hidden" id="bridgeTranscribeStatus"></div>
      <pre class="bridge-log hidden" id="bridgeLog"></pre>
      <p class="hint">2 小時以上 DEMO：音軌抽出可能需 5～15 分鐘，轉錄約 1.5～3 小時，請接電源。轉錄中請保持「啟動轉錄助手」視窗開啟。</p>
    `;

    panel.querySelectorAll('.bridge-file').forEach((el) => {
      el.onclick = () => {
        selectedMp4 = el.querySelector('input').value;
        refreshStatus();
      };
    });

    const drop = panel.querySelector('#bridgeDrop');
    const fileInput = panel.querySelector('#bridgeFileInput');
    drop.onclick = () => {
      if (!uploadBusy) fileInput?.click();
    };
    fileInput.onchange = () => {
      const file = fileInput.files?.[0];
      if (file) uploadMp4(file, showToast, refreshStatus);
      fileInput.value = '';
    };
    drop.ondragover = (e) => {
      e.preventDefault();
      if (!uploadBusy) drop.classList.add('drag');
    };
    drop.ondragleave = () => drop.classList.remove('drag');
    drop.ondrop = async (e) => {
      e.preventDefault();
      drop.classList.remove('drag');
      if (uploadBusy) return;
      const file = e.dataTransfer.files[0];
      if (file) await uploadMp4(file, showToast, refreshStatus);
    };

    panel.querySelector('#bridgeOpenInput')?.addEventListener('click', async () => {
      await api('/api/open-folder', { method: 'POST', body: JSON.stringify({ folder: 'input' }) });
      showToast('已開啟 input 資料夾 — 複製 MP4 後按「重新掃描」');
    });
    panel.querySelector('#bridgeRescan')?.addEventListener('click', async () => {
      showToast('正在掃描 input 資料夾…');
      await refreshStatus();
      showToast(selectedMp4 ? `已找到：${selectedMp4}` : '尚未找到 MP4，請確認已複製到 input');
    });
    panel.querySelector('#bridgeFullSetup')?.addEventListener('click', () =>
      runFullSetup(showToast, refreshStatus)
    );
    panel.querySelector('#bridgeInstallFfmpeg')?.addEventListener('click', () =>
      runInstallFfmpeg(showToast, refreshStatus)
    );
    panel.querySelector('#bridgeSetup')?.addEventListener('click', () => runSetup(showToast, refreshStatus));
    panel.querySelector('#bridgeUninstall')?.addEventListener('click', () => runUninstall(showToast, refreshStatus));
    panel.querySelector('#bridgeCancelUpload')?.addEventListener('click', () => {
      if (uploadXhr) uploadXhr.abort();
    });

    panel.querySelector('#bridgeOpenToken')?.addEventListener('click', () => openTokenPage(showToast));
    panel.querySelector('#bridgeSaveToken')?.addEventListener('click', () => saveToken(showToast, refreshStatus));
    panel.querySelector('#bridgeTranscribe')?.addEventListener('click', () => {
      const reason = transcribeBlockReason(st);
      if (reason) return showToast(reason);
      runTranscribe(onTranscriptReady, showToast, refreshStatus);
    });
    panel.querySelector('#bridgeCancelTranscribe')?.addEventListener('click', () =>
      cancelTranscribe(showToast, refreshStatus)
    );
    panel.querySelector('#bridgeImport')?.addEventListener('click', () => importLatest(onTranscriptReady, showToast));
    if (transcribeBusy) setTranscribeUI({ active: true });
    maybeAutoOpenTokenPage(st, showToast);
  }

  refreshStatus();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshStatus, 8000);
  window.__refreshBridge = refreshStatus;

  api('/api/job')
    .then((j) => {
      if (!j.running || j.kind !== 'transcribe') return;
      transcribeBusy = true;
      setTranscribeUI({ active: true, message: '本機轉錄進行中…' });
      showLog(j.logs || []);
      pollJob(async (ok, job) => {
        await refreshStatus();
        if (job.exit_code === 130) {
          showToast(job.cancel_uninstall ? '已取消轉錄並解除安裝' : '已取消轉錄');
          return;
        }
        if (ok) await importLatest(onTranscriptReady, showToast);
        else showToast('轉錄失敗，請查看記錄');
      }, { trackTranscribe: true });
    })
    .catch(() => {});
}

function setUploadUI({ state, message, pct = 0, showCancel = false }) {
  const status = document.getElementById('bridgeUploadStatus');
  const prog = document.getElementById('bridgeProgress');
  const bar = document.getElementById('bridgeProgressBar');
  const drop = document.getElementById('bridgeDrop');
  const cancel = document.getElementById('bridgeCancelUpload');
  if (!status) return;

  status.classList.remove('hidden', 'busy', 'ok', 'err');
  if (state === 'idle') {
    status.classList.add('hidden');
    prog?.classList.add('hidden');
    drop?.classList.remove('busy');
    cancel?.classList.add('hidden');
    return;
  }

  status.hidden = false;
  status.classList.add(state === 'uploading' ? 'busy' : state === 'ok' ? 'ok' : 'err');
  status.textContent = message;

  if (state === 'uploading') {
    drop?.classList.add('busy');
    prog?.classList.remove('hidden');
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (showCancel) cancel?.classList.remove('hidden');
    else cancel?.classList.add('hidden');
  } else {
    drop?.classList.remove('busy');
    prog?.classList.add('hidden');
    cancel?.classList.add('hidden');
  }
}

function uploadMp4XHR(file, onProgress) {
  return new Promise(async (resolve, reject) => {
    let token;
    try {
      token = await ensureApiToken();
    } catch (err) {
      reject(err);
      return;
    }
    uploadXhr = new XMLHttpRequest();
    uploadStartAt = Date.now();
    uploadXhr.open('POST', `${LOCAL_API}/api/upload`);
    uploadXhr.setRequestHeader(API_TOKEN_HEADER, token);
    uploadXhr.upload.onprogress = (e) => {
      const loaded = e.loaded;
      const total = e.lengthComputable ? e.total : file.size;
      const pct = total ? (loaded / total) * 100 : 0;
      const sec = Math.max(1, Math.floor((Date.now() - uploadStartAt) / 1000));
      const speed = loaded / sec;
      onProgress({ loaded, total, pct, sec, speed });
    };
    uploadXhr.onload = () => {
      const xhr = uploadXhr;
      uploadXhr = null;
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status >= 400 || !data.ok) {
          reject(new Error(data.message || `上傳失敗（HTTP ${xhr.status}）`));
          return;
        }
        resolve(data);
      } catch {
        reject(new Error('伺服器回應異常，請確認轉錄助手已啟動'));
      }
    };
    uploadXhr.onerror = () => {
      uploadXhr = null;
      reject(new Error('連線失敗，請確認已雙擊 start_call_coach 且視窗未關閉'));
    };
    uploadXhr.onabort = () => {
      uploadXhr = null;
      reject(new Error('已取消複製'));
    };
    uploadXhr.ontimeout = () => {
      uploadXhr = null;
      reject(new Error('複製逾時，建議改用「開啟 input 資料夾」手動複製'));
    };
    uploadXhr.timeout = 0;
    const fd = new FormData();
    fd.append('file', file);
    uploadXhr.send(fd);
  });
}

async function uploadMp4(file, showToast, refreshStatus) {
  if (!file.name.toLowerCase().endsWith('.mp4')) {
    setUploadUI({ state: 'err', message: '請選擇 .mp4 錄影檔' });
    showToast('請選擇 MP4 檔案');
    return;
  }

  const sizeMb = file.size / (1024 * 1024);
  if (sizeMb >= LARGE_FILE_MB) {
    const manual = confirm(
      `檔案約 ${fmtSize(file.size)}，透過瀏覽器複製可能很慢（5～15 分鐘），進度也可能暫停。\n\n` +
        `建議：按「開啟 input 資料夾」手動複製 MP4，再按「重新掃描」。\n\n` +
        `仍要用瀏覽器複製嗎？`
    );
    if (!manual) {
      showToast('建議手動複製到 input 資料夾');
      return;
    }
  }

  uploadBusy = true;
  setUploadUI({
    state: 'uploading',
    message: `準備複製 ${file.name}（${fmtSize(file.size)}）…`,
    pct: 0,
    showCancel: true,
  });
  showToast(`開始複製 ${file.name}…（大檔請耐心等候）`);

  try {
    const r = await uploadMp4XHR(file, ({ loaded, total, pct, sec, speed }) => {
      const stalled = pct < 1 && sec > 30;
      setUploadUI({
        state: 'uploading',
        message:
          `正在複製… ${fmtSize(loaded)} / ${fmtSize(total)}（${pct.toFixed(0)}%）` +
          ` · 已 ${fmtElapsed(sec)} · ${fmtSpeed(speed)}` +
          (stalled ? ' · 若長時間無進度，請取消並改用手動複製' : ''),
        pct,
        showCancel: true,
      });
    });
    selectedMp4 = r.filename;
    setUploadUI({ state: 'ok', message: `✓ 已放入本機 input：${r.filename}（${fmtSize(file.size)}）` });
    showToast(`已放入本機 input：${r.filename} — 可按「開始本機轉錄」`);
    setTimeout(() => setUploadUI({ state: 'idle' }), 5000);
  } catch (err) {
    const msg = err?.message || '上傳失敗';
    setUploadUI({ state: 'err', message: `✗ ${msg}` });
    showToast(msg);
  } finally {
    uploadBusy = false;
    uploadXhr = null;
    await refreshStatus();
  }
}

function setTranscribeUI({ active, message = '本機轉錄進行中…請保持助手視窗開啟' }) {
  const status = document.getElementById('bridgeTranscribeStatus');
  const cancel = document.getElementById('bridgeCancelTranscribe');
  const start = document.getElementById('bridgeTranscribe');
  if (!status) return;

  if (active) {
    status.classList.remove('hidden');
    status.classList.add('busy');
    status.textContent = message;
    cancel?.classList.remove('hidden');
    if (start) start.disabled = true;
  } else {
    status.classList.add('hidden');
    status.classList.remove('busy');
    cancel?.classList.add('hidden');
  }
}

function showLog(lines) {
  const el = document.getElementById('bridgeLog');
  if (!el) return;
  el.classList.remove('hidden');
  el.textContent = (lines || []).join('\n');
  el.scrollTop = el.scrollHeight;
}

function transcribeBlockReason(st) {
  if (!selectedMp4) return '請先選擇或放入 MP4';
  if (!st?.python_ok) return '需要 Python 3.10+（請確認轉錄助手視窗已啟動）';
  if (!st?.venv_ok || !st?.whisperx_ok) return '請先按「一鍵安裝」完成轉錄環境';
  if (!st?.token_ok) return '請先設定 HF_TOKEN';
  return '';
}

async function pollJob(onDone, { trackTranscribe = false } = {}) {
  clearInterval(pollTimer);
  const tick = async () => {
    try {
      const j = await api('/api/job');
      showLog(j.logs);
      if (trackTranscribe && j.running && j.kind === 'transcribe') {
        setTranscribeUI({ active: true, message: j.cancel_requested ? '正在取消轉錄…' : '本機轉錄進行中…' });
      }
      if (!j.running && j.exit_code !== null) {
        clearInterval(pollTimer);
        if (trackTranscribe) {
          transcribeBusy = false;
          setTranscribeUI({ active: false });
        }
        onDone(j.exit_code === 0, j);
      }
    } catch {
      clearInterval(pollTimer);
      if (trackTranscribe) {
        transcribeBusy = false;
        setTranscribeUI({ active: false });
      }
      onDone(false, { logs: ['[錯誤] 無法連線本機轉錄助手'] });
    }
  };
  await tick();
  pollTimer = setInterval(tick, 800);
}

async function runSetupJob(endpoint, startMsg, doneMsg, showToast, refreshStatus) {
  try {
    const r = await api(endpoint, { method: 'POST' });
    if (!r.ok) return showToast(r.message || '無法開始安裝');
    showToast(startMsg);
    showLog(['安裝進行中…']);
    pollJob((ok) => {
      showToast(ok ? doneMsg : '安裝失敗，請查看記錄');
      refreshStatus().then((st) => {
        if (ok && st && !st.token_ok) openTokenPage(showToast);
      });
    });
  } catch (err) {
    showToast(err?.message || '無法連線本機轉錄助手');
  }
}

async function runSetup(showToast, refreshStatus) {
  return runSetupJob('/api/setup', '開始安裝 WhisperX…', 'WhisperX 安裝完成', showToast, refreshStatus);
}

async function runInstallFfmpeg(showToast, refreshStatus) {
  return runSetupJob('/api/install-ffmpeg', '開始安裝 ffmpeg…', 'ffmpeg 安裝完成', showToast, refreshStatus);
}

async function runFullSetup(showToast, refreshStatus) {
  return runSetupJob(
    '/api/full-setup',
    '開始完整環境安裝（ffmpeg + WhisperX）…',
    '完整環境安裝完成',
    showToast,
    refreshStatus
  );
}

async function cancelTranscribe(showToast, refreshStatus) {
  const sure = confirm('確定要取消轉錄嗎？\n\n已處理的進度將不會保存。');
  if (!sure) return;

  const uninstall = confirm(
    '是否同時解除安裝轉錄環境（.venv）？\n\n' +
      '確定 = 停止轉錄並解除安裝\n' +
      '取消 = 僅停止轉錄，保留環境'
  );

  let removeModels = false;
  if (uninstall) {
    removeModels = confirm(
      '是否同時刪除 models 快取（約 3～6 GB）？\n\n' +
        '確定 = 一併刪除（下次安裝需重新下載）\n' +
        '取消 = 保留 models（下次安裝較快）'
    );
  }

  const r = await api('/api/cancel', {
    method: 'POST',
    body: JSON.stringify({ uninstall, remove_models: removeModels }),
  });
  if (!r.ok) return showToast(r.message || '無法取消');
  showToast(uninstall ? '正在取消並解除安裝…' : '正在取消轉錄…');
  setTranscribeUI({ active: true, message: '正在取消轉錄…' });
}

async function runUninstall(showToast, refreshStatus) {
  const sure = confirm(
    '確定要解除安裝轉錄環境嗎？\n\n' +
      '將刪除：.venv（WhisperX）\n' +
      '保留：input / output / .env / models'
  );
  if (!sure) return;

  const removeModels = confirm(
    '是否同時刪除 models 快取（約 3～6 GB）？\n\n' +
      '確定 = 一併刪除（下次安裝需重新下載）\n' +
      '取消 = 保留 models（下次安裝較快）'
  );

  const r = await api('/api/uninstall', {
    method: 'POST',
    body: JSON.stringify({ remove_models: removeModels }),
  });
  if (!r.ok) return showToast(r.message);
  showToast('開始解除安裝…');
  pollJob((ok) => {
    showToast(ok ? '已解除安裝' : '解除安裝失敗');
    refreshStatus();
  });
}

async function saveToken(showToast, refreshStatus) {
  const token = document.getElementById('bridgeToken')?.value?.trim();
  if (!token) {
    showToast('請先取得 Token');
    await openTokenPage(showToast);
    return;
  }
  const r = await api('/api/token', { method: 'POST', body: JSON.stringify({ token }) });
  if (!r.ok) return showToast(r.message || '儲存失敗');
  showToast('Token 已儲存');
  refreshStatus();
}

async function runTranscribe(onTranscriptReady, showToast, refreshStatus) {
  if (!selectedMp4) return showToast('請先選擇 MP4');
  try {
    const r = await api('/api/transcribe', { method: 'POST', body: JSON.stringify({ mp4: selectedMp4 }) });
    if (!r.ok) return showToast(r.message || '無法開始轉錄');
    transcribeBusy = true;
    setTranscribeUI({ active: true, message: '正在啟動轉錄…' });
    showLog(['正在啟動本機轉錄，請稍候…']);
    showToast('本機轉錄中…（長影片音軌抽出可能需數分鐘才會出現進度）');
    pollJob(async (ok, j) => {
      await refreshStatus();
      if (j.exit_code === 130) {
        showToast(j.cancel_uninstall ? '已取消轉錄並解除安裝' : '已取消轉錄');
        return;
      }
      if (ok) await importLatest(onTranscriptReady, showToast);
      else showToast('轉錄失敗，請查看記錄');
    }, { trackTranscribe: true });
  } catch (err) {
    transcribeBusy = false;
    setTranscribeUI({ active: false });
    showToast(err?.message || '無法連線本機轉錄助手');
  }
}

async function importLatest(onTranscriptReady, showToast) {
  const r = await api('/api/srt/latest');
  if (!r.ok) return showToast(r.message || '找不到 SRT');
  onTranscriptReady(r.content, r.filename);
  showToast(`已載入 ${r.filename}`);
}
