/**
 * 本機轉錄助手面板的純邏輯（不碰 DOM、網路、localStorage），由 local-transcribe.js 帶入目前狀態呼叫。
 */
export const VALID_MODES = new Set(['fast', 'standard', 'local_gpu', 'azure', 'remote']);
// Modes where the audio leaves this PC (Azure cloud, or the user's own remote GPU worker).
export const OFFSITE_MODES = new Set(['azure', 'remote']);
export const AZURE_FAST_REGIONS_HINT = 'southeastasia（新加坡）或 japaneast（東京）';

export function isOffsiteMode(mode) {
  return OFFSITE_MODES.has(mode);
}

/** Match MP4 basenames (Windows paths are case-insensitive). */
export function mp4NameMatches(a, b) {
  if (!a || !b) return false;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

export function mp4InFileList(name, files) {
  return (files || []).some((f) => mp4NameMatches(f, name));
}

/** 掃描到的 MP4 清單變動後，決定要選哪一個：沿用原本選的 → demo.mp4 → 第一個 */
export function pickSelectedMp4(current, files) {
  if (!files?.length) return null;
  if (current && mp4InFileList(current, files)) return files.find((f) => mp4NameMatches(f, current)) || files[0];
  return files.find((f) => /^demo\.mp4$/i.test(f)) || files[0];
}

export function fmtSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fmtSpeed(bps) {
  if (!bps || bps < 1024) return '計算中…';
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
}

export function fmtElapsed(sec) {
  if (sec < 60) return `${sec} 秒`;
  return `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

export function bridgeFetchError(err) {
  const msg = String(err?.message || '');
  if (/failed to fetch|networkerror|network error|load failed/i.test(msg)) {
    return (
      '無法連線本機轉錄助手。請確認：① 已從開始選單啟動「Call Coach 本機助手」或安裝精靈已完成 ' +
      '② 網頁在 DEMO 模式 ③ 已安裝最新版（Releases）'
    );
  }
  return msg || '無法連線本機轉錄助手';
}

export function needsFullSetup(st) {
  return !st.ffmpeg_ok || !st.venv_ok || !st.whisperx_ok;
}

export function buildChecklistItems(st, { mode, cloudConsent = false, workerHealth = null, workerTesting = false } = {}) {
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
  if (mode === 'azure') {
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
  } else if (mode === 'local_gpu') {
    const whisperGpuReady = !!(st.venv_ok && st.whisperx_ok && (st.gpu_available || st.cuda_torch_build));
    items.push({
      ok: whisperGpuReady,
      label: 'WhisperX GPU 版環境',
      detail:
        whisperGpuReady
          ? ''
          : st.venv_ok && st.whisperx_ok && !st.cuda_torch_build
            ? 'WhisperX 已安裝，但 PyTorch 仍是 CPU 版 — 請按「僅修復 CUDA 版 PyTorch」'
            : '新竹請執行 start_hsinchu_gpu.cmd reinstall 或下方「安裝 GPU 版」',
      fix:
        st.venv_ok && st.whisperx_ok
          ? st.cuda_torch_build || st.gpu_available
            ? null
            : { action: 'repair-gpu-torch', text: '僅修復 CUDA 版 PyTorch' }
          : { action: 'setup-gpu', text: '安裝 GPU 版 WhisperX' },
    });
    items.push({
      ok: !!st.token_ok,
      label: 'Hugging Face Token（分軌模型授權）',
      fix: st.token_ok ? null : { action: 'token', text: '取得並貼上 Token' },
    });
    items.push({
      ok: !!st.gpu_available,
      label: st.gpu_available ? `NVIDIA GPU（${st.gpu_name || '已偵測'}）` : 'NVIDIA GPU（本機 CUDA）',
      warn: st.gpu_available ? '' : st.gpu_reason || '請安裝 GPU 版 WhisperX（CUDA 12.8）',
      fix: st.gpu_available
        ? null
        : st.venv_ok && st.whisperx_ok && !st.cuda_torch_build
          ? { action: 'repair-gpu-torch', text: '僅修復 CUDA 版 PyTorch' }
          : { action: 'setup-gpu', text: '安裝／修復 GPU 版 PyTorch' },
    });
  } else if (mode === 'remote') {
    items.push({
      ok: !!st.worker_ok,
      label: st.worker_ok ? `遠端主機（${shortWorkerUrl(st.worker_url)}）` : '遠端主機網址與 Worker Token',
      detail: st.team_config?.present && st.team_config?.provides_worker ? '由團隊設定提供' : '',
      fix: st.worker_ok ? null : { action: 'worker', text: '填入網址／Token' },
    });
    if (st.worker_ok) {
      const h = workerHealth;
      items.push({
        ok: !!h?.reachable,
        label: h?.reachable
          ? `已連上：${h.health?.gpu || 'CPU（未偵測到 GPU）'}｜${h.health?.model || ''}`
          : h
            ? '遠端主機連線失敗'
            : '遠端主機連線（尚未測試）',
        warn: h && !h.reachable ? h.message || '' : h?.reachable && !h.health?.gpu_available ? '遠端主機沒有可用 GPU，速度不會比公司電腦快' : '',
        fix: h?.reachable ? null : { action: 'worker-test', text: workerTesting ? '測試中…' : '測試連線' },
      });
    }
    items.push({
      ok: cloudConsent,
      label: '知情同意（音訊傳到你指定的主機）',
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

export function modeShortLabelFor(mode) {
  if (mode === 'azure') return 'Azure 雲端';
  if (mode === 'local_gpu') return '本機 GPU（新竹）';
  if (mode === 'remote') return '遠端主機 GPU';
  if (mode === 'fast') return '本機 · 快速';
  return '本機 · 標準';
}

export function shortWorkerUrl(url) {
  return String(url || '').replace(/^https?:\/\//, '');
}

export function transcribeBlockReasonFor(st, { mode, selectedMp4, cloudConsent = false, workerHealth = null, supportsRemote = false } = {}) {
  if (!selectedMp4) return '請先選擇或放入 MP4';
  const files = st?.mp4_files || [];
  if (files.length && !mp4InFileList(selectedMp4, files)) {
    return `找不到 ${selectedMp4}（請按「重新掃描」或確認檔案在 input 資料夾）`;
  }
  if (!st?.python_ok) return '需要 Python 3.10+（請確認轉錄助手視窗已啟動）';
  if (!st?.ffmpeg_ok) return '需要 ffmpeg 抽出音軌，請按「完整環境安裝」或「安裝 ffmpeg」';
  if (mode === 'azure') {
    if (!st?.azure_ok) return '請先填入 Azure Speech 金鑰與區域，或匯入團隊設定';
    if (!cloudConsent) return '使用 Azure 雲端轉錄前，請勾選知情同意';
    return '';
  }
  if (mode === 'local_gpu') {
    if (!st?.venv_ok || !st?.whisperx_ok) {
      return '請先安裝 GPU 版 WhisperX（新竹可執行 start_worker.cmd → 安裝 GPU 版，或按「完整環境安裝」）';
    }
    if (!st?.token_ok) return '本機 GPU 模式請先設定 HF_TOKEN（.env 或下方貼上）';
    if (!st?.cuda_torch_build && st?.venv_ok && st?.whisperx_ok) {
      return (
        st?.gpu_reason ||
        'PyTorch 仍是 CPU 版：請按檢查清單「僅修復 CUDA 版 PyTorch」（勿用「完整環境安裝」）'
      );
    }
    if (!st?.gpu_available) {
      return st?.gpu_reason || '未偵測到可用 GPU，請安裝 CUDA 12.8 版 PyTorch（RTX 50 系列）';
    }
    return '';
  }
  if (mode === 'remote') {
    if (!supportsRemote) {
      return '本機助手版本較舊，不支援遠端主機轉錄，請至 GitHub Releases 更新 Call Coach 助手';
    }
    if (!st?.worker_ok) return '請先填入遠端主機網址與 Worker Token（家用主機的 Worker 視窗會顯示）';
    if (!cloudConsent) return '使用遠端主機轉錄前，請勾選知情同意';
    if (workerHealth && workerHealth.reachable === false) {
      return workerHealth.message || '無法連線遠端 Worker，請先按「測試連線」並確認新竹主機 Worker 視窗已開啟';
    }
    return '';
  }
  if (!st?.venv_ok || !st?.whisperx_ok) return '本機模式請先按「完整環境安裝」；或改選 Azure 雲端轉錄（免安裝）';
  if (!st?.token_ok) return '本機模式請先設定 HF_TOKEN；或改選 Azure 雲端轉錄（不需 Token）';
  return '';
}

export function transcribeButtonLabelFor(mode) {
  if (mode === 'azure') return '開始 Azure 雲端轉錄';
  if (mode === 'remote') return '開始遠端主機轉錄';
  if (mode === 'local_gpu') return '開始本機 GPU 轉錄';
  if (mode === 'fast') return '開始本機轉錄（快速）';
  return '開始本機轉錄（標準）';
}

export function modeHintTextFor(mode) {
  if (mode === 'azure') {
    return 'Azure 雲端模式：ffmpeg 先在本機抽出音軌，再整檔上傳 Azure Speech Fast Transcription（zh-TW，含發言者辨識），48 分鐘 DEMO 通常 2～5 分鐘完成。不需安裝 WhisperX、不需 Hugging Face Token，Smart App Control 也不受影響。';
  }
  if (mode === 'local_gpu') {
    return '新竹本機 GPU：在同一台 GPU 電腦上執行助手，MP4 放 input 資料夾，選此模式即可。使用 WhisperX large-v3 + CUDA（與遠端 Worker 相同品質），音訊不經網路、不需 Worker 網址／Token。長影片以單檔 GPU 轉錄（不分段平行）。';
  }
  if (mode === 'remote') {
    return '遠端主機模式（公司電腦用）：ffmpeg 在本機抽出音軌後，上傳到新竹 Worker。新竹若你親自操作，請改用上方「新竹本機 GPU 轉錄」。';
  }
  if (mode === 'fast') {
    return '快速模式：Faster-Whisper small，本機 CPU 轉錄，速度較快、準確度略降。48 分鐘 DEMO 常需 35～60 分鐘。';
  }
  return '標準模式：Faster-Whisper medium，本機 CPU 轉錄，準確度較佳。48 分鐘 DEMO 常需 50～90 分鐘。長影片會自動分段平行處理。';
}

export function lastErrorLine(logs) {
  const lines = logs || [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (String(lines[i]).includes('[錯誤]')) return String(lines[i]);
  }
  return null;
}

export function transcribeFailToast(logs) {
  const err = lastErrorLine(logs);
  if (!err) return '轉錄失敗，請查看下方記錄';
  return `轉錄失敗：${err.replace(/^\[錯誤\]\s*/, '')}`;
}

export function isGpuSetupEndpoint(endpoint) {
  return (
    endpoint === '/api/setup-gpu' ||
    endpoint === '/api/full-setup-gpu' ||
    endpoint === '/api/repair-gpu-torch'
  );
}
