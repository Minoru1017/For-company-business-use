/**
 * Bridge Call Coach (GitHub Pages) ↔ local demo_app.py (127.0.0.1:8765).
 * DEMO audio never leaves the machine; only finished SRT is loaded into Call Coach.
 */
import { escapeHTML } from './utils.js';
import {
  enableNotifications,
  notificationState,
  notifyEnabled,
  notifyJobDone,
  progressTitle,
  renderProgressHtml,
  setNotifyEnabled,
  waitSummary,
} from './wait-progress.js';

const LOCAL_API = 'http://127.0.0.1:8765';
const API_TOKEN_HEADER = 'X-Call-Coach-Token';

let pollTimer = null;
let baseTitle = '';
let lastBridgeStatus = null;
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
const TRANSCRIBE_MODE_KEY = 'callCoachTranscribeMode';
const CLOUD_CONSENT_KEY = 'callCoachCloudConsent';
const VALID_MODES = new Set(['fast', 'standard', 'azure']);
const AZURE_FAST_REGIONS_HINT = 'southeastasia（新加坡）或 japaneast（東京）';
// Mode is only "chosen" once the user clicks a radio; until then we follow the
// assistant's default_mode (Azure when the team config / .env provides a key).
let modeChosenByUser = VALID_MODES.has(localStorage.getItem(TRANSCRIBE_MODE_KEY));
let transcribeMode = modeChosenByUser ? localStorage.getItem(TRANSCRIBE_MODE_KEY) : 'standard';
let cloudConsent = localStorage.getItem(CLOUD_CONSENT_KEY) === '1';
let azureFormOpen = false;
let teamPanelOpen = false;
const REPO_ZIP_URL = 'https://github.com/Minoru1017/For-company-business-use/archive/refs/heads/main.zip';
const ASSISTANT_SETUP_URL =
  'https://github.com/Minoru1017/For-company-business-use/releases/latest/download/CallCoachAssistant-Setup.exe';
const ASSISTANT_ZIP_URL =
  'https://github.com/Minoru1017/For-company-business-use/releases/latest/download/CallCoachAssistant-Windows.zip';
const ASSISTANT_RELEASE_PAGE =
  'https://github.com/Minoru1017/For-company-business-use/releases/latest';

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
  if (transcribeMode === 'azure') return;
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

function bridgeFetchError(err) {
  const msg = String(err?.message || '');
  if (/failed to fetch|networkerror|network error|load failed/i.test(msg)) {
    return (
      '無法連線本機轉錄助手。請確認：① 已從開始選單啟動「Call Coach 本機助手」或安裝精靈已完成 ' +
      '② 網頁在 DEMO 模式 ③ 已安裝最新版（Releases）'
    );
  }
  return msg || '無法連線本機轉錄助手';
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
    lastBridgeStatus = st && typeof st.python_ok === 'boolean' ? st : null;
  } catch {
    lastBridgeStatus = null;
  }
  return lastBridgeStatus;
}

/** 最近一次偵測到的助手狀態（不發請求）；離線時為 null。 */
export function getBridgeStatus() {
  return lastBridgeStatus;
}

export function bridgeSupports(capability) {
  return !!lastBridgeStatus?.api_capabilities?.includes?.(capability);
}

/** 把報告／已標記 SRT 存到助手的 output 資料夾（與逐字稿放在一起）。 */
export async function saveReportToBridge(filename, content) {
  return api('/api/report', { method: 'POST', body: JSON.stringify({ filename, content }) });
}

export async function openBridgeFolder(folder = 'output') {
  return api('/api/open-folder', { method: 'POST', body: JSON.stringify({ folder }) });
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
        <strong>① 公司電腦 — 安裝精靈（推薦）</strong>
        <p class="hint">下載 <code>CallCoachAssistant-Setup.exe</code>，執行安裝精靈（建議安裝到 <code>C:\\CallCoachAssistant</code>）。若主管有給你 <code>team-config.env</code>，把它放在 Setup.exe 旁邊再執行，安裝後即可直接用 Azure 雲端轉錄（不需下載 WhisperX、不需 Token）。完成後從開始選單啟動「Call Coach 本機助手」。</p>
        <div class="bridge-actions">
          <a class="btn primary" href="${ASSISTANT_SETUP_URL}" target="_blank" rel="noopener noreferrer">下載安裝精靈（Setup.exe）</a>
          <a class="btn" href="${ASSISTANT_RELEASE_PAGE}" target="_blank" rel="noopener noreferrer">Releases 頁面</a>
        </div>
      </li>
      <li>
        <strong>② 或 ZIP 免安裝版</strong>
        <p class="hint">下載 <code>CallCoachAssistant-Windows.zip</code>，解壓後雙擊 <code>啟動 Call Coach.cmd</code>（部分公司電腦會封鎖 .cmd）。</p>
        <div class="bridge-actions">
          <a class="btn" href="${ASSISTANT_ZIP_URL}" target="_blank" rel="noopener noreferrer">下載 ZIP 版</a>
        </div>
      </li>
      <li>
        <strong>③ 等待連線</strong>
        <p class="hint"><span id="bridgeConnectStatus">正在偵測本機助手…</span></p>
      </li>
    </ol>
    <p class="hint">助手連線後會出現「首次啟動檢查」清單，缺什麼就按旁邊的按鈕補齊；沒有助手也可先按上方「載入範例逐字稿」試用分析。</p>
  `;
}

function applyDefaultMode(st) {
  if (modeChosenByUser) return;
  if (st?.default_mode && VALID_MODES.has(st.default_mode)) transcribeMode = st.default_mode;
}

function checklistItems(st) {
  const files = st.mp4_files || [];
  const items = [
    { ok: true, label: '本機助手已連線', detail: st.python_version ? `Python ${st.python_version}` : '' },
    {
      ok: !!st.ffmpeg_ok,
      label: 'ffmpeg（抽出音軌）',
      fix: st.ffmpeg_ok
        ? null
        : st.winget_ok && !st.bundled_ffmpeg
          ? { action: 'install-ffmpeg', text: '安裝 ffmpeg' }
          : { action: 'full-setup', text: '完整環境安裝' },
    },
  ];
  if (transcribeMode === 'azure') {
    items.push({
      ok: !!st.azure_ok,
      label: st.azure_ok ? `Azure Speech（${st.azure_region}）` : 'Azure Speech 金鑰與區域',
      detail: st.team_config?.present && st.team_config?.provides_azure ? '由團隊設定提供' : '',
      warn:
        st.azure_ok && !st.azure_fast_ok
          ? `區域 ${st.azure_region} 沒有 Fast Transcription，會退回較慢的 SDK 模式；建議改用 ${AZURE_FAST_REGIONS_HINT}`
          : '',
      fix: st.azure_ok ? null : { action: 'azure', text: '填入金鑰／匯入團隊設定' },
    });
    items.push({
      ok: cloudConsent,
      label: '知情同意（音訊上傳至 Azure）',
      fix: cloudConsent ? null : { action: 'consent', text: '勾選同意' },
    });
  } else {
    items.push({
      ok: !!(st.venv_ok && st.whisperx_ok),
      label: 'WhisperX 本機轉錄環境',
      detail: st.venv_ok && st.whisperx_ok ? '' : '約 1～3 GB，5～15 分鐘',
      fix: st.venv_ok && st.whisperx_ok ? null : { action: 'full-setup', text: '完整環境安裝' },
    });
    items.push({
      ok: !!st.token_ok,
      label: 'Hugging Face Token（分軌模型授權）',
      fix: st.token_ok ? null : { action: 'token', text: '取得並貼上 Token' },
    });
  }
  items.push({
    ok: files.length > 0,
    label: files.length ? `DEMO 錄影檔（${files.length} 個 MP4）` : 'DEMO 錄影檔（MP4）',
    fix: files.length ? null : { action: 'open-input', text: '開啟 input 資料夾' },
  });
  return items;
}

function renderChecklist(st) {
  const items = checklistItems(st);
  const done = items.filter((i) => i.ok).length;
  const allOk = done === items.length;
  const rows = items
    .map((i) => {
      const fix = i.fix
        ? `<button type="button" class="btn bridge-fix" data-fix="${i.fix.action}">${escapeHTML(i.fix.text)}</button>`
        : '';
      const detail = i.detail ? `<span class="bridge-check-detail">${escapeHTML(i.detail)}</span>` : '';
      const warn = i.warn ? `<p class="bridge-check-warn">▲ ${escapeHTML(i.warn)}</p>` : '';
      return `
      <li class="${i.ok ? 'ok' : 'todo'}">
        <span class="bridge-badge ${i.ok ? 'ok' : 'bad'}">${i.ok ? 'OK' : '待辦'}</span>
        <span class="bridge-check-label">${escapeHTML(i.label)}${detail}</span>
        ${fix}
        ${warn}
      </li>`;
    })
    .join('');
  const team = st.team_config?.present
    ? `<p class="bridge-team-note">✓ 已套用團隊設定${st.team_config.team_name ? `：${escapeHTML(st.team_config.team_name)}` : ''}</p>`
    : '';
  return `
    <div class="bridge-checklist ${allOk ? 'ready' : ''}">
      <div class="bridge-checklist-head">
        <strong>${allOk ? '✓ 一切就緒 — 可以開始轉錄' : `首次啟動檢查 ${done}/${items.length}`}</strong>
        <span class="bridge-checklist-mode">${escapeHTML(modeShortLabel())}</span>
      </div>
      ${team}
      <ul class="bridge-checks bridge-checks-list">${rows}</ul>
    </div>`;
}

function modeShortLabel() {
  if (transcribeMode === 'azure') return 'Azure 雲端';
  if (transcribeMode === 'fast') return '本機 · 快速';
  return '本機 · 標準';
}

function renderTeamPanel(st) {
  const info = st.team_config || {};
  const canExport = !!st.azure_ok || !!st.token_ok;
  return `
    <details class="bridge-team" id="bridgeTeamPanel" ${teamPanelOpen ? 'open' : ''}>
      <summary>團隊設定（同事匯入 / 管理者匯出）</summary>
      <p class="hint">管理者把 Azure 金鑰與區域匯出成 <code>team-config.env</code> 私下分享；同事在此匯入，或放在 Setup.exe 旁一起安裝，就不需各自申請 Azure 或 Hugging Face。</p>
      ${info.present ? `<p class="hint">目前已套用：<code>${escapeHTML(info.path || 'team-config.env')}</code></p>` : ''}
      <textarea id="bridgeTeamText" class="bridge-team-text" rows="4" placeholder="貼上 team-config.env 內容，或用下方按鈕選擇檔案&#10;AZURE_SPEECH_KEY=...&#10;AZURE_SPEECH_REGION=southeastasia"></textarea>
      <input type="file" id="bridgeTeamFile" accept=".env,.txt,text/plain" hidden>
      <div class="bridge-actions">
        <button type="button" class="btn" id="bridgeTeamPick">選擇 team-config.env</button>
        <button type="button" class="btn primary" id="bridgeTeamImport">匯入團隊設定</button>
        ${canExport ? '<button type="button" class="btn" id="bridgeTeamExport">匯出目前設定（管理者）</button>' : ''}
      </div>
      ${
        canExport
          ? `<label class="bridge-team-opt"><input type="checkbox" id="bridgeTeamIncludeHf" ${st.token_ok ? '' : 'disabled'}> 匯出時包含 Hugging Face Token（同事要用本機模式才需要）</label>`
          : ''
      }
    </details>`;
}

function renderAzureConfig(st) {
  const show = transcribeMode === 'azure' && (!st.azure_ok || azureFormOpen);
  const region = st.azure_region || 'southeastasia';
  const toggle =
    transcribeMode === 'azure' && st.azure_ok
      ? `<p class="hint bridge-azure-ok">Azure：已設定（${escapeHTML(st.azure_region)}${st.azure_fast_ok ? '，Fast Transcription' : ''}）
          <button type="button" class="btn bridge-inline-btn" id="bridgeAzureToggle">${azureFormOpen ? '收合' : '更改'}</button></p>`
      : '';
  return `
    ${toggle}
    <div class="bridge-azure-config ${show ? '' : 'hidden'}" id="bridgeAzureConfig">
      <input type="password" id="bridgeAzureKey" placeholder="Azure Speech 金鑰（Key 1）" class="bridge-token" autocomplete="off">
      <input type="text" id="bridgeAzureRegion" placeholder="Azure 區域（建議 southeastasia）" class="bridge-token" value="${escapeHTML(region)}">
      <p class="hint">請選有 Fast Transcription 的區域：${AZURE_FAST_REGIONS_HINT}；<code>eastasia</code>（香港）目前沒有。金鑰只存在本機 <code>.env</code>。</p>
      <div class="bridge-actions">
        <button type="button" class="btn primary" id="bridgeSaveAzure">儲存 Azure 設定</button>
        <button type="button" class="btn" id="bridgeAzureFromTeam">改用團隊設定檔匯入</button>
      </div>
    </div>`;
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
    applyDefaultMode(st);
    if (!uploadBusy && !transcribeBusy) renderPanel(st);
    return st;
  }

  function renderPanel(st) {
    const pythonWarn = st.python_warning
      ? `<p class="bridge-python-warn">${escapeHTML(st.python_warning)}</p>`
      : '';
    const sacWarn = sacBanner(st.smart_app_control);

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

    const localNeedsSetup = needsFullSetup(st);
    const advancedLocal =
      transcribeMode === 'azure' && localNeedsSetup
        ? `
      <details class="bridge-advanced">
        <summary>進階：安裝本機 WhisperX（音訊完全不上雲）</summary>
        <p class="hint">需下載約 1～3 GB、首次 5～15 分鐘，且需 Hugging Face Token。Azure 模式不需要這一步。</p>
        <div class="bridge-actions">
          <button type="button" class="btn" data-fix="full-setup">完整環境安裝</button>
          ${!st.venv_ok || !st.whisperx_ok ? '<button type="button" class="btn" id="bridgeSetup">僅安裝 WhisperX</button>' : ''}
        </div>
      </details>`
        : '';

    panel.innerHTML = `
      <p class="bridge-lead">錄影轉成逐字稿後，會<strong>自動載入</strong>到上方分析區，不需手動上傳 SRT。</p>
      ${renderChecklist(st)}
      ${advancedLocal}
      ${pythonWarn}
      ${sacWarn}

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
      <div class="bridge-mode-panel">
        <strong>轉錄模式</strong>
        <label class="bridge-mode-option">
          <input type="radio" name="bridgeMode" value="azure" ${transcribeMode === 'azure' ? 'checked' : ''}>
          Azure 雲端轉錄（zh-TW，48 分鐘約 2～5 分鐘完成；免安裝、不需 Token）${st.default_mode === 'azure' ? ' <span class="bridge-mode-default">團隊預設</span>' : ''}
        </label>
        <label class="bridge-mode-option">
          <input type="radio" name="bridgeMode" value="standard" ${transcribeMode === 'standard' ? 'checked' : ''}>
          標準模式（Faster-Whisper medium，本機、不上雲）
        </label>
        <label class="bridge-mode-option">
          <input type="radio" name="bridgeMode" value="fast" ${transcribeMode === 'fast' ? 'checked' : ''}>
          快速模式（Faster-Whisper small，本機、不上雲）
        </label>
        <label class="bridge-consent ${transcribeMode === 'azure' ? '' : 'hidden'}" id="bridgeCloudConsentWrap">
          <input type="checkbox" id="bridgeCloudConsent" ${cloudConsent ? 'checked' : ''}>
          我了解 DEMO 音訊將上傳至 <strong>Microsoft Azure Speech</strong> 進行轉錄（僅用於產生逐字稿，Azure 處理完不保留，不會存入 Call Coach 網站）
        </label>
        ${renderAzureConfig(st)}
        <div class="bridge-token-wrap ${transcribeMode !== 'azure' && !st.token_ok ? '' : 'hidden'}">
          <input type="password" id="bridgeToken" placeholder="HF_TOKEN（hf_...，本機轉錄分軌模型授權）" class="bridge-token" autocomplete="off">
          <div class="bridge-actions">
            <button type="button" class="btn" id="bridgeOpenToken">前往取得 Token</button>
            <button type="button" class="btn primary" id="bridgeSaveToken">儲存 Token</button>
          </div>
        </div>
        <p class="hint" id="bridgeModeHint">${escapeHTML(modeHintText())}</p>
      </div>
      ${renderTeamPanel(st)}
      <div class="bridge-actions">
        ${st.can_uninstall ? '<button type="button" class="btn bridge-uninstall" id="bridgeUninstall">解除安裝轉錄環境</button>' : ''}
        <button type="button" class="btn primary" id="bridgeTranscribe" ${selectedMp4 && !transcribeBusy ? '' : 'disabled'}>${escapeHTML(transcribeButtonLabel())}</button>
        <button type="button" class="btn bridge-cancel hidden" id="bridgeCancelTranscribe">取消轉錄</button>
        <button type="button" class="btn" id="bridgeImport" ${st.srt_files?.length ? '' : 'disabled'}>載入最新 SRT</button>
      </div>
      <div class="bridge-wait hidden" id="bridgeWait">
        <div class="bridge-transcribe-status" id="bridgeTranscribeStatus"></div>
        <div class="bridge-wait-progress" id="bridgeWaitProgress"></div>
        <div class="bridge-wait-foot">
          <span class="hint">可以先去做別的事：關掉這個分頁也沒關係，回來會自動接上進度。</span>
          <button type="button" class="btn bridge-notify" id="bridgeNotifyToggle">${escapeHTML(notifyButtonLabel())}</button>
        </div>
      </div>
      <div class="bridge-log-panel hidden" id="bridgeLogPanel">
        <div class="bridge-log-head">
          <strong id="bridgeLogTitle">安裝記錄</strong>
          <div class="bridge-actions bridge-log-actions">
            <button type="button" class="btn" id="bridgeCopyLog">複製日誌</button>
            <button type="button" class="btn" id="bridgeDownloadLog">下載日誌</button>
            <button type="button" class="btn" id="bridgeOpenLogs">開啟 logs 資料夾</button>
          </div>
        </div>
        <p class="bridge-log-hint hidden" id="bridgeLogHint">安裝失敗時，請複製或下載日誌傳給技術支援。</p>
        <pre class="bridge-log" id="bridgeLog"></pre>
      </div>
      <p class="hint">Azure 雲端模式免安裝、數分鐘完成，需勾選同意；本機模式使用 Faster-Whisper（WhisperX），音訊不上雲但較慢。轉錄期間請保持助手視窗開啟。</p>
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
    panel.querySelectorAll('[data-fix]').forEach((el) => {
      el.addEventListener('click', () => runFix(el.dataset.fix, { st, showToast, refreshStatus, panel }));
    });
    panel.querySelector('#bridgeSetup')?.addEventListener('click', () => runSetup(showToast, refreshStatus));
    panel.querySelector('#bridgeUninstall')?.addEventListener('click', () => runUninstall(showToast, refreshStatus));
    panel.querySelector('#bridgeCancelUpload')?.addEventListener('click', () => {
      if (uploadXhr) uploadXhr.abort();
    });

    panel.querySelector('#bridgeOpenToken')?.addEventListener('click', () => openTokenPage(showToast));
    panel.querySelector('#bridgeSaveToken')?.addEventListener('click', () => saveToken(showToast, refreshStatus));
    panel.querySelectorAll('input[name="bridgeMode"]').forEach((el) => {
      el.addEventListener('change', () => {
        transcribeMode = el.value;
        modeChosenByUser = true;
        localStorage.setItem(TRANSCRIBE_MODE_KEY, transcribeMode);
        refreshStatus();
      });
    });
    panel.querySelector('#bridgeCloudConsent')?.addEventListener('change', (e) => {
      setCloudConsent(e.target.checked);
      refreshStatus();
    });
    panel.querySelector('#bridgeSaveAzure')?.addEventListener('click', () =>
      saveAzureConfig(showToast, refreshStatus)
    );
    panel.querySelector('#bridgeAzureToggle')?.addEventListener('click', () => {
      azureFormOpen = !azureFormOpen;
      refreshStatus();
    });
    panel.querySelector('#bridgeAzureFromTeam')?.addEventListener('click', () => {
      teamPanelOpen = true;
      refreshStatus().then(() => document.getElementById('bridgeTeamText')?.focus());
    });
    const teamPanel = panel.querySelector('#bridgeTeamPanel');
    teamPanel?.addEventListener('toggle', () => {
      teamPanelOpen = teamPanel.open;
    });
    panel.querySelector('#bridgeTeamPick')?.addEventListener('click', () => panel.querySelector('#bridgeTeamFile')?.click());
    panel.querySelector('#bridgeTeamFile')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const ta = document.getElementById('bridgeTeamText');
      if (ta) ta.value = text;
      e.target.value = '';
      importTeamConfig(text, showToast, refreshStatus);
    });
    panel.querySelector('#bridgeTeamImport')?.addEventListener('click', () =>
      importTeamConfig(document.getElementById('bridgeTeamText')?.value || '', showToast, refreshStatus)
    );
    panel.querySelector('#bridgeTeamExport')?.addEventListener('click', () => exportTeamConfig(showToast));
    panel.querySelector('#bridgeTranscribe')?.addEventListener('click', () => {
      const reason = transcribeBlockReason(st);
      if (reason) return showToast(reason);
      runTranscribe(onTranscriptReady, showToast, refreshStatus);
    });
    panel.querySelector('#bridgeCancelTranscribe')?.addEventListener('click', () =>
      cancelTranscribe(showToast, refreshStatus)
    );
    panel.querySelector('#bridgeImport')?.addEventListener('click', () => importLatest(onTranscriptReady, showToast));
    panel.querySelector('#bridgeNotifyToggle')?.addEventListener('click', () => toggleNotify(showToast));
    bindLogActions(showToast);
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
      setTranscribeUI({ active: true, message: '轉錄進行中…請保持助手視窗開啟' });
      showLog(j.logs || []);
      pollJob(async (ok, job) => {
        await refreshStatus();
        if (job.exit_code === 130) {
          showToast(job.cancel_uninstall ? '已取消轉錄並解除安裝' : '已取消轉錄');
          return;
        }
        if (ok) await importLatest(onTranscriptReady, showToast);
        else showToast(transcribeFailToast(job.logs));
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

function notifyButtonLabel() {
  if (!notifyEnabled()) return '完成時通知我（提示音＋桌面通知）';
  const st = notificationState();
  if (st === 'granted') return '✓ 完成會通知（點此關閉）';
  if (st === 'denied') return '✓ 完成會播提示音（瀏覽器已封鎖桌面通知）';
  return '✓ 完成會播提示音（點此關閉）';
}

async function toggleNotify(showToast) {
  if (notifyEnabled()) {
    setNotifyEnabled(false);
    showToast?.('已關閉完成通知');
  } else {
    const perm = await enableNotifications();
    if (perm === 'granted') showToast?.('完成時會播提示音並發桌面通知（切到別的視窗也看得到）');
    else if (perm === 'denied') showToast?.('瀏覽器封鎖了桌面通知，完成時仍會播提示音');
    else showToast?.('完成時會播提示音');
  }
  const btn = document.getElementById('bridgeNotifyToggle');
  if (btn) btn.textContent = notifyButtonLabel();
}

function setTranscribeUI({ active, message = '轉錄進行中…請保持助手視窗開啟', progress = null, cancelRequested = false }) {
  const wait = document.getElementById('bridgeWait');
  const status = document.getElementById('bridgeTranscribeStatus');
  const prog = document.getElementById('bridgeWaitProgress');
  const cancel = document.getElementById('bridgeCancelTranscribe');
  const start = document.getElementById('bridgeTranscribe');
  if (!status || !wait) return;

  if (active) {
    wait.classList.remove('hidden');
    status.classList.add('busy');
    const summary = progress && !cancelRequested ? waitSummary(progress) : '';
    status.textContent = summary ? `${message}　${summary}` : message;
    if (prog) prog.innerHTML = renderProgressHtml(progress, { cancelRequested });
    cancel?.classList.remove('hidden');
    if (start) start.disabled = true;
  } else {
    wait.classList.add('hidden');
    status.classList.remove('busy');
    if (prog) prog.innerHTML = '';
    cancel?.classList.add('hidden');
  }
}

function setWaitTitle(progress) {
  if (typeof document === 'undefined') return;
  // 模式切換會改寫 document.title；只要目前標題不是我們寫的進度標題，就以它為基底
  if (!document.title.startsWith('⏳ ')) baseTitle = document.title;
  if (!baseTitle) baseTitle = document.title;
  document.title = progress ? progressTitle(progress, baseTitle) : baseTitle;
}

function restoreTitle() {
  if (baseTitle && typeof document !== 'undefined') document.title = baseTitle;
  baseTitle = '';
}

function showLog(lines, { failed = false, title = '執行記錄' } = {}) {
  const panel = document.getElementById('bridgeLogPanel');
  const el = document.getElementById('bridgeLog');
  const hint = document.getElementById('bridgeLogHint');
  const titleEl = document.getElementById('bridgeLogTitle');
  if (!el || !panel) return;
  panel.classList.remove('hidden');
  if (failed) panel.classList.add('err');
  else panel.classList.remove('err');
  if (titleEl) titleEl.textContent = title;
  if (hint) hint.classList.toggle('hidden', !failed);
  el.textContent = (lines || []).join('\n');
  el.scrollTop = el.scrollHeight;
}

async function fetchLatestLog() {
  return api('/api/job/log/latest');
}

async function copyLatestLog(showToast) {
  try {
    const r = await fetchLatestLog();
    await navigator.clipboard.writeText(r.content);
    showToast?.(`已複製日誌：${r.filename}`);
  } catch {
    const el = document.getElementById('bridgeLog');
    if (el?.textContent) {
      await navigator.clipboard.writeText(el.textContent);
      showToast?.('已複製畫面上的記錄');
    } else {
      showToast?.('尚無日誌可複製');
    }
  }
}

async function downloadLatestLog(showToast) {
  try {
    const r = await fetchLatestLog();
    const blob = new Blob([r.content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = r.filename || 'call-coach-install.log';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast?.(`已下載 ${a.download}`);
  } catch {
    showToast?.('尚無日誌可下載');
  }
}

function bindLogActions(showToast) {
  document.getElementById('bridgeCopyLog')?.addEventListener('click', () => copyLatestLog(showToast));
  document.getElementById('bridgeDownloadLog')?.addEventListener('click', () => downloadLatestLog(showToast));
  document.getElementById('bridgeOpenLogs')?.addEventListener('click', async () => {
    await api('/api/open-folder', { method: 'POST', body: JSON.stringify({ folder: 'logs' }) });
    showToast('已開啟 logs 資料夾');
  });
}

function sacBanner(state) {
  if (state !== 'on' && state !== 'evaluation') return '';
  const mode = state === 'on' ? '已開啟' : '評估模式';
  return `
    <div class="bridge-sac-warn">
      <strong>▲ Windows Smart App Control ${mode} — 會封鎖本機轉錄元件</strong>
      <p class="hint">Smart App Control 只允許有數位簽章或信譽良好的程式執行；助手、ffmpeg 與 WhisperX 目前未簽章，轉錄可能出現「已封鎖部分功能」或直接失敗。可行做法：</p>
      <ol class="bridge-sac-steps">
        <li><strong>改用「Azure 雲端轉錄」模式</strong>：僅需 ffmpeg 抽音軌，受影響元件最少（需勾選知情同意）。</li>
        <li><strong>請 IT 關閉 Smart App Control</strong>：Windows 安全性 → 應用程式與瀏覽器控制 → Smart App Control 設定 → 關閉。<span class="bridge-sac-note">注意：關閉後無法再開啟（需重灌 Windows），請先與 IT 確認。</span></li>
        <li><strong>由公司提供程式碼簽章憑證</strong>：我們的安裝包已支援簽章，簽章後 Smart App Control 會放行。</li>
      </ol>
    </div>`;
}

function setCloudConsent(value) {
  cloudConsent = !!value;
  localStorage.setItem(CLOUD_CONSENT_KEY, cloudConsent ? '1' : '0');
}

async function runFix(action, { st, showToast, refreshStatus, panel }) {
  switch (action) {
    case 'full-setup':
      return runFullSetup(showToast, refreshStatus);
    case 'install-ffmpeg':
      return runInstallFfmpeg(showToast, refreshStatus);
    case 'azure':
      azureFormOpen = true;
      await refreshStatus();
      document.getElementById('bridgeAzureKey')?.focus();
      return undefined;
    case 'consent':
      setCloudConsent(true);
      showToast('已勾選知情同意 — 音訊僅用於 Azure 轉錄');
      return refreshStatus();
    case 'token':
      await openTokenPage(showToast);
      document.getElementById('bridgeToken')?.focus();
      return undefined;
    case 'open-input':
      await api('/api/open-folder', { method: 'POST', body: JSON.stringify({ folder: 'input' }) });
      showToast('已開啟 input 資料夾 — 複製 MP4 後按「重新掃描」');
      return undefined;
    default:
      return undefined;
  }
}

async function importTeamConfig(text, showToast, refreshStatus) {
  if (!text.trim()) return showToast('請先貼上或選擇 team-config.env');
  try {
    const r = await api('/api/team-config/import', { method: 'POST', body: JSON.stringify({ text }) });
    if (!r.ok) return showToast(r.message || '匯入失敗');
    const applied = (r.applied || []).join('、');
    if (r.applied?.includes('AZURE_SPEECH_KEY') && !modeChosenByUser) transcribeMode = 'azure';
    showToast(`已匯入團隊設定：${applied}`);
    teamPanelOpen = false;
    const ta = document.getElementById('bridgeTeamText');
    if (ta) ta.value = '';
    await refreshStatus();
  } catch (err) {
    showToast(err?.status === 404 ? '助手版本較舊，不支援團隊設定，請更新助手' : err?.message || '匯入失敗');
  }
}

async function exportTeamConfig(showToast) {
  const includeHf = !!document.getElementById('bridgeTeamIncludeHf')?.checked;
  const teamName = prompt('團隊名稱（會顯示在同事的檢查清單，可留空）', '') ?? '';
  try {
    const r = await api('/api/team-config/export', {
      method: 'POST',
      body: JSON.stringify({ include_hf_token: includeHf, team_name: teamName }),
    });
    if (!r.ok) return showToast(r.message || '匯出失敗');
    const blob = new Blob([r.content], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = r.filename || 'team-config.env';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('已下載 team-config.env — 內含金鑰，請以內部管道分享');
  } catch (err) {
    showToast(err?.message || '匯出失敗');
  }
}

function transcribeBlockReason(st) {
  if (!selectedMp4) return '請先選擇或放入 MP4';
  if (!st?.python_ok) return '需要 Python 3.10+（請確認轉錄助手視窗已啟動）';
  if (!st?.ffmpeg_ok) return '需要 ffmpeg 抽出音軌，請按「完整環境安裝」或「安裝 ffmpeg」';
  if (transcribeMode === 'azure') {
    if (!st?.azure_ok) return '請先填入 Azure Speech 金鑰與區域，或匯入團隊設定';
    if (!cloudConsent) return '使用 Azure 雲端轉錄前，請勾選知情同意';
    return '';
  }
  if (!st?.venv_ok || !st?.whisperx_ok) return '本機模式請先按「完整環境安裝」；或改選 Azure 雲端轉錄（免安裝）';
  if (!st?.token_ok) return '本機模式請先設定 HF_TOKEN；或改選 Azure 雲端轉錄（不需 Token）';
  return '';
}

function transcribeButtonLabel() {
  if (transcribeMode === 'azure') return '開始 Azure 雲端轉錄';
  if (transcribeMode === 'fast') return '開始本機轉錄（快速）';
  return '開始本機轉錄（標準）';
}

function modeHintText() {
  if (transcribeMode === 'azure') {
    return 'Azure 雲端模式：ffmpeg 先在本機抽出音軌，再整檔上傳 Azure Speech Fast Transcription（zh-TW，含發言者辨識），48 分鐘 DEMO 通常 2～5 分鐘完成。不需安裝 WhisperX、不需 Hugging Face Token，Smart App Control 也不受影響。';
  }
  if (transcribeMode === 'fast') {
    return '快速模式：Faster-Whisper small，本機 CPU 轉錄，速度較快、準確度略降。48 分鐘 DEMO 常需 35～60 分鐘。';
  }
  return '標準模式：Faster-Whisper medium，本機 CPU 轉錄，準確度較佳。48 分鐘 DEMO 常需 50～90 分鐘。長影片會自動分段平行處理。';
}

function lastErrorLine(logs) {
  const lines = logs || [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (String(lines[i]).includes('[錯誤]')) return String(lines[i]);
  }
  return null;
}

function transcribeFailToast(logs) {
  const err = lastErrorLine(logs);
  if (!err) return '轉錄失敗，請查看下方記錄';
  return `轉錄失敗：${err.replace(/^\[錯誤\]\s*/, '')}`;
}

async function pollJob(onDone, { trackTranscribe = false, trackSetup = false } = {}) {
  clearInterval(pollTimer);
  const tick = async () => {
    try {
      const j = await api('/api/job');
      const setupKinds = new Set(['setup', 'full-setup', 'install-ffmpeg', 'uninstall']);
      const isSetup = setupKinds.has(j.kind);
      if (isSetup || trackSetup) {
        showLog(j.logs, {
          failed: !j.running && j.exit_code !== null && j.exit_code !== 0,
          title: j.running ? '安裝進行中…' : j.exit_code === 0 ? '安裝完成' : '安裝失敗',
        });
      } else if (trackTranscribe) {
        showLog(j.logs, {
          failed: !j.running && j.exit_code !== null && j.exit_code !== 0 && j.exit_code !== 130,
          title: j.running
            ? j.cancel_requested
              ? '正在取消轉錄…'
              : '轉錄進行中…'
            : j.exit_code === 0
              ? '轉錄完成'
              : j.exit_code === 130
                ? '轉錄已取消'
                : '轉錄失敗 — 請查看記錄',
        });
      } else {
        showLog(j.logs);
      }
      if (trackTranscribe && j.running && j.kind === 'transcribe') {
        setTranscribeUI({
          active: true,
          message: j.cancel_requested ? '正在取消轉錄…' : '轉錄進行中…請保持助手視窗開啟',
          progress: j.progress,
          cancelRequested: !!j.cancel_requested,
        });
        setWaitTitle(j.progress);
      }
      if (!j.running && j.exit_code !== null) {
        clearInterval(pollTimer);
        if (trackTranscribe) {
          transcribeBusy = false;
          setTranscribeUI({ active: false });
          restoreTitle();
          if (j.exit_code === 0) {
            notifyJobDone({ title: 'Call Coach：轉錄完成', body: '逐字稿已產生，回到 Call Coach 就會自動載入並可開始分析。' });
          } else if (j.exit_code !== 130) {
            notifyJobDone({ title: 'Call Coach：轉錄失敗', body: transcribeFailToast(j.logs), ok: false });
          }
        }
        onDone(j.exit_code === 0, j);
      }
    } catch {
      clearInterval(pollTimer);
      if (trackTranscribe) {
        transcribeBusy = false;
        setTranscribeUI({ active: false });
        restoreTitle();
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
    showLog(['安裝啟動中…'], { title: '安裝進行中…' });
    pollJob(
      (ok, job) => {
        showLog(job.logs || [], {
          failed: !ok,
          title: ok ? '安裝完成' : '安裝失敗 — 請複製日誌',
        });
        showToast(
          ok ? doneMsg : '安裝失敗 — 請查看下方記錄，按「複製日誌」傳給技術支援'
        );
        refreshStatus().then((st) => {
          if (ok && st && !st.token_ok) openTokenPage(showToast);
        });
      },
      { trackSetup: true }
    );
  } catch (err) {
    showToast(bridgeFetchError(err));
  }
}

async function runSetup(showToast, refreshStatus) {
  return runSetupJob('/api/setup', '開始安裝 WhisperX…', 'WhisperX 安裝完成', showToast, refreshStatus);
}

async function runInstallFfmpeg(showToast, refreshStatus) {
  return runSetupJob('/api/install-ffmpeg', '開始安裝 ffmpeg…', 'ffmpeg 安裝完成', showToast, refreshStatus);
}

async function runFullSetup(showToast, refreshStatus) {
  try {
    const r = await api('/api/full-setup', { method: 'POST' });
    if (!r.ok) return showToast(r.message || '無法開始安裝');
    showToast('開始完整環境安裝（ffmpeg + WhisperX）…');
    showLog(['安裝啟動中…'], { title: '安裝進行中…' });
    pollJob(
      (ok, job) => {
        showLog(job.logs || [], {
          failed: !ok,
          title: ok ? '安裝完成' : '安裝失敗 — 請複製日誌',
        });
        showToast(
          ok ? '完整環境安裝完成' : '安裝失敗 — 請查看下方記錄，按「複製日誌」傳給技術支援'
        );
        refreshStatus().then((st) => {
          if (ok && st && !st.token_ok) openTokenPage(showToast);
        });
      },
      { trackSetup: true }
    );
  } catch (err) {
    if (err?.status === 404) {
      showToast('助手版本較舊，改為分步安裝 WhisperX…');
      return runSetup(showToast, refreshStatus);
    }
    showToast(bridgeFetchError(err));
  }
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
    showToast(ok ? '已解除安裝' : '解除安裝失敗 — 請查看日誌');
    refreshStatus();
  }, { trackSetup: true });
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

async function saveAzureConfig(showToast, refreshStatus) {
  const key = document.getElementById('bridgeAzureKey')?.value?.trim();
  const region = document.getElementById('bridgeAzureRegion')?.value?.trim();
  if (!key || !region) return showToast('請填入 Azure 金鑰與區域');
  const r = await api('/api/azure-config', {
    method: 'POST',
    body: JSON.stringify({ key, region }),
  });
  if (!r.ok) return showToast(r.message || '儲存失敗');
  showToast('Azure 設定已儲存');
  refreshStatus();
}

async function runTranscribe(onTranscriptReady, showToast, refreshStatus) {
  if (!selectedMp4) return showToast('請先選擇 MP4');
  const reason = transcribeBlockReason(await checkLocalBridge());
  if (reason) return showToast(reason);
  try {
    const r = await api('/api/transcribe', {
      method: 'POST',
      body: JSON.stringify({
        mp4: selectedMp4,
        mode: transcribeMode,
        cloud_consent: cloudConsent,
      }),
    });
    if (!r.ok) return showToast(r.message || '無法開始轉錄');
    transcribeBusy = true;
    setTranscribeUI({ active: true, message: '正在啟動轉錄…' });
    showLog([transcribeMode === 'azure' ? '正在啟動 Azure 雲端轉錄，請稍候…' : '正在啟動本機轉錄，請稍候…']);
    showToast(
      transcribeMode === 'azure'
        ? 'Azure 雲端轉錄中…下方會顯示階段與預計完成時間'
        : '本機轉錄中…下方會顯示階段、百分比與預計完成時間'
    );
    pollJob(async (ok, j) => {
      await refreshStatus();
      if (j.exit_code === 130) {
        showToast(j.cancel_uninstall ? '已取消轉錄並解除安裝' : '已取消轉錄');
        return;
      }
      if (ok) await importLatest(onTranscriptReady, showToast);
      else showToast(transcribeFailToast(j.logs));
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
