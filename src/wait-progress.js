/**
 * 把「等待」變成可預期：把助手回傳的結構化進度（/api/job → progress）
 * 轉成階段列、百分比、已耗時、預估剩餘與預計完成時間，並負責完成通知。
 */
import { escapeHTML } from './utils.js';

const NOTIFY_KEY = 'callCoachNotifyDone';

export function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s < 60) return `${s} 秒`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
  const rest = s % 60;
  return rest && m < 10 ? `${m} 分 ${rest} 秒` : `${m} 分`;
}

function ceilMinutes(sec) {
  return Math.max(1, Math.ceil((Number(sec) || 0) / 60));
}

export function formatEtaRange(lowS, highS) {
  if (lowS == null || highS == null) return '';
  if (highS <= 0) return '應該快完成了';
  if (highS < 60) return '不到 1 分鐘';
  const lo = ceilMinutes(lowS);
  const hi = ceilMinutes(highS);
  return lo >= hi ? `約 ${hi} 分鐘` : `約 ${lo}～${hi} 分鐘`;
}

export function clockTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function finishWindow(now, lowS, highS) {
  if (lowS == null || highS == null || highS <= 0) return '';
  const base = now instanceof Date ? now.getTime() : Number(now);
  const a = clockTime(new Date(base + Math.max(0, lowS) * 1000));
  const b = clockTime(new Date(base + highS * 1000));
  return a === b ? `預計 ${b} 完成` : `預計 ${a}～${b} 完成`;
}

export function waitSummary(progress, now = Date.now()) {
  if (!progress) return '';
  const parts = [];
  if (progress.phase_label) parts.push(progress.phase_label);
  if (progress.done) return progress.ok ? '轉錄完成' : '轉錄未完成';
  if (progress.overdue) parts.push('已超過預估時間，仍在處理中');
  else {
    const eta = formatEtaRange(progress.eta_remaining_low_s, progress.eta_remaining_high_s);
    if (eta) parts.push(`還需${eta}`);
    const fin = finishWindow(now, progress.eta_remaining_low_s, progress.eta_remaining_high_s);
    if (fin) parts.push(fin);
  }
  return parts.join('・');
}

export function progressTitle(progress, baseTitle) {
  if (!progress || progress.done) return baseTitle;
  const pct = Number.isFinite(progress.percent) ? `${progress.percent}%` : '…';
  return `⏳ ${pct}${progress.phase_label ? `・${progress.phase_label}` : ''} — ${baseTitle}`;
}

export function renderProgressHtml(progress, { now = Date.now(), cancelRequested = false } = {}) {
  if (!progress) return '';
  const pct = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  const states = progress.phase_states || [];
  const steps = states
    .map(
      (s, i) =>
        `<li class="wait-step ${s.state}"><span class="wait-step-idx">${i + 1}</span><span class="wait-step-label">${escapeHTML(s.label || s.key || '')}</span></li>`
    )
    .join('');
  const eta = formatEtaRange(progress.eta_remaining_low_s, progress.eta_remaining_high_s);
  const fin = finishWindow(now, progress.eta_remaining_low_s, progress.eta_remaining_high_s);
  let etaLine;
  if (progress.done) etaLine = progress.ok ? '已完成' : '已停止';
  else if (cancelRequested) etaLine = '正在停止…';
  else if (progress.overdue) {
    const diarizeTail =
      (progress.detail || '').includes('發言者分軌') || (progress.detail || '').includes('分軌');
    etaLine = diarizeTail
      ? '發言者分軌後仍在寫入字幕（GPU 常再跑 1～10 分鐘、進度條可能停在 97%，請勿重來）'
      : '已超過預估時間，仍在處理中（大檔或電腦忙碌時常見，不必重來）';
  }
  else if (eta) etaLine = `還需${eta}${fin ? `　${fin}` : ''}`;
  else etaLine = '正在估算所需時間…';
  const detail = progress.detail ? `<span class="wait-detail">${escapeHTML(progress.detail)}</span>` : '';
  const durHint = progress.duration_s ? `音訊 ${formatDuration(progress.duration_s)}` : '';
  const meta = [durHint, `已耗時 ${formatDuration(progress.elapsed_s)}`].filter(Boolean).join('・');
  return `
    <ol class="wait-steps">${steps}</ol>
    <div class="wait-bar"><div class="wait-bar-fill" style="width:${pct}%"></div></div>
    <div class="wait-row">
      <strong class="wait-pct">${pct}%</strong>
      <span class="wait-phase">${escapeHTML(progress.phase_label || '')}${detail ? '　' : ''}${detail}</span>
    </div>
    <div class="wait-row wait-eta"><span>${escapeHTML(etaLine)}</span><span class="wait-meta">${escapeHTML(meta)}</span></div>
  `;
}

// ----- 完成通知 ---------------------------------------------------------------------------

export function notifyEnabled() {
  try {
    return localStorage.getItem(NOTIFY_KEY) === '1';
  } catch {
    return false;
  }
}

export function setNotifyEnabled(on) {
  try {
    localStorage.setItem(NOTIFY_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function notificationState() {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission; // granted | denied | default
}

export async function enableNotifications() {
  if (typeof Notification === 'undefined') {
    setNotifyEnabled(true);
    return 'sound-only';
  }
  let perm = Notification.permission;
  if (perm === 'default') {
    try {
      perm = await Notification.requestPermission();
    } catch {
      perm = 'denied';
    }
  }
  setNotifyEnabled(true);
  return perm;
}

export function playDoneChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    const notes = [660, 880, 1100];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.15);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.16);
    });
    setTimeout(() => ctx.close?.(), 800);
    return true;
  } catch {
    return false;
  }
}

/** 完成／失敗時通知使用者；頁面在前景時只播提示音，背景時另發系統通知。 */
export function notifyJobDone({ title, body, ok = true }) {
  if (!notifyEnabled()) return false;
  playDoneChime();
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return true;
  if (typeof document !== 'undefined' && document.visibilityState === 'visible' && document.hasFocus?.()) return true;
  try {
    const n = new Notification(ok ? title : `⚠ ${title}`, { body, tag: 'call-coach-job', silent: true });
    n.onclick = () => {
      window.focus?.();
      n.close();
    };
  } catch {
    /* ignore */
  }
  return true;
}

export function playFailChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    const ctx = new Ctx();
    [440, 330, 262].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    });
    setTimeout(() => ctx.close?.(), 900);
    return true;
  } catch {
    return false;
  }
}

/** GPU 安裝／偵測結果：一律提示（不受「完成時通知」開關影響）。 */
export function gpuEnvironmentSummary(st) {
  if (!st) {
    return {
      ready: false,
      title: '無法讀取 GPU 狀態',
      body: '請確認「Call Coach 本機助手」黑窗仍開啟，並重新整理 Call Coach 網頁。',
    };
  }
  const whisperOk = !!(st.venv_ok && st.whisperx_ok);
  const cudaOk = !!st.gpu_available;
  const gpuLabel = st.gpu_name ? `NVIDIA ${st.gpu_name}` : 'NVIDIA GPU';
  if (whisperOk && cudaOk) {
    return {
      ready: true,
      title: 'GPU 轉錄環境就緒',
      body: `WhisperX GPU 版已就緒；已偵測到 ${gpuLabel}（CUDA）。可選「新竹本機 GPU 轉錄」開始轉錄。`,
    };
  }
  const issues = [];
  if (!whisperOk) issues.push('WhisperX GPU 版環境尚未完整（請查看安裝記錄或重試「安裝 GPU 版 WhisperX」）');
  if (!cudaOk) {
    issues.push(st.gpu_reason || `${gpuLabel} 尚未被 PyTorch 使用（需 CUDA 12.8 版 torch；RTX 50 系列請用 GPU 版安裝，驅動建議 570+）`);
  }
  return {
    ready: false,
    title: 'GPU 轉錄環境未完成',
    body: issues.join('。'),
  };
}

/**
 * 重要結果通知：提示音 + 桌面通知（即使頁面在前景）；若瀏覽器未授權通知則用 alert 確保使用者看到。
 */
export function notifyImportant({ title, body, ok = true }) {
  if (ok) playDoneChime();
  else playFailChime();
  let surfaced = false;
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification(ok ? title : `⚠ ${title}`, {
        body,
        tag: 'call-coach-gpu',
        requireInteraction: !ok,
      });
      n.onclick = () => {
        window.focus?.();
        n.close();
      };
      surfaced = true;
    } catch {
      /* ignore */
    }
  }
  if (!surfaced && typeof window !== 'undefined') {
    try {
      window.alert(`${ok ? title : `⚠ ${title}`}\n\n${body}`);
      surfaced = true;
    } catch {
      /* ignore */
    }
  }
  return surfaced;
}
