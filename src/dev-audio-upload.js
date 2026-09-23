/**
 * 開發模式「直接上傳錄音檔」面板：
 *   A. Gemini 雲端轉錄（預設）— 錄音送 Google，回傳含業務／客戶標記的逐字稿。
 *   B. 新竹 GPU Worker — 錄音直傳自己的主機（WhisperX），不出 Google。
 * 知情同意採「每次上傳都要重新勾選」。
 */
import {
  AUDIO_ACCEPT,
  INLINE_LIMIT_BYTES,
  describeSize,
  isAudioFileName,
  transcribeAudioWithGemini,
  validateAudioFile,
} from './audio-transcribe.js';
import { mountBrowserWorkerUI } from './browser-worker-transcribe.js';
import { describeApiKeyProblem } from './gemini.js';
import { escapeHTML } from './utils.js';

const STORAGE_ENGINE = 'callCoachDevAudioEngine';
const WORKER_ACCEPT = `${AUDIO_ACCEPT},.mp4,video/mp4`;

function loadEngine() {
  try {
    const v = localStorage.getItem(STORAGE_ENGINE);
    return v === 'worker' ? 'worker' : 'gemini';
  } catch {
    return 'gemini';
  }
}

function saveEngine(engine) {
  try {
    localStorage.setItem(STORAGE_ENGINE, engine);
  } catch {
    /* ignore */
  }
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒` : `${s} 秒`;
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {(segs:Array, filename:string, src:string)=>boolean} opts.onSegmentsReady  Gemini 轉錄完成（已含 S/C）
 * @param {(text:string, filename:string)=>void} opts.onTranscriptReady          Worker 回傳 SRT
 * @param {()=>string} opts.getApiKey
 * @param {(v:string)=>void} opts.setApiKey
 * @param {()=>string} opts.getModel
 * @param {(tokens:number)=>void} [opts.onGeminiUsed]
 * @param {(msg:string)=>void} [opts.showToast]
 * @returns {{ setFile(file: File): boolean, isAudio(name:string): boolean }}
 */
export function mountDevAudioUpload(
  container,
  { onSegmentsReady, onTranscriptReady, getApiKey, setApiKey, getModel, onGeminiUsed, showToast }
) {
  if (!container) return { setFile: () => false, isAudio: isAudioFileName };
  const engine = loadEngine();

  container.innerHTML = `
    <div class="dev-audio">
      <div class="dev-audio-head">
        <strong>或：直接上傳錄音檔，不用先經 Vibe</strong>
        <span class="hint">m4a / mp3 / wav / ogg / webm ・ 轉錄完自動載入並標好業務／客戶</span>
      </div>
      <div class="dev-audio-engines">
        <label class="dev-audio-engine ${engine === 'gemini' ? 'active' : ''}">
          <input type="radio" name="devAudioEngine" value="gemini" ${engine === 'gemini' ? 'checked' : ''}>
          <span><b>Gemini 雲端轉錄</b>（預設）<small>只要 API Key，錄音會送到 Google 處理</small></span>
        </label>
        <label class="dev-audio-engine ${engine === 'worker' ? 'active' : ''}">
          <input type="radio" name="devAudioEngine" value="worker" ${engine === 'worker' ? 'checked' : ''}>
          <span><b>新竹 GPU Worker</b>（不出 Google）<small>需 Worker 網址／Token，錄音只進自己的主機</small></span>
        </label>
      </div>

      <div class="dev-audio-pane" data-engine="gemini" ${engine === 'gemini' ? '' : 'hidden'}>
        <input type="password" id="daGeminiKey" class="bridge-token" placeholder="貼上 Gemini API Key（與下方 AI 深度分析共用）" value="${escapeHTML(getApiKey?.() || '')}" autocomplete="off">
        <div class="bridge-upload-status err hidden" id="daKeyHint"></div>
        <label class="bridge-consent">
          <input type="checkbox" id="daConsent">
          我確認這段錄音<strong>可以傳送到 Google Gemini</strong>轉成逐字稿（敏感內容請先去識別化）——每次上傳都需重新勾選
        </label>
        <div class="bridge-actions">
          <button type="button" class="btn" id="daPick">選擇錄音檔</button>
          <button type="button" class="btn primary" id="daStart" disabled>開始轉錄</button>
          <button type="button" class="btn bridge-cancel hidden" id="daCancel">取消</button>
        </div>
        <input type="file" id="daFile" accept="${escapeHTML(AUDIO_ACCEPT)}" hidden>
        <div class="bridge-upload-status hidden" id="daStatus"></div>
        <p class="hint">≤ ${describeSize(INLINE_LIMIT_BYTES)} 直接隨請求送出；更大的檔會先暫存到 Gemini Files（轉錄完即刪除，Google 最多保留 48 小時）。單檔建議 60 分鐘內；轉錄會計入下方 Gemini 用量。</p>
      </div>

      <div class="dev-audio-pane" data-engine="worker" ${engine === 'worker' ? '' : 'hidden'}>
        <div id="daWorkerMount"></div>
      </div>
    </div>
  `;

  const keyEl = container.querySelector('#daGeminiKey');
  const consentEl = container.querySelector('#daConsent');
  const pickBtn = container.querySelector('#daPick');
  const startBtn = container.querySelector('#daStart');
  const cancelBtn = container.querySelector('#daCancel');
  const fileInput = container.querySelector('#daFile');
  const statusEl = container.querySelector('#daStatus');
  const keyHintEl = container.querySelector('#daKeyHint');

  // 只在有輸入時提示格式問題（空白不提示，避免一開始就滿版紅字）
  const keyProblem = () => {
    const v = keyEl?.value?.trim() || '';
    return v ? describeApiKeyProblem(v) : '';
  };
  const renderKeyHint = () => {
    if (!keyHintEl) return;
    const p = keyProblem();
    keyHintEl.textContent = p;
    keyHintEl.classList.toggle('hidden', !p);
  };

  let picked = null;
  let busy = false;
  let abort = null;
  let ticker = null;

  const setStatus = (msg, kind = 'busy') => {
    if (!statusEl) return;
    statusEl.classList.remove('hidden', 'busy', 'ok', 'err');
    statusEl.classList.add(kind);
    statusEl.textContent = msg;
  };

  const refreshStart = () => {
    if (!startBtn) return;
    const key = keyEl?.value?.trim();
    const problem = keyProblem();
    const blocked = busy || !picked || !key || !!problem || !consentEl?.checked;
    startBtn.disabled = blocked;
    startBtn.removeAttribute('title');
    if (blocked && !busy) {
      if (!picked) startBtn.title = '請先選擇錄音檔';
      else if (!key) startBtn.title = '請貼上 Gemini API Key';
      else if (problem) startBtn.title = problem;
      else if (!consentEl?.checked) startBtn.title = '請勾選知情同意';
    }
    if (pickBtn) pickBtn.disabled = busy;
  };

  const workerUI = mountBrowserWorkerUI(container.querySelector('#daWorkerMount'), {
    onTranscriptReady,
    showToast,
    accept: WORKER_ACCEPT,
    mediaLabel: '錄音檔',
    idPrefix: 'daw',
    persistConsent: false,
    intro:
      '填新竹 Worker 視窗上的網址與 Token；錄音會<strong>直傳你的 GPU 主機</strong>用 WhisperX 轉錄（不經 Google、不經 Call Coach 網站）。完成後自動載入逐字稿。',
  });

  const currentEngine = () => container.querySelector('input[name="devAudioEngine"]:checked')?.value || 'gemini';

  const applyEngine = (eng) => {
    container.querySelectorAll('.dev-audio-pane').forEach((p) => {
      p.hidden = p.dataset.engine !== eng;
    });
    container.querySelectorAll('.dev-audio-engine').forEach((l) => {
      l.classList.toggle('active', l.querySelector('input')?.value === eng);
    });
    saveEngine(eng);
  };

  container.querySelectorAll('input[name="devAudioEngine"]').forEach((r) => {
    r.addEventListener('change', () => applyEngine(currentEngine()));
  });

  keyEl?.addEventListener('input', () => {
    setApiKey?.(keyEl.value.trim());
    renderKeyHint();
    refreshStart();
  });
  consentEl?.addEventListener('change', refreshStart);
  pickBtn?.addEventListener('click', () => fileInput?.click());

  const setFile = (f) => {
    if (!f) return false;
    const problem = validateAudioFile(f);
    if (problem) {
      setStatus(problem, 'err');
      showToast?.(problem);
      return false;
    }
    picked = f;
    setStatus(`已選擇 ${f.name}（${describeSize(f.size)}）`, 'ok');
    // 兩個引擎面板共用同一個檔案，切換引擎不用重選
    workerUI?.setFile(f);
    refreshStart();
    return true;
  };

  fileInput?.addEventListener('change', (e) => {
    setFile(e.target.files?.[0]);
    e.target.value = '';
  });

  cancelBtn?.addEventListener('click', () => abort?.abort());

  startBtn?.addEventListener('click', async () => {
    if (busy || !picked || !consentEl?.checked) return;
    const apiKey = keyEl?.value?.trim();
    if (!apiKey) return refreshStart();
    busy = true;
    abort = new AbortController();
    refreshStart();
    cancelBtn?.classList.remove('hidden');
    const startedAt = Date.now();
    let stage = '準備中…';
    const render = () => setStatus(`${stage}（已 ${formatElapsed(Date.now() - startedAt)}）`);
    ticker = setInterval(render, 1000);
    try {
      const result = await transcribeAudioWithGemini({
        apiKey,
        model: getModel?.(),
        file: picked,
        signal: abort.signal,
        onProgress: (msg) => {
          stage = msg;
          render();
        },
        onRetry: ({ attempt, maxAttempts, delayMs }) => {
          stage = `Google 忙碌，${Math.round(delayMs / 1000)} 秒後重試（${attempt}/${maxAttempts}）…`;
          render();
        },
        onModelSwitch: (next, prev) => showToast?.(`${prev} 忙碌，改試 ${next}…`),
      });
      onGeminiUsed?.(result.usedTokens);
      const base = picked.name.replace(/\.[a-z0-9]+$/i, '');
      const ok = onSegmentsReady?.(result.segs, `${base}.srt`, `Gemini 轉錄（${result.modelUsed}）`);
      if (ok === false) throw new Error('逐字稿載入失敗');
      const note = result.truncated ? '；錄音較長，輸出被截斷，僅取得前段——建議切成 30～60 分鐘再上傳' : '';
      setStatus(`轉錄完成：${result.segs.length} 句，已載入並標好業務／客戶${note}`, result.truncated ? 'err' : 'ok');
      showToast?.(result.truncated ? '轉錄完成（輸出被截斷，僅前段）' : `轉錄完成 — ${result.segs.length} 句，請確認標記後開始分析`);
    } catch (e) {
      const msg = e?.name === 'AbortError' ? '已取消' : e?.message || '轉錄失敗';
      setStatus(msg, 'err');
      showToast?.(msg);
    } finally {
      clearInterval(ticker);
      ticker = null;
      busy = false;
      abort = null;
      if (consentEl) consentEl.checked = false;
      cancelBtn?.classList.add('hidden');
      refreshStart();
    }
  });

  renderKeyHint();
  refreshStart();

  return {
    setFile,
    isAudio: isAudioFileName,
    syncApiKey(value) {
      if (keyEl && keyEl.value !== value) keyEl.value = value || '';
      renderKeyHint();
      refreshStart();
    },
  };
}
