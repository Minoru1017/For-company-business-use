/**
 * 主管早會 · 語音紀錄 UI：按錄音 → 瀏覽器即時語音轉文字 → 逐字稿可修 → 萃取重點（本機規則／AI）
 * → 勾選確認 → 套用為「專案方向」（首頁、工作區頁首、AI prompt 都會對齊）。
 */
import { callGeminiResilient, describeApiKeyProblem } from './gemini.js';
import {
  applyMeetingDirectives,
  archiveDirective,
  listDirectives,
  removeDirective,
} from './coach-directives.js';
import {
  POINT_CATEGORIES,
  buildMeetingSummaryPrompt,
  defaultMeetingTitle,
  deleteMeeting,
  extractKeyPoints,
  formatClock,
  getMeeting,
  linesToTranscript,
  listMeetings,
  newMeetingId,
  normalizePoints,
  parseMeetingSummary,
  saveMeeting,
} from './meeting-notes.js';
import { escapeHTML } from './utils.js';

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
  if (key === 'no-speech') return '目前沒有偵測到聲音，請靠近麥克風說話，並確認輸入音量沒有靜音。';
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

function dateKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function initMeetingNotes(container, { getApiKey, setApiKey, getModel, onGeminiUsed, showToast, onDirectivesChanged } = {}) {
  if (!container) return { activate() {}, syncApiKey() {} };
  const toast = (m) => showToast?.(m);
  const SR = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;

  const state = {
    meeting: null, // 目前這場（含 lines/points）
    recording: false,
    paused: false,
    recognizer: null,
    startedAt: 0,
    elapsedBase: 0, // 暫停前累計秒數
    interim: '',
    timer: null,
    saveT: null,
    aiBusy: false,
    theme: '',
    starting: false,
    recognizerStarted: false,
    speechErrorCount: 0,
  };

  container.innerHTML = `
    <div class="brief">
      <div class="card brief-rec">
        <div class="brief-rec-head">
          <div>
            <h2 class="brief-h">即時語音紀錄</h2>
            <p class="hint brief-lead">早會開始前按「開始錄音」，主管講的話會即時轉成文字；結束後萃取重點、勾選確認，再套用成這套工具的方向。</p>
          </div>
          <span class="brief-status" id="bfStatus">待命</span>
        </div>
        <p class="hint brief-consent">語音辨識由瀏覽器提供（Chrome／Edge 會把聲音送到瀏覽器供應商處理），逐字稿與重點只存在這台電腦。不支援的瀏覽器可在下方直接貼上文字。</p>
        <div class="brief-mic-check" id="bfMicCheck">
          <span class="brief-mic-check-dot" aria-hidden="true"></span>
          <span id="bfMicText">按「開始錄音」後會先檢查麥克風，第一次使用請在瀏覽器跳出的視窗按「允許」。</span>
          <button type="button" class="btn slog-mini" id="bfMicRetry" hidden>重新檢查</button>
        </div>
        <div class="brief-rec-controls">
          <button type="button" class="brief-rec-btn" id="bfToggle"><span class="brief-rec-dot" aria-hidden="true"></span><span id="bfToggleLabel">開始錄音</span></button>
          <span class="brief-timer" id="bfTimer">00:00</span>
          <input type="text" class="field brief-title" id="bfTitle" placeholder="${escapeHTML(defaultMeetingTitle())}" maxlength="60">
          <button type="button" class="btn" id="bfFinish" disabled>結束並整理</button>
        </div>
        <div class="brief-live" id="bfLive" hidden><span class="brief-live-dot" aria-hidden="true"></span><span id="bfInterim" class="brief-interim">聆聽中…</span></div>
        <ol class="brief-lines" id="bfLines"></ol>
        <p class="hint brief-unsupported" id="bfUnsupported" hidden>這個瀏覽器不支援即時語音辨識（建議用 Chrome 或 Edge）。你仍可在下方貼上逐字稿再萃取重點。</p>
      </div>

      <div class="card brief-transcript" id="bfTranscriptCard" hidden>
        <h2 class="brief-h">逐字稿 <span class="slog-count" id="bfLineCount"></span></h2>
        <p class="hint">辨識錯字可直接修；萃取會以這裡的文字為準。</p>
        <textarea class="field brief-text" id="bfText" rows="8" placeholder="貼上或修正主管講話內容…"></textarea>
        <div class="row brief-actions">
          <button type="button" class="primary" id="bfExtract">萃取重點（本機規則）</button>
          <button type="button" class="btn" id="bfExtractAI">AI 萃取重點</button>
          <span class="hint brief-extract-hint" id="bfExtractHint">本機規則只抓「指示語氣、數字目標、話術」句子；AI 會用 Gemini 改寫成清楚的指示。</span>
        </div>
        <div class="row brief-key-row" id="bfKeyRow" hidden>
          <input type="password" class="field" id="bfApiKey" placeholder="貼上 Gemini API Key（與其他模式共用）" autocomplete="off" style="flex:1;min-width:220px">
          <span class="hint" id="bfKeyHint"></span>
        </div>
      </div>

      <div class="card brief-points" id="bfPointsCard" hidden>
        <div class="brief-points-head">
          <h2 class="brief-h">重點 <span class="slog-count" id="bfPointCount"></span></h2>
          <p class="hint">勾選要採用的、可直接改字；「做法」是業務今天能做的一步。</p>
        </div>
        <p class="brief-theme" id="bfTheme" hidden></p>
        <ul class="brief-point-list" id="bfPointList"></ul>
        <div class="row brief-actions">
          <button type="button" class="btn" id="bfAddPoint">＋ 新增一點</button>
          <button type="button" class="primary" id="bfApply">確認並套用到專案方向</button>
          <span class="hint" id="bfApplyHint">套用後：首頁與各模式頁首會顯示；電訪 AI 分析、症狀 AI 診斷會對齊這些方向。</span>
        </div>
      </div>

      <div class="card brief-directives">
        <h2 class="brief-h">目前專案方向 <span class="slog-count" id="bfDirCount"></span></h2>
        <p class="hint">這些是你確認過的主管指示。封存後不再帶進 AI，也不在頁首顯示。</p>
        <ul class="brief-dir-list" id="bfDirList"></ul>
      </div>

      <div class="card brief-history">
        <h2 class="brief-h">過去早會 <span class="slog-count" id="bfHistCount"></span></h2>
        <ul class="brief-hist-list" id="bfHistList"></ul>
      </div>
    </div>`;

  const q = (sel) => container.querySelector(sel);
  const els = {
    status: q('#bfStatus'),
    toggle: q('#bfToggle'),
    toggleLabel: q('#bfToggleLabel'),
    timer: q('#bfTimer'),
    title: q('#bfTitle'),
    finish: q('#bfFinish'),
    live: q('#bfLive'),
    interim: q('#bfInterim'),
    lines: q('#bfLines'),
    unsupported: q('#bfUnsupported'),
    micCheck: q('#bfMicCheck'),
    micText: q('#bfMicText'),
    micRetry: q('#bfMicRetry'),
    transcriptCard: q('#bfTranscriptCard'),
    lineCount: q('#bfLineCount'),
    text: q('#bfText'),
    extract: q('#bfExtract'),
    extractAI: q('#bfExtractAI'),
    extractHint: q('#bfExtractHint'),
    keyRow: q('#bfKeyRow'),
    apiKey: q('#bfApiKey'),
    keyHint: q('#bfKeyHint'),
    pointsCard: q('#bfPointsCard'),
    pointCount: q('#bfPointCount'),
    theme: q('#bfTheme'),
    pointList: q('#bfPointList'),
    addPoint: q('#bfAddPoint'),
    apply: q('#bfApply'),
    applyHint: q('#bfApplyHint'),
    dirCount: q('#bfDirCount'),
    dirList: q('#bfDirList'),
    histCount: q('#bfHistCount'),
    histList: q('#bfHistList'),
  };

  if (!SR) {
    els.unsupported.hidden = false;
    els.unsupported.textContent =
      typeof window !== 'undefined' && !window.isSecureContext
        ? '目前不是安全連線，瀏覽器不允許使用麥克風。請改用 https:// 網址開啟。你仍可在下方貼上逐字稿再萃取重點。'
        : '這個瀏覽器不支援即時語音辨識（建議用最新版 Chrome 或 Edge）。你仍可在下方貼上逐字稿再萃取重點。';
    els.toggle.disabled = true;
    els.transcriptCard.hidden = false;
  }

  /* ---------------- 狀態／儲存 ---------------- */

  function setStatus(text, cls = '') {
    els.status.textContent = text;
    els.status.className = `brief-status ${cls}`;
  }

  function ensureMeeting() {
    if (!state.meeting) {
      state.meeting = {
        id: newMeetingId(),
        title: els.title.value.trim(),
        startedAt: Date.now(),
        lines: [],
        transcript: '',
        points: [],
        applied: false,
      };
    }
    return state.meeting;
  }

  function persist(immediate = false) {
    if (!state.meeting) return;
    clearTimeout(state.saveT);
    const doSave = () => {
      state.meeting.title = els.title.value.trim();
      state.meeting = saveMeeting(state.meeting);
      renderHistory();
    };
    if (immediate) doSave();
    else state.saveT = setTimeout(doSave, 400);
  }

  function elapsedSec() {
    return state.elapsedBase + (state.recording && state.startedAt ? (Date.now() - state.startedAt) / 1000 : 0);
  }

  function tickTimer() {
    els.timer.textContent = formatClock(elapsedSec());
  }

  /* ---------------- 語音辨識 ---------------- */

  function setMicCheck(text, cls = '', { retry = false } = {}) {
    els.micText.textContent = text;
    els.micCheck.className = `brief-mic-check ${cls}`;
    els.micRetry.hidden = !retry;
  }

  async function ensureMicrophoneAccess() {
    const secureContext = typeof window === 'undefined' || window.isSecureContext;
    if (!secureContext) throw Object.assign(new Error('insecure-context'), { name: 'SecurityError' });
    const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;
    if (!media?.getUserMedia) {
      throw Object.assign(new Error('瀏覽器沒有提供麥克風存取功能'), { name: 'NotSupportedError' });
    }
    setMicCheck('正在向瀏覽器確認麥克風權限…', 'checking');
    let stream;
    try {
      stream = await media.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const track = stream.getAudioTracks()[0];
      if (!track || track.readyState !== 'live') {
        throw Object.assign(new Error('找不到啟用中的音訊軌'), { name: 'NotFoundError' });
      }
      const label = track.label?.trim();
      setMicCheck(`麥克風已連線${label ? `：${label}` : ''}`, 'ok');
      return true;
    } catch (error) {
      const message = describeMicrophoneAccessError(error, { secureContext });
      setMicCheck(message, 'bad', { retry: true });
      throw Object.assign(error instanceof Error ? error : new Error(message), { userMessage: message });
    } finally {
      // Web Speech API 會自行開啟預設麥克風；預檢串流只用來確認權限與裝置，立即釋放避免占用。
      stream?.getTracks().forEach((track) => track.stop());
    }
  }

  function resetRecordingUi({ label = '開始錄音' } = {}) {
    state.recording = false;
    state.paused = false;
    state.starting = false;
    state.recognizerStarted = false;
    state.startedAt = 0;
    clearInterval(state.timer);
    els.toggle.disabled = !SR;
    els.toggle.classList.remove('on');
    els.toggleLabel.textContent = label;
    els.live.hidden = true;
    tickTimer();
  }

  function failRecording(message, status = '麥克風無聲音') {
    if (state.recording) state.elapsedBase = elapsedSec();
    state.recording = false;
    state.paused = false;
    stopRecognizer();
    resetRecordingUi();
    els.finish.disabled = !(state.meeting?.lines?.length);
    els.transcriptCard.hidden = false;
    setStatus(status, 'bad');
    setMicCheck(message, 'bad', { retry: true });
    toast(message);
  }

  function appendLine(text) {
    const clean = String(text || '').trim();
    if (!clean) return;
    const m = ensureMeeting();
    m.lines.push({ t: elapsedSec(), text: clean });
    state.speechErrorCount = 0;
    setStatus('錄音中 · 已收到聲音', 'ok');
    setMicCheck('已收到聲音，正在即時轉成文字', 'ok');
    renderLines();
    persist();
  }

  function startRecognizer() {
    if (!SR) return false;
    const rec = new SR();
    rec.lang = 'zh-TW';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => {
      if (state.recognizer !== rec) return;
      state.recognizerStarted = true;
      setStatus('錄音中 · 等待說話', 'ok');
      els.interim.textContent = '請對著麥克風說話…';
    };
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) appendLine(res[0].transcript);
        else interim += res[0].transcript;
      }
      state.interim = interim;
      els.interim.textContent = interim || '聆聽中…';
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        failRecording(describeSpeechError(e.error), '麥克風被拒');
        return;
      }
      if (e.error === 'audio-capture') {
        failRecording(describeSpeechError(e.error), '找不到麥克風');
        return;
      }
      if (e.error === 'language-not-supported') {
        failRecording(describeSpeechError(e.error), '不支援中文辨識');
        return;
      }
      if (e.error === 'network') {
        state.speechErrorCount++;
        if (state.speechErrorCount >= 2) {
          failRecording(describeSpeechError(e.error), '辨識服務連線失敗');
          return;
        }
        setStatus('辨識服務連線失敗，重試中…', 'warn');
        setMicCheck(describeSpeechError(e.error), 'warn', { retry: true });
      }
      if (e.error === 'no-speech') {
        setStatus('錄音中 · 尚未聽到聲音', 'warn');
        setMicCheck(describeSpeechError(e.error), 'warn', { retry: true });
        els.interim.textContent = '沒有偵測到聲音，請確認麥克風未靜音…';
      }
      // aborted 通常是暫停／結束造成；onend 會依 state 決定是否重啟。
    };
    rec.onend = () => {
      if (state.recognizer !== rec) return;
      state.recognizer = null;
      state.recognizerStarted = false;
      // Chrome 會在靜音或約一分鐘後自動停止；錄音中就接著開
      if (state.recording && !state.paused) {
        setTimeout(() => {
          if (state.recording && !state.paused && !state.recognizer) startRecognizer();
        }, 250);
      }
    };
    state.recognizer = rec;
    try {
      rec.start();
      return true;
    } catch (error) {
      state.recognizer = null;
      state.recognizerStarted = false;
      failRecording(
        error?.message ? `語音辨識無法啟動：${error.message}` : describeSpeechError('start-failed'),
        '啟動失敗'
      );
      return false;
    }
  }

  function stopRecognizer() {
    const rec = state.recognizer;
    state.recognizer = null;
    try {
      rec?.stop();
    } catch {
      /* ignore */
    }
  }

  async function startRecording() {
    if (!SR || state.starting) return;
    state.starting = true;
    els.toggle.disabled = true;
    els.toggleLabel.textContent = '檢查麥克風…';
    setStatus('檢查麥克風', 'warn');
    try {
      await ensureMicrophoneAccess();
    } catch (error) {
      resetRecordingUi();
      setStatus('無法使用麥克風', 'bad');
      els.transcriptCard.hidden = false;
      toast(error?.userMessage || describeMicrophoneAccessError(error, { secureContext: window.isSecureContext }));
      return;
    }
    ensureMeeting();
    state.starting = false;
    state.recording = true;
    state.paused = false;
    state.startedAt = Date.now();
    state.speechErrorCount = 0;
    clearInterval(state.timer);
    state.timer = setInterval(tickTimer, 500);
    els.toggle.classList.add('on');
    els.toggleLabel.textContent = '暫停';
    els.toggle.disabled = false;
    els.finish.disabled = false;
    els.live.hidden = false;
    els.interim.textContent = '正在啟動語音辨識…';
    setStatus('啟動辨識中', 'warn');
    if (!startRecognizer()) return;
    persist(true);
  }

  function pauseRecording() {
    state.elapsedBase = elapsedSec();
    state.recording = false;
    state.paused = true;
    state.startedAt = 0;
    clearInterval(state.timer);
    stopRecognizer();
    els.toggle.classList.remove('on');
    els.toggleLabel.textContent = '繼續錄音';
    els.live.hidden = true;
    setStatus('已暫停', 'warn');
    tickTimer();
    persist(true);
  }

  function stopRecording({ finish = true } = {}) {
    if (state.recording) state.elapsedBase = elapsedSec();
    state.recording = false;
    state.paused = false;
    state.starting = false;
    state.recognizerStarted = false;
    state.startedAt = 0;
    clearInterval(state.timer);
    stopRecognizer();
    els.toggle.classList.remove('on');
    els.toggleLabel.textContent = '開始錄音';
    els.live.hidden = true;
    tickTimer();
    if (!finish) return;
    const m = ensureMeeting();
    m.endedAt = Date.now();
    m.transcript = m.transcript?.trim() ? m.transcript : linesToTranscript(m.lines);
    els.text.value = m.transcript;
    els.transcriptCard.hidden = false;
    els.finish.disabled = true;
    setStatus(m.lines.length ? `已結束 · ${m.lines.length} 段` : '已結束', '');
    persist(true);
    if (m.transcript.trim()) runRuleExtract();
    els.transcriptCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------- 萃取 ---------------- */

  function currentTranscript() {
    return els.text.value.trim();
  }

  function runRuleExtract() {
    const text = currentTranscript();
    if (!text) return toast('沒有逐字稿可萃取');
    const m = ensureMeeting();
    m.transcript = text;
    const pts = extractKeyPoints(text);
    if (!pts.length) {
      toast('本機規則沒抓到明確指示句，可改用 AI 萃取或手動新增');
    }
    m.points = normalizePoints(pts);
    state.theme = '';
    renderPoints();
    persist();
  }

  async function runAiExtract() {
    if (state.aiBusy) return;
    const text = currentTranscript();
    if (!text) return toast('沒有逐字稿可萃取');
    const key = (getApiKey?.() || '').trim();
    const problem = describeApiKeyProblem(key);
    if (problem) {
      els.keyRow.hidden = false;
      els.keyHint.textContent = problem;
      els.apiKey.focus();
      return;
    }
    const m = ensureMeeting();
    m.transcript = text;
    state.aiBusy = true;
    els.extractAI.disabled = true;
    els.extractHint.textContent = 'AI 整理中…';
    try {
      const { parsed, usedTokens } = await callGeminiResilient({
        apiKey: key,
        model: getModel?.(),
        text: buildMeetingSummaryPrompt(text, { date: dateKeyOf(m.startedAt) }),
        parse: (raw) => parseMeetingSummary(raw),
        onRetry: ({ attempt, maxAttempts, delayMs, status }) => {
          els.extractHint.textContent = `Google 回報 ${status}，${Math.round(delayMs / 1000)} 秒後重試（${attempt}/${maxAttempts}）…`;
        },
      });
      onGeminiUsed?.(usedTokens || 0);
      if (!parsed.points.length) {
        toast('AI 沒有回傳重點，請再試一次或改用本機規則');
      } else {
        m.points = parsed.points;
        state.theme = parsed.theme;
        renderPoints();
        persist();
        toast(`AI 萃取 ${parsed.points.length} 點`);
      }
      els.extractHint.textContent = '完成。請勾選、修改後套用。';
    } catch (e) {
      els.extractHint.textContent = `AI 失敗：${e?.message || e}`;
      if (e?.status === 400 || e?.status === 401 || e?.status === 403) els.keyRow.hidden = false;
    } finally {
      state.aiBusy = false;
      els.extractAI.disabled = false;
    }
  }

  /* ---------------- 套用 ---------------- */

  function applyPoints() {
    const m = state.meeting;
    if (!m) return;
    const selected = m.points.filter((p) => p.selected && p.text.trim());
    if (!selected.length) return toast('請至少勾選一點');
    m.title = els.title.value.trim() || defaultMeetingTitle(m.startedAt);
    applyMeetingDirectives({
      meetingId: m.id,
      meetingTitle: m.title,
      date: dateKeyOf(m.startedAt),
      points: selected,
    });
    m.applied = true;
    persist(true);
    renderDirectives();
    onDirectivesChanged?.();
    toast(`已套用 ${selected.length} 條方向`);
    els.applyHint.textContent = `已於 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 套用；首頁與各模式頁首會顯示，AI 分析會對齊。`;
  }

  /* ---------------- 渲染 ---------------- */

  function renderLines() {
    const lines = state.meeting?.lines || [];
    els.lines.innerHTML = lines
      .map((l) => `<li><span class="brief-line-t">${formatClock(l.t)}</span><span class="brief-line-text">${escapeHTML(l.text)}</span></li>`)
      .join('');
    els.lines.scrollTop = els.lines.scrollHeight;
    els.lineCount.textContent = lines.length ? `${lines.length} 段` : '';
  }

  function renderPoints() {
    const pts = state.meeting?.points || [];
    els.pointsCard.hidden = false;
    els.pointCount.textContent = pts.length ? `${pts.filter((p) => p.selected).length}/${pts.length} 選用` : '';
    els.theme.hidden = !state.theme;
    els.theme.textContent = state.theme ? `今天主管想強調：${state.theme}` : '';
    const catOpts = (cur) =>
      Object.entries(POINT_CATEGORIES)
        .map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.label}</option>`)
        .join('');
    els.pointList.innerHTML = pts.length
      ? pts
          .map(
            (p) => `<li class="brief-point ${p.selected ? 'on' : ''}" data-id="${escapeHTML(p.id)}">
          <label class="brief-point-check"><input type="checkbox" data-sel ${p.selected ? 'checked' : ''}></label>
          <div class="brief-point-body">
            <div class="brief-point-row">
              <select class="field brief-point-cat" data-cat>${catOpts(p.category)}</select>
              <input type="text" class="field brief-point-text" data-text value="${escapeHTML(p.text)}" placeholder="重點（一句話）">
              <span class="brief-point-src">${p.source === 'ai' ? 'AI' : p.source === 'manual' ? '手動' : '規則'}</span>
              <button type="button" class="btn slog-mini danger" data-del title="刪除">✕</button>
            </div>
            <input type="text" class="field brief-point-action" data-action value="${escapeHTML(p.action || '')}" placeholder="做法：業務今天可以怎麼做（選填）">
          </div>
        </li>`
          )
          .join('')
      : '<li class="hint brief-empty">尚無重點。按上方「萃取重點」或「＋ 新增一點」。</li>';
  }

  function renderDirectives() {
    const list = listDirectives({ includeArchived: true });
    const active = list.filter((d) => !d.archived);
    els.dirCount.textContent = active.length ? `${active.length} 條` : '';
    els.dirList.innerHTML = list.length
      ? list
          .map(
            (d) => `<li class="brief-dir ${d.archived ? 'archived' : ''}" data-id="${escapeHTML(d.id)}">
          <span class="brief-dir-cat">${escapeHTML(POINT_CATEGORIES[d.category]?.label || '')}</span>
          <div class="brief-dir-body">
            <span class="brief-dir-text">${escapeHTML(d.text)}</span>
            ${d.action ? `<span class="brief-dir-act">做法：${escapeHTML(d.action)}</span>` : ''}
            <span class="brief-dir-meta">${escapeHTML(d.date || '')}${d.meetingTitle ? ` · ${escapeHTML(d.meetingTitle)}` : ''}${d.archived ? ' · 已封存' : ''}</span>
          </div>
          <span class="brief-dir-actions">
            <button type="button" class="btn slog-mini" data-archive="${d.archived ? '0' : '1'}">${d.archived ? '恢復' : '封存'}</button>
            <button type="button" class="btn slog-mini danger" data-remove>刪除</button>
          </span>
        </li>`
          )
          .join('')
      : '<li class="hint brief-empty">尚未套用任何方向。錄完早會、萃取重點並確認後會出現在這裡。</li>';
  }

  function renderHistory() {
    const list = listMeetings();
    els.histCount.textContent = list.length ? `${list.length} 場` : '';
    els.histList.innerHTML = list.length
      ? list
          .map((m) => {
            const dur = m.endedAt && m.startedAt ? Math.round((m.endedAt - m.startedAt) / 60000) : null;
            const cur = state.meeting?.id === m.id;
            return `<li class="brief-hist ${cur ? 'current' : ''}" data-id="${escapeHTML(m.id)}">
            <div class="brief-hist-main">
              <span class="brief-hist-title">${escapeHTML(m.title)}</span>
              <span class="brief-hist-meta">${escapeHTML(dateKeyOf(m.startedAt))}${dur != null ? ` · ${dur} 分` : ''} · ${m.lines?.length || 0} 段 · ${m.points?.length || 0} 點${m.applied ? ' · <b>已套用</b>' : ''}</span>
            </div>
            <span class="brief-hist-actions">
              <button type="button" class="btn slog-mini" data-open>開啟</button>
              <button type="button" class="btn slog-mini danger" data-del>刪除</button>
            </span>
          </li>`;
          })
          .join('')
      : '<li class="hint brief-empty">還沒有紀錄。</li>';
  }

  function openMeeting(id) {
    if (state.recording) return toast('請先結束目前錄音');
    const m = getMeeting(id);
    if (!m) return;
    state.meeting = { ...m, lines: m.lines.map((l) => ({ ...l })), points: normalizePoints(m.points) };
    state.elapsedBase = m.endedAt && m.startedAt ? (m.endedAt - m.startedAt) / 1000 : m.lines.at(-1)?.t || 0;
    state.theme = '';
    els.title.value = m.title || '';
    els.text.value = m.transcript || linesToTranscript(m.lines);
    els.transcriptCard.hidden = false;
    els.finish.disabled = true;
    tickTimer();
    renderLines();
    if (state.meeting.points.length) renderPoints();
    else els.pointsCard.hidden = true;
    renderHistory();
    setStatus(m.applied ? '已套用' : '已結束', '');
    container.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function newSession() {
    state.meeting = null;
    state.elapsedBase = 0;
    state.theme = '';
    els.title.value = '';
    els.text.value = '';
    els.lines.innerHTML = '';
    els.lineCount.textContent = '';
    els.transcriptCard.hidden = !!SR;
    els.pointsCard.hidden = true;
    els.finish.disabled = true;
    tickTimer();
    setStatus('待命');
  }

  /* ---------------- 事件 ---------------- */

  els.toggle.addEventListener('click', () => {
    if (state.recording) pauseRecording();
    else {
      if (state.meeting?.endedAt && !state.paused) newSession();
      startRecording();
    }
  });
  els.micRetry.addEventListener('click', () => {
    if (!state.recording && !state.starting) startRecording();
  });
  els.finish.addEventListener('click', () => stopRecording({ finish: true }));
  els.title.addEventListener('input', () => persist());
  els.text.addEventListener('input', () => {
    if (!state.meeting) ensureMeeting();
    state.meeting.transcript = els.text.value;
    persist();
  });
  els.extract.addEventListener('click', runRuleExtract);
  els.extractAI.addEventListener('click', runAiExtract);
  els.apiKey.addEventListener('change', () => {
    const v = els.apiKey.value.trim();
    setApiKey?.(v);
    els.keyHint.textContent = describeApiKeyProblem(v) || '已儲存，再按一次「AI 萃取重點」';
  });
  els.addPoint.addEventListener('click', () => {
    const m = ensureMeeting();
    // normalizePoints 會丟掉空字串，手動新增先給佈位文字讓使用者覆寫
    m.points.push({ id: `p_${Date.now().toString(36)}`, text: '（請輸入重點）', category: 'process', action: '', selected: true, source: 'manual' });
    renderPoints();
    els.pointList.querySelector('li:last-child [data-text]')?.focus();
    els.pointList.querySelector('li:last-child [data-text]')?.select();
  });
  els.apply.addEventListener('click', applyPoints);

  els.pointList.addEventListener('input', (e) => {
    const li = e.target.closest('.brief-point');
    if (!li || !state.meeting) return;
    const p = state.meeting.points.find((x) => x.id === li.dataset.id);
    if (!p) return;
    if (e.target.matches('[data-text]')) p.text = e.target.value;
    if (e.target.matches('[data-action]')) p.action = e.target.value;
    if (e.target.matches('[data-cat]')) p.category = e.target.value;
    if (e.target.matches('[data-sel]')) {
      p.selected = e.target.checked;
      li.classList.toggle('on', p.selected);
      els.pointCount.textContent = `${state.meeting.points.filter((x) => x.selected).length}/${state.meeting.points.length} 選用`;
    }
    persist();
  });
  els.pointList.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (!del || !state.meeting) return;
    const li = del.closest('.brief-point');
    state.meeting.points = state.meeting.points.filter((x) => x.id !== li.dataset.id);
    renderPoints();
    persist();
  });

  els.dirList.addEventListener('click', (e) => {
    const li = e.target.closest('.brief-dir');
    if (!li) return;
    const arch = e.target.closest('[data-archive]');
    if (arch) {
      archiveDirective(li.dataset.id, arch.dataset.archive === '1');
      renderDirectives();
      onDirectivesChanged?.();
      return;
    }
    if (e.target.closest('[data-remove]')) {
      removeDirective(li.dataset.id);
      renderDirectives();
      onDirectivesChanged?.();
    }
  });

  els.histList.addEventListener('click', (e) => {
    const li = e.target.closest('.brief-hist');
    if (!li) return;
    if (e.target.closest('[data-open]')) return openMeeting(li.dataset.id);
    if (e.target.closest('[data-del]')) {
      if (!confirm('刪除這場早會紀錄？（已套用的方向會保留）')) return;
      deleteMeeting(li.dataset.id);
      if (state.meeting?.id === li.dataset.id) newSession();
      renderHistory();
    }
  });

  window.addEventListener('beforeunload', () => {
    if (state.recording || state.paused) persist(true);
  });

  renderDirectives();
  renderHistory();
  tickTimer();

  return {
    activate() {
      renderDirectives();
      renderHistory();
    },
    syncApiKey(v) {
      els.apiKey.value = v || '';
    },
    isRecording: () => state.recording,
  };
}
