/**
 * 主管早會錄音的麥克風／收音邏輯（不碰 DOM）：錯誤訊息、MediaRecorder 格式、收音模式、音量計算。
 */
export function describeSpeechError(code) {
  const key = String(code || '').toLowerCase();
  if (key === 'not-allowed' || key === 'service-not-allowed') {
    return '麥克風權限被封鎖。請點網址列左側的鎖頭／設定圖示 → 麥克風 → 允許，重新整理後再試。';
  }
  if (key === 'audio-capture') {
    return '找不到可用的麥克風。請確認耳機或麥克風已接上，並在 Windows「設定 → 系統 → 音效 → 輸入」選對裝置。';
  }
  if (key === 'network') {
    return '瀏覽器語音辨識服務連線失敗。即時辨識需要網路；請確認公司網路沒有封鎖 Google 語音服務後再試。';
  }
  if (key === 'language-not-supported') return '瀏覽器不支援繁體中文語音辨識，請改用最新版 Chrome 或 Edge。';
  if (key === 'no-speech') {
    return '目前沒有偵測到聲音。請取消靜音、提高 Windows 輸入音量，或點網址列設定改選正確的麥克風。';
  }
  return '語音辨識沒有成功啟動，請重新檢查麥克風後再試。';
}

export function describeMicrophoneAccessError(error, { secureContext = true } = {}) {
  if (!secureContext) return '目前不是安全連線，瀏覽器不允許使用麥克風。請改用 https:// 網址。';
  const name = String(error?.name || '');
  if (name === 'NotAllowedError' || name === 'SecurityError') return describeSpeechError('not-allowed');
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return describeSpeechError('audio-capture');
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '麥克風正被其他程式占用，或 Windows 不允許瀏覽器使用。請關閉 Teams／Meet／錄音程式後再試。';
  }
  if (name === 'OverconstrainedError') return '目前的麥克風設定無法使用，請在瀏覽器網站設定中改選其他輸入裝置。';
  return error?.message ? `無法開啟麥克風：${error.message}` : '無法開啟麥克風，請檢查瀏覽器與 Windows 權限。';
}

export function pickRecorderMime(isTypeSupported = () => false) {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((type) =>
    isTypeSupported(type)
  ) || '';
}

export function buildMicrophoneConstraints({
  deviceId = '',
  echoCancellation = true,
  noiseSuppression = true,
  autoGainControl = true,
  preserveSpeakerAudio = false,
} = {}) {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    echoCancellation: preserveSpeakerAudio ? false : !!echoCancellation,
    noiseSuppression: preserveSpeakerAudio ? false : !!noiseSuppression,
    autoGainControl: !!autoGainControl,
  };
}

export function shouldSampleAudioLevel({ recorderState = '', paused = false } = {}) {
  return recorderState === 'recording' && !paused;
}

/** 收音模式 → getUserMedia 的處理選項 */
export function processingForPreset(preset) {
  if (preset === 'distant') {
    return { echoCancellation: false, noiseSuppression: false, autoGainControl: true };
  }
  if (preset === 'raw') {
    return { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  }
  return { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
}

export function detectProcessingPreset(processing) {
  for (const preset of ['standard', 'distant', 'raw']) {
    const value = processingForPreset(preset);
    if (Object.keys(value).every((key) => value[key] === processing[key])) return preset;
  }
  return 'custom';
}

/** 一段時域取樣（Uint8，128＝靜音）換成音量條百分比；rms ≥ 0.012 視為有人聲 */
export function measureAudioLevel(samples) {
  let sum = 0;
  for (const sample of samples) {
    const n = (sample - 128) / 128;
    sum += n * n;
  }
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  return { rms, pct: Math.min(100, Math.round(rms * 420)), hasSignal: rms >= 0.012 };
}

/** 錄音檔下載用的副檔名 */
export function audioFileExtension(mime) {
  const t = String(mime || '');
  return t.includes('mp4') ? 'm4a' : t.includes('ogg') ? 'ogg' : 'webm';
}
