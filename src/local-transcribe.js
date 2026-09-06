/**
 * Bridge Call Coach (GitHub Pages) ↔ local demo_app.py (127.0.0.1:8765).
 * DEMO audio never leaves the machine; only finished SRT is loaded into Call Coach.
 */
const LOCAL_API = 'http://127.0.0.1:8765';

let pollTimer = null;
let refreshTimer = null;
let selectedMp4 = null;
let uploadBusy = false;

function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function api(path, opts = {}) {
  const res = await fetch(`${LOCAL_API}${path}`, { ...opts, mode: 'cors' });
  return res.json();
}

export async function checkLocalBridge() {
  try {
    const st = await api('/api/status');
    return st && typeof st.python_ok === 'boolean' ? st : null;
  } catch {
    return null;
  }
}

export function initLocalTranscribe({ onTranscriptReady, showToast }) {
  const details = document.querySelector('.demo-guide');
  const summary = details?.querySelector('summary');
  const staticBlock = document.getElementById('demoGuideStatic');
  const panel = document.getElementById('localBridgePanel');
  if (!details || !staticBlock || !panel) return;

  const openIfHash = () => {
    if (location.hash === '#transcribe') details.open = true;
  };
  openIfHash();
  window.addEventListener('hashchange', openIfHash);

  async function refreshStatus() {
    const st = await checkLocalBridge();
    if (!st) {
      summary.textContent = '還沒有 DEMO 逐字稿？本機轉錄指引（1～2 小時錄影・不上雲）';
      panel.hidden = true;
      staticBlock.hidden = false;
      return null;
    }
    summary.textContent = '● 本機轉錄助手已連線 — 可直接在此轉 DEMO（音檔不上傳）';
    panel.hidden = false;
    staticBlock.hidden = true;
    if (!uploadBusy) renderPanel(st);
    return st;
  }

  function renderPanel(st) {
    const checks = [
      ['python_ok', 'Python'],
      ['ffmpeg_ok', 'ffmpeg'],
      ['venv_ok', '轉錄環境'],
      ['whisperx_ok', 'WhisperX'],
      ['token_ok', 'HF_TOKEN'],
    ];
    const checkHtml = checks
      .map(([k, label]) => {
        const ok = st[k];
        return `<li><span class="bridge-badge ${ok ? 'ok' : 'bad'}">${ok ? 'OK' : '—'}</span>${label}</li>`;
      })
      .join('');

    const files = st.mp4_files || [];
    if (!selectedMp4 || !files.includes(selectedMp4)) selectedMp4 = files[0] || null;

    const fileHtml = files.length
      ? files
          .map(
            (f) => `
        <label class="bridge-file ${f === selectedMp4 ? 'on' : ''}">
          <input type="radio" name="bridgeMp4" value="${f}" ${f === selectedMp4 ? 'checked' : ''}> ${f}
        </label>`
          )
          .join('')
      : '<p class="hint">請拖曳 MP4 到下方，或放到 demo-workspace\\input\\</p>';

    panel.innerHTML = `
      <p class="bridge-lead">錄影在本機轉成逐字稿後，會<strong>自動載入</strong>到上方分析區，不需手動上傳 SRT。</p>
      <ul class="bridge-checks">${checkHtml}</ul>
      <div class="bridge-files">${fileHtml}</div>
      <div class="bridge-drop" id="bridgeDrop">
        <span id="bridgeDropLabel">拖曳 MP4 到這裡，或點擊選擇檔案</span>
        <span class="bridge-drop-sub">將複製到本機 demo-workspace\\input\\（不上傳雲端）</span>
      </div>
      <input type="file" id="bridgeFileInput" accept=".mp4,video/mp4" hidden>
      <div class="bridge-upload-status hidden" id="bridgeUploadStatus"></div>
      <div class="bridge-progress hidden" id="bridgeProgress"><div id="bridgeProgressBar"></div></div>
      <input type="password" id="bridgeToken" placeholder="HF_TOKEN（hf_...，首次請貼上）" class="bridge-token" ${st.token_ok ? 'style="display:none"' : ''}>
      <div class="bridge-actions">
        ${!st.venv_ok || !st.whisperx_ok ? '<button type="button" class="btn primary" id="bridgeSetup">一鍵安裝</button>' : ''}
        ${!st.token_ok ? '<button type="button" class="btn" id="bridgeSaveToken">儲存 Token</button>' : ''}
        <button type="button" class="btn primary" id="bridgeTranscribe" ${st.ready_to_transcribe && selectedMp4 ? '' : 'disabled'}>開始本機轉錄</button>
        <button type="button" class="btn" id="bridgeImport" ${st.srt_files?.length ? '' : 'disabled'}>載入最新 SRT</button>
      </div>
      <pre class="bridge-log hidden" id="bridgeLog"></pre>
      <p class="hint">2 小時 DEMO 約 1.5～3 小時，請接電源。轉錄中請保持「啟動轉錄助手」視窗開啟。</p>
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

    panel.querySelector('#bridgeSetup')?.addEventListener('click', () => runSetup(showToast, refreshStatus));
    panel.querySelector('#bridgeSaveToken')?.addEventListener('click', () => saveToken(showToast, refreshStatus));
    panel.querySelector('#bridgeTranscribe')?.addEventListener('click', () =>
      runTranscribe(onTranscriptReady, showToast, refreshStatus)
    );
    panel.querySelector('#bridgeImport')?.addEventListener('click', () => importLatest(onTranscriptReady, showToast));
  }

  refreshStatus();
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshStatus, 8000);
}

function setUploadUI({ state, message, pct = 0 }) {
  const status = document.getElementById('bridgeUploadStatus');
  const prog = document.getElementById('bridgeProgress');
  const bar = document.getElementById('bridgeProgressBar');
  const drop = document.getElementById('bridgeDrop');
  if (!status) return;

  status.classList.remove('hidden', 'busy', 'ok', 'err');
  if (state === 'idle') {
    status.classList.add('hidden');
    prog?.classList.add('hidden');
    drop?.classList.remove('busy');
    return;
  }

  status.hidden = false;
  status.classList.add(state === 'uploading' ? 'busy' : state === 'ok' ? 'ok' : 'err');
  status.textContent = message;

  if (state === 'uploading') {
    drop?.classList.add('busy');
    prog?.classList.remove('hidden');
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
  } else {
    drop?.classList.remove('busy');
    prog?.classList.add('hidden');
  }
}

function uploadMp4XHR(file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${LOCAL_API}/api/upload`);
    xhr.upload.onprogress = (e) => {
      const pct = e.lengthComputable ? (e.loaded / e.total) * 100 : 0;
      setUploadUI({
        state: 'uploading',
        message: `正在複製到本機 input… ${fmtSize(e.loaded)} / ${fmtSize(e.total || file.size)}（${pct.toFixed(0)}%）`,
        pct,
      });
    };
    xhr.onload = () => {
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
    xhr.onerror = () => reject(new Error('連線失敗，請確認已雙擊 start_demo_app 且視窗未關閉'));
    xhr.ontimeout = () => reject(new Error('上傳逾時，檔案可能過大或磁碟空間不足'));
    xhr.timeout = 0;
    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}

async function uploadMp4(file, showToast, refreshStatus) {
  if (!file.name.toLowerCase().endsWith('.mp4')) {
    setUploadUI({ state: 'err', message: '請選擇 .mp4 錄影檔' });
    showToast('請選擇 MP4 檔案');
    return;
  }

  uploadBusy = true;
  setUploadUI({
    state: 'uploading',
    message: `準備上傳 ${file.name}（${fmtSize(file.size)}）…`,
    pct: 0,
  });
  showToast(`開始複製 ${file.name} 到本機…`);

  try {
    const r = await uploadMp4XHR(file);
    selectedMp4 = r.filename;
    setUploadUI({ state: 'ok', message: `✓ 已放入本機 input：${r.filename}（${fmtSize(file.size)}）` });
    showToast(`已放入本機 input：${r.filename}`);
    await refreshStatus();
    setTimeout(() => setUploadUI({ state: 'idle' }), 5000);
  } catch (err) {
    const msg = err?.message || '上傳失敗';
    setUploadUI({ state: 'err', message: `✗ ${msg}` });
    showToast(msg);
  } finally {
    uploadBusy = false;
  }
}

function showLog(lines) {
  const el = document.getElementById('bridgeLog');
  if (!el) return;
  el.classList.remove('hidden');
  el.textContent = (lines || []).join('\n');
  el.scrollTop = el.scrollHeight;
}

async function pollJob(onDone) {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const j = await api('/api/job');
    showLog(j.logs);
    if (!j.running && j.exit_code !== null) {
      clearInterval(pollTimer);
      onDone(j.exit_code === 0);
    }
  }, 800);
}

async function runSetup(showToast, refreshStatus) {
  const r = await api('/api/setup', { method: 'POST' });
  if (!r.ok) return showToast(r.message);
  showToast('開始安裝…');
  pollJob((ok) => {
    showToast(ok ? '安裝完成' : '安裝失敗');
    refreshStatus();
  });
}

async function saveToken(showToast, refreshStatus) {
  const token = document.getElementById('bridgeToken')?.value?.trim();
  if (!token) return showToast('請貼上 Token');
  const r = await api('/api/token', { method: 'POST', body: JSON.stringify({ token }) });
  if (!r.ok) return showToast(r.message || '儲存失敗');
  showToast('Token 已儲存');
  refreshStatus();
}

async function runTranscribe(onTranscriptReady, showToast, refreshStatus) {
  if (!selectedMp4) return showToast('請先選擇 MP4');
  const r = await api('/api/transcribe', { method: 'POST', body: JSON.stringify({ mp4: selectedMp4 }) });
  if (!r.ok) return showToast(r.message);
  showToast('本機轉錄中…');
  pollJob(async (ok) => {
    refreshStatus();
    if (ok) await importLatest(onTranscriptReady, showToast);
    else showToast('轉錄失敗，請查看記錄');
  });
}

async function importLatest(onTranscriptReady, showToast) {
  const r = await api('/api/srt/latest');
  if (!r.ok) return showToast(r.message || '找不到 SRT');
  onTranscriptReady(r.content, r.filename);
  showToast(`已載入 ${r.filename}`);
}
