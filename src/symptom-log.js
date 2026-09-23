/**
 * 開發症狀紀錄（純瀏覽器版）
 *   日曆 → 點一天 → 填漏斗（撥出／接通／>N 分／長 Call／邀約）→ 匯入公司電話系統的 wav
 *   → 點檔名直接播放、全選 → 批次分析（先轉錄再跑規則分析）→ 共同病症 → AI 診斷 → 改善筆記。
 * 錄音與逐字稿都存在這台電腦的 IndexedDB；只有轉錄／AI 診斷會把資料送到你選的引擎。
 */
import { runAnalysis } from './analyze.js';
import { AUDIO_ACCEPT, describeSize, transcribeAudioWithGemini, validateAudioFile, guessAudioMime } from './audio-transcribe.js';
import { loadWorkerSettings, transcribeViaWorker } from './browser-worker-transcribe.js';
import { callGeminiResilient, describeApiKeyProblem } from './gemini.js';
import { applyBuiltinSpeakerLabels, enrichSegments, parse } from './parser.js';
import { autoGuess } from './speaker.js';
import { labeledRatio } from './speaker-labels.js';
import {
  SYMPTOM_DEFS,
  aggregateSymptoms,
  buildDiagnosisPrompt,
  calendarGrid,
  dateKey,
  extractSymptoms,
  formatDuration,
  funnelFromCalls,
  parseDateFromFilename,
  parseDateKey,
  parseDiagnosis,
  shiftDateKey,
  symptomStreak,
} from './symptom-engine.js';
import {
  deleteAudio,
  deleteCall,
  getAudio,
  getDay,
  getSettings,
  listCalls,
  listDays,
  newId,
  putAudio,
  putCall,
  putDay,
  saveSettings,
  storageEstimate,
  summarizeRange,
} from './symptom-store.js';
import { escapeHTML } from './utils.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const IMPORT_ACCEPT = AUDIO_ACCEPT;

function fmtPct(v) {
  return v == null ? '—' : `${Math.round(v * 100)}%`;
}

function fmtDateLabel(key) {
  const d = parseDateKey(key);
  if (!d) return key;
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`;
}

/** 用 <audio> 讀出長度（公司電話系統的 wav 檔名通常沒有秒數）。讀不到回 0。 */
function probeDuration(blob) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return resolve(0);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('audio');
    const done = (v) => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(v) && v > 0 ? Math.round(v) : 0);
    };
    const timer = setTimeout(() => done(0), 8000);
    a.preload = 'metadata';
    a.onloadedmetadata = () => {
      if (a.duration === Infinity) {
        // 某些串流式 wav 需要 seek 到尾才知道長度
        a.currentTime = 1e9;
        a.ontimeupdate = () => done(a.duration);
        return;
      }
      done(a.duration);
    };
    a.onerror = () => done(0);
    a.src = url;
  });
}

function srtToSegments(srt) {
  const segs = parse(srt);
  applyBuiltinSpeakerLabels(segs);
  if (labeledRatio(segs) < 0.5) autoGuess(segs);
  return segs;
}

function plainSegs(segs) {
  return segs.map((s) => ({ start: s.start, end: s.end, text: s.text, spk: s.spk }));
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {()=>string} opts.getApiKey
 * @param {(v:string)=>void} opts.setApiKey
 * @param {()=>string} opts.getModel
 * @param {(tokens:number)=>void} [opts.onGeminiUsed]
 * @param {(msg:string)=>void} [opts.showToast]
 * @param {(segs:Array, name:string)=>void} [opts.onOpenCall]  在完整分析中開啟某通
 * @returns {{ activate():void, syncApiKey(v:string):void }}
 */
export function initSymptomLog(container, { getApiKey, setApiKey, getModel, onGeminiUsed, showToast, onOpenCall }) {
  if (!container) return { activate() {}, syncApiKey() {} };

  const today = dateKey(new Date());
  const state = {
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    selected: null,
    day: null,
    calls: [],
    selection: new Set(),
    settings: { shortMin: 5, longMin: 15, engine: 'gemini' },
    monthSummary: {},
    streakHistory: {},
    yesterdayNote: null,
    busy: false,
    aiBusy: false,
    abort: null,
    workerAbort: null,
    playingId: null,
    playingUrl: null,
    activated: false,
    dbError: '',
  };

  container.innerHTML = `
    <div class="slog">
      <div class="slog-top">
        <div class="card slog-cal">
          <div class="slog-cal-head">
            <button type="button" class="btn slog-nav" data-nav="-1" aria-label="上個月">‹</button>
            <strong id="slMonthLabel"></strong>
            <button type="button" class="btn slog-nav" data-nav="1" aria-label="下個月">›</button>
            <button type="button" class="btn slog-today" id="slToday">今天</button>
          </div>
          <div class="slog-weekdays">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div>
          <div class="slog-grid" id="slGrid"></div>
          <p class="hint slog-legend"><span class="slog-dot calls"></span>有錄音 <span class="slog-dot analyzed"></span>已分析 <span class="slog-dot note"></span>有筆記 ・ 點日期進入當天</p>
          <div class="hint" id="slStorage"></div>
          <div class="bridge-upload-status err hidden" id="slDbError"></div>
        </div>
        <div class="card slog-week">
          <h2>近 7 天</h2>
          <div id="slWeek" class="slog-week-list"></div>
        </div>
      </div>

      <div class="slog-day" id="slDay" hidden>
        <div class="card slog-funnel">
          <h2 id="slDayTitle"></h2>
          <div class="slog-funnel-grid">
            <label>撥出<input type="number" min="0" inputmode="numeric" data-day="dialed" placeholder="0"></label>
            <label>接通<input type="number" min="0" inputmode="numeric" data-day="connected" placeholder="0"></label>
            <label>超過 <span id="slShortMinLabel">5</span> 分<input type="number" min="0" inputmode="numeric" data-day="over5Manual" placeholder="自動"></label>
            <label>長 Call（≥<span id="slLongMinLabel">15</span> 分）<input type="number" min="0" inputmode="numeric" data-day="longManual" placeholder="自動"></label>
            <label>進邀約<input type="number" min="0" inputmode="numeric" data-day="invites" placeholder="0"></label>
          </div>
          <div class="slog-funnel-bar" id="slFunnelBar"></div>
          <details class="slog-settings">
            <summary>門檻設定</summary>
            <label>「超過 N 分」的 N <input type="number" min="1" max="60" data-setting="shortMin"></label>
            <label>「長 Call」≥ 幾分 <input type="number" min="1" max="180" data-setting="longMin"></label>
            <span class="hint">留空的欄位會依匯入錄音的長度自動計算；手填會覆蓋自動值。</span>
          </details>
        </div>

        <div class="card slog-calls">
          <div class="slog-calls-head">
            <h2>當天錄音 <span class="slog-count" id="slCallCount"></span></h2>
            <div class="bridge-actions">
              <button type="button" class="btn" id="slImport">匯入錄音檔</button>
              <button type="button" class="btn" id="slSelectAll">全選</button>
              <button type="button" class="btn" id="slSelectNone">取消全選</button>
            </div>
            <input type="file" id="slFile" accept="${escapeHTML(IMPORT_ACCEPT)}" multiple hidden>
          </div>
          <div class="slog-drop" id="slDrop">把公司電話系統匯出的 wav／mp3 拖到這裡（可多檔）。檔名有日期（如 <code>20260923_1430_0912xxx.wav</code>）會自動歸到那一天，沒有就歸到目前選的日期。錄音只存在這台電腦。</div>
          <ul class="slog-list" id="slList"></ul>

          <div class="slog-engine">
            <div class="dev-audio-engines">
              <label class="dev-audio-engine" data-engine="gemini">
                <input type="radio" name="slEngine" value="gemini">
                <span><b>Gemini 雲端轉錄</b><small>只要 API Key；未轉錄的錄音會送到 Google</small></span>
              </label>
              <label class="dev-audio-engine" data-engine="worker">
                <input type="radio" name="slEngine" value="worker">
                <span><b>新竹 GPU Worker</b>（不出 Google）<small>沿用「開發 · 電訪」／DEMO 填過的 Worker 網址與 Token</small></span>
              </label>
            </div>
            <div id="slGeminiPane">
              <input type="password" id="slKey" class="bridge-token" placeholder="貼上 Gemini API Key（與 AI 深度分析共用）" autocomplete="off">
              <div class="bridge-upload-status err hidden" id="slKeyHint"></div>
            </div>
            <div id="slWorkerPane" class="hint" hidden></div>
            <label class="bridge-consent">
              <input type="checkbox" id="slConsent">
              我確認所選<strong>尚未轉錄</strong>的錄音可以傳送到<span id="slConsentTarget">Google Gemini</span>轉成逐字稿（已轉錄的只在本機重跑規則分析，不會再上傳）——每次批次都需重新勾選
            </label>
            <div class="bridge-actions">
              <button type="button" class="btn primary" id="slBatch" disabled>批次分析所選</button>
              <button type="button" class="btn bridge-cancel hidden" id="slCancel">取消</button>
            </div>
            <div class="bridge-upload-status hidden" id="slStatus"></div>
          </div>
        </div>

        <div class="card slog-agg">
          <h2>共同病症 <span class="slog-count" id="slAggCount"></span></h2>
          <div id="slMetrics" class="slog-metrics"></div>
          <div id="slSymptoms" class="slog-symptoms"></div>
          <div class="slog-ai">
            <label class="bridge-consent">
              <input type="checkbox" id="slAiConsent">
              我同意把<strong>當天的彙總數字、症狀次數與最多 3 句原話</strong>（不含整份逐字稿、不含錄音）送到 Google Gemini 做診斷——每次都需重新勾選
            </label>
            <div class="bridge-actions">
              <button type="button" class="btn primary" id="slDiagnose" disabled>AI 診斷共同病症</button>
            </div>
            <div class="bridge-upload-status hidden" id="slAiStatus"></div>
            <div id="slDiagnosis" class="slog-diagnosis"></div>
          </div>
        </div>

        <div class="card slog-note">
          <h2>改善筆記</h2>
          <div class="slog-yesterday hint" id="slYesterday"></div>
          <div class="slog-note-grid">
            <label>今天看到的病症<input type="text" data-note="symptom" placeholder="例：客戶第一次說出困擾都在 6 分鐘後"></label>
            <label>明天只改一個動作<input type="text" data-note="action" placeholder="例：第 3 個問題前不提任何方案"></label>
            <label>怎麼驗證有沒有做到<input type="text" data-note="verify" placeholder="例：明天 >5 分的通話裡，客戶說出困擾的時間要 < 4 分"></label>
          </div>
          <textarea data-note="free" rows="4" placeholder="其他觀察、當天心情、同事給的回饋……"></textarea>
          <div class="hint" id="slNoteSaved"></div>
        </div>
      </div>
    </div>
  `;

  const q = (sel) => container.querySelector(sel);
  const gridEl = q('#slGrid');
  const monthLabel = q('#slMonthLabel');
  const dayEl = q('#slDay');
  const listEl = q('#slList');
  const statusEl = q('#slStatus');
  const keyEl = q('#slKey');
  const keyHintEl = q('#slKeyHint');
  const consentEl = q('#slConsent');
  const batchBtn = q('#slBatch');
  const cancelBtn = q('#slCancel');
  const fileInput = q('#slFile');
  const aiConsentEl = q('#slAiConsent');
  const diagnoseBtn = q('#slDiagnose');
  const aiStatusEl = q('#slAiStatus');
  const diagnosisEl = q('#slDiagnosis');

  const toast = (m) => showToast?.(m);

  const setStatus = (el, msg, kind = 'busy') => {
    if (!el) return;
    el.classList.remove('hidden', 'busy', 'ok', 'err');
    el.classList.add(kind);
    el.textContent = msg;
  };
  const hideStatus = (el) => el?.classList.add('hidden');

  const showDbError = (e) => {
    state.dbError = e?.message || String(e);
    const el = q('#slDbError');
    if (el) {
      el.textContent = `無法讀寫本機資料庫：${state.dbError}。無痕視窗、停用網站資料或 Safari 隱私模式都可能造成此問題。`;
      el.classList.remove('hidden');
    }
  };

  /* ---------------- 日曆 ---------------- */

  async function refreshMonth() {
    const cells = calendarGrid(state.year, state.month);
    try {
      state.monthSummary = await summarizeRange(cells[0].key, cells[cells.length - 1].key);
    } catch (e) {
      showDbError(e);
      state.monthSummary = {};
    }
    monthLabel.textContent = `${state.year} 年 ${state.month} 月`;
    gridEl.innerHTML = cells
      .map((c) => {
        const s = state.monthSummary[c.key];
        const cls = ['slog-cell'];
        if (!c.inMonth) cls.push('out');
        if (c.key === today) cls.push('today');
        if (c.key === state.selected) cls.push('selected');
        if (c.weekday === 0 || c.weekday === 6) cls.push('weekend');
        const dots = s
          ? `${s.calls ? `<span class="slog-dot calls" title="${s.calls} 通錄音"></span>` : ''}${s.analyzed ? '<span class="slog-dot analyzed" title="已分析"></span>' : ''}${s.hasNote ? '<span class="slog-dot note" title="有筆記"></span>' : ''}`
          : '';
        const n = s?.calls ? `<span class="slog-cell-n">${s.calls}</span>` : '';
        return `<button type="button" class="${cls.join(' ')}" data-date="${c.key}"><span class="slog-cell-d">${c.day}</span>${n}<span class="slog-dots">${dots}</span></button>`;
      })
      .join('');
    refreshStorage();
  }

  async function refreshStorage() {
    const el = q('#slStorage');
    if (!el) return;
    const est = await storageEstimate();
    if (!est || !est.quota) {
      el.textContent = '';
      return;
    }
    el.textContent = `本機已用 ${describeSize(est.usage)}／可用約 ${describeSize(est.quota)}（錄音存在這台電腦的瀏覽器；清除網站資料會一併刪除）`;
  }

  async function refreshWeek() {
    const el = q('#slWeek');
    if (!el) return;
    const end = state.selected || today;
    const start = shiftDateKey(end, -6);
    let summary = {};
    let days = [];
    try {
      [summary, days] = await Promise.all([summarizeRange(start, end), listDays(start, end)]);
    } catch (e) {
      showDbError(e);
    }
    const dayMap = Object.fromEntries((days || []).map((d) => [d.date, d]));
    const rows = [];
    for (let i = 6; i >= 0; i--) {
      const k = shiftDateKey(end, -i);
      const s = summary[k];
      const d = dayMap[k];
      const f = d || s ? funnelFromCalls(d || {}, (s?.durations || []).map((sec) => ({ durationSec: sec })), state.settings) : null;
      const top = s?.symptoms?.length
        ? s.symptoms
            .slice(0, 2)
            .map((key) => SYMPTOM_DEFS[key]?.label)
            .filter(Boolean)
            .join('、')
        : '';
      const empty = !s && !d;
      rows.push(
        `<button type="button" class="slog-week-row ${k === state.selected ? 'selected' : ''} ${empty ? 'empty' : ''}" data-date="${k}">
          <span class="slog-week-date">${fmtDateLabel(k)}</span>
          <span class="slog-week-funnel">${f && (f.dialed || f.connected || f.over) ? `撥 ${f.dialed} · 通 ${f.connected} · >${f.shortMin}分 ${f.over} · 約 ${f.invites}` : '—'}</span>
          <span class="slog-week-calls">${s?.calls ? `${s.calls} 通${s.analyzed ? `・${s.analyzed} 已析` : ''}` : ''}</span>
          <span class="slog-week-sym">${escapeHTML(top)}</span>
        </button>`
      );
    }
    el.innerHTML = rows.join('');
  }

  gridEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (btn) selectDay(btn.dataset.date);
  });
  q('#slWeek').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-date]');
    if (btn) selectDay(btn.dataset.date);
  });
  container.querySelectorAll('.slog-nav').forEach((b) =>
    b.addEventListener('click', () => {
      const d = new Date(state.year, state.month - 1 + Number(b.dataset.nav), 1);
      state.year = d.getFullYear();
      state.month = d.getMonth() + 1;
      refreshMonth();
    })
  );
  q('#slToday').addEventListener('click', () => {
    state.year = Number(today.slice(0, 4));
    state.month = Number(today.slice(5, 7));
    selectDay(today);
  });

  /* ---------------- 日檢視 ---------------- */

  async function selectDay(key) {
    if (!parseDateKey(key)) return;
    stopPlayback();
    state.selected = key;
    state.selection = new Set();
    const d = parseDateKey(key);
    if (d.getFullYear() !== state.year || d.getMonth() + 1 !== state.month) {
      state.year = d.getFullYear();
      state.month = d.getMonth() + 1;
    }
    try {
      [state.day, state.calls] = await Promise.all([getDay(key), listCalls(key)]);
      state.yesterdayNote = (await getDay(shiftDateKey(key, -1)))?.note || null;
    } catch (e) {
      showDbError(e);
      state.day = null;
      state.calls = [];
    }
    state.day ||= { date: key, note: {} };
    dayEl.hidden = false;
    q('#slDayTitle').textContent = `${fmtDateLabel(key)} 的漏斗`;
    renderFunnelInputs();
    renderFunnelBar();
    renderCalls();
    renderAggregate();
    renderNotes();
    await Promise.all([refreshMonth(), refreshWeek(), refreshStreaks()]);
    if (typeof dayEl.scrollIntoView === 'function' && key !== today) dayEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderFunnelInputs() {
    container.querySelectorAll('[data-day]').forEach((inp) => {
      const v = state.day?.[inp.dataset.day];
      inp.value = v == null || v === '' ? '' : String(v);
    });
    const f = funnelFromCalls(state.day || {}, state.calls, state.settings);
    const over = q('[data-day="over5Manual"]');
    const long = q('[data-day="longManual"]');
    if (over) over.placeholder = `自動 ${f.autoOver}`;
    if (long) long.placeholder = `自動 ${f.autoLong}`;
    q('#slShortMinLabel').textContent = String(state.settings.shortMin);
    q('#slLongMinLabel').textContent = String(state.settings.longMin);
    container.querySelectorAll('[data-setting]').forEach((inp) => {
      inp.value = String(state.settings[inp.dataset.setting] ?? '');
    });
  }

  function renderFunnelBar() {
    const el = q('#slFunnelBar');
    if (!el) return;
    const f = funnelFromCalls(state.day || {}, state.calls, state.settings);
    const step = (label, n, rate, rateLabel) =>
      `<div class="slog-step"><span class="slog-step-n">${n}</span><span class="slog-step-l">${label}</span>${rate != null ? `<span class="slog-step-r">${rateLabel} ${fmtPct(rate)}</span>` : ''}</div>`;
    el.innerHTML =
      step('撥出', f.dialed, null) +
      step('接通', f.connected, f.connectRate, '接通率') +
      step(`>${f.shortMin} 分`, f.over, f.overRate, '接通中') +
      step(`長 Call ≥${f.longMin} 分`, f.long, f.longRate, `>${f.shortMin} 分中`) +
      step('進邀約', f.invites, f.inviteRate, `>${f.shortMin} 分中`);
  }

  let daySaveTimer = null;
  const persistDay = () => {
    clearTimeout(daySaveTimer);
    daySaveTimer = setTimeout(async () => {
      if (!state.day) return;
      try {
        state.day = await putDay(state.day);
        refreshMonth();
        refreshWeek();
      } catch (e) {
        showDbError(e);
      }
    }, 350);
  };

  container.querySelectorAll('[data-day]').forEach((inp) =>
    inp.addEventListener('input', () => {
      if (!state.day) return;
      const v = inp.value.trim();
      state.day[inp.dataset.day] = v === '' ? null : Math.max(0, Math.floor(Number(v)) || 0);
      renderFunnelBar();
      persistDay();
    })
  );

  container.querySelectorAll('[data-setting]').forEach((inp) =>
    inp.addEventListener('change', async () => {
      const v = Math.max(1, Math.floor(Number(inp.value)) || 1);
      state.settings = { ...state.settings, [inp.dataset.setting]: v };
      try {
        state.settings = await saveSettings({ [inp.dataset.setting]: v });
      } catch {
        /* keep in-memory */
      }
      renderFunnelInputs();
      renderFunnelBar();
      refreshWeek();
    })
  );

  /* ---------------- 錄音清單 ---------------- */

  function callStatus(c) {
    if (c.symptoms?.keys) return { text: `已分析 · ${c.symptoms.keys.length} 症狀`, cls: 'ok' };
    if (c.transcript?.length) return { text: `已轉錄（${c.transcribedWith || ''}）`, cls: 'busy' };
    return { text: '未轉錄', cls: '' };
  }

  function renderCalls() {
    q('#slCallCount').textContent = state.calls.length ? `${state.calls.length} 通` : '';
    if (!state.calls.length) {
      listEl.innerHTML = '<li class="slog-empty">這天還沒有錄音。按「匯入錄音檔」或把檔案拖到上面。</li>';
    } else {
      listEl.innerHTML = state.calls
        .map((c) => {
          const st = callStatus(c);
          const checked = state.selection.has(c.id) ? 'checked' : '';
          const playing = state.playingId === c.id;
          const top = c.symptoms?.keys?.slice(0, 3).map((k) => `<span class="slog-tag">${escapeHTML(SYMPTOM_DEFS[k]?.label || k)}</span>`).join('') || '';
          return `<li class="slog-item ${playing ? 'playing' : ''}" data-id="${c.id}">
            <label class="slog-item-check"><input type="checkbox" data-select="${c.id}" ${checked}></label>
            <button type="button" class="slog-item-name" data-play="${c.id}" title="點擊播放／暫停">
              <span class="slog-item-time">${escapeHTML(c.startTime || '--:--')}</span>
              <span class="slog-item-file">${playing ? '▮▮ ' : '▶ '}${escapeHTML(c.name)}</span>
              <span class="slog-item-dur">${c.durationSec ? formatDuration(c.durationSec) : ''}${c.size ? ` · ${describeSize(c.size)}` : ''}</span>
            </button>
            <span class="slog-item-status ${st.cls}">${st.text}</span>
            <span class="slog-item-tags">${top}</span>
            <span class="slog-item-actions">
              ${c.transcript?.length ? `<button type="button" class="btn slog-mini" data-open="${c.id}" title="載入逐字稿並跑完整分析">完整分析</button>` : ''}
              ${c.hasAudio === false ? '' : `<button type="button" class="btn slog-mini" data-del-audio="${c.id}" title="只刪錄音，保留逐字稿與分析">刪錄音</button>`}
              <button type="button" class="btn slog-mini danger" data-del="${c.id}" title="整筆刪除">刪除</button>
            </span>
            <div class="slog-player" data-player="${c.id}" ${playing ? '' : 'hidden'}></div>
          </li>`;
        })
        .join('');
      if (state.playingId && state.playingUrl) mountPlayer(state.playingId, state.playingUrl);
    }
    refreshBatchButton();
  }

  function mountPlayer(id, url) {
    const slot = listEl.querySelector(`[data-player="${id}"]`);
    if (!slot) return;
    slot.hidden = false;
    slot.innerHTML = '';
    const a = document.createElement('audio');
    a.controls = true;
    a.autoplay = true;
    a.src = url;
    a.addEventListener('ended', () => {
      const item = slot.closest('.slog-item');
      item?.classList.remove('playing');
    });
    slot.appendChild(a);
  }

  function stopPlayback() {
    if (state.playingUrl) {
      try {
        URL.revokeObjectURL(state.playingUrl);
      } catch {
        /* ignore */
      }
    }
    state.playingUrl = null;
    state.playingId = null;
  }

  async function togglePlay(id) {
    if (state.playingId === id) {
      stopPlayback();
      renderCalls();
      return;
    }
    stopPlayback();
    let blob = null;
    try {
      blob = await getAudio(id);
    } catch (e) {
      showDbError(e);
    }
    if (!blob) {
      toast('這通的錄音已刪除，只剩逐字稿');
      return;
    }
    state.playingId = id;
    state.playingUrl = URL.createObjectURL(blob);
    renderCalls();
  }

  listEl.addEventListener('click', async (e) => {
    const play = e.target.closest('[data-play]');
    if (play) return togglePlay(play.dataset.play);
    const open = e.target.closest('[data-open]');
    if (open) {
      const c = state.calls.find((x) => x.id === open.dataset.open);
      if (c?.transcript?.length) onOpenCall?.(c.transcript.map((s) => ({ ...s })), c.name.replace(/\.[a-z0-9]+$/i, '') + '.srt');
      return;
    }
    const delAudio = e.target.closest('[data-del-audio]');
    if (delAudio) {
      const c = state.calls.find((x) => x.id === delAudio.dataset.delAudio);
      if (!c) return;
      if (!c.transcript?.length && !confirm(`「${c.name}」還沒轉錄，刪除錄音後就無法分析。確定刪除？`)) return;
      try {
        await deleteAudio(c.id);
        c.hasAudio = false;
        await putCall(c);
        if (state.playingId === c.id) stopPlayback();
        renderCalls();
        refreshStorage();
        toast('已刪除錄音，逐字稿與分析保留');
      } catch (err) {
        showDbError(err);
      }
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const c = state.calls.find((x) => x.id === del.dataset.del);
      if (!c || !confirm(`確定整筆刪除「${c.name}」（錄音＋逐字稿＋分析）？`)) return;
      try {
        await deleteCall(c.id);
        if (state.playingId === c.id) stopPlayback();
        state.selection.delete(c.id);
        state.calls = state.calls.filter((x) => x.id !== c.id);
        renderCalls();
        renderFunnelInputs();
        renderFunnelBar();
        renderAggregate();
        refreshMonth();
        refreshWeek();
        refreshStorage();
      } catch (err) {
        showDbError(err);
      }
    }
  });

  listEl.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-select]');
    if (!cb) return;
    if (cb.checked) state.selection.add(cb.dataset.select);
    else state.selection.delete(cb.dataset.select);
    refreshBatchButton();
  });

  q('#slSelectAll').addEventListener('click', () => {
    state.calls.forEach((c) => state.selection.add(c.id));
    renderCalls();
  });
  q('#slSelectNone').addEventListener('click', () => {
    state.selection.clear();
    renderCalls();
  });

  /* ---------------- 匯入 ---------------- */

  async function importFiles(files) {
    if (!state.selected) {
      toast('請先在日曆點選一天');
      return;
    }
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    const perDate = new Map();
    let skipped = 0;
    let dup = 0;
    for (const f of list) {
      const problem = validateAudioFile(f);
      if (problem) {
        skipped += 1;
        toast(`${f.name}：${problem}`);
        continue;
      }
      const parsed = parseDateFromFilename(f.name, f.lastModified);
      const date = parsed.source === 'filename' ? parsed.date : state.selected;
      const startTime = parsed.time || '';
      let existing = [];
      try {
        existing = date === state.selected ? state.calls : await listCalls(date);
      } catch {
        existing = [];
      }
      if (existing.some((c) => c.name === f.name && c.size === f.size)) {
        dup += 1;
        continue;
      }
      const id = newId();
      const durationSec = await probeDuration(f);
      const call = {
        id,
        date,
        name: f.name,
        size: f.size,
        type: f.type || guessAudioMime(f),
        durationSec,
        startTime,
        dateSource: parsed.source || 'selected',
        addedAt: Date.now(),
        hasAudio: true,
        transcript: null,
        transcribedWith: '',
        symptoms: null,
      };
      try {
        await putAudio(id, f);
        await putCall(call);
      } catch (e) {
        showDbError(e);
        toast(`${f.name} 存不進本機資料庫：${e.message}`);
        continue;
      }
      perDate.set(date, (perDate.get(date) || 0) + 1);
      if (date === state.selected) state.calls.push(call);
    }
    state.calls = await listCalls(state.selected).catch(() => state.calls);
    renderCalls();
    renderFunnelInputs();
    renderFunnelBar();
    refreshMonth();
    refreshWeek();
    refreshStorage();
    const parts = [...perDate.entries()].map(([d, n]) => `${n} 通 → ${fmtDateLabel(d)}`);
    const msg = [parts.length ? `已匯入 ${parts.join('、')}` : '', dup ? `${dup} 個重複略過` : '', skipped ? `${skipped} 個不支援` : '']
      .filter(Boolean)
      .join('；');
    if (msg) toast(msg);
    const elsewhere = [...perDate.keys()].filter((d) => d !== state.selected);
    if (elsewhere.length) toast(`有錄音依檔名歸到 ${elsewhere.map(fmtDateLabel).join('、')}，點日曆可查看`);
  }

  q('#slImport').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    importFiles(e.target.files);
    e.target.value = '';
  });
  const dropEl = q('#slDrop');
  ['dragenter', 'dragover'].forEach((ev) =>
    dropEl.addEventListener(ev, (e) => {
      e.preventDefault();
      dropEl.classList.add('over');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropEl.addEventListener(ev, (e) => {
      e.preventDefault();
      dropEl.classList.remove('over');
    })
  );
  dropEl.addEventListener('drop', (e) => importFiles(e.dataTransfer?.files));
  dropEl.addEventListener('click', () => fileInput.click());

  /* ---------------- 引擎／批次分析 ---------------- */

  const currentEngine = () => container.querySelector('input[name="slEngine"]:checked')?.value || 'gemini';

  function renderEngine() {
    const eng = state.settings.engine === 'worker' ? 'worker' : 'gemini';
    container.querySelectorAll('input[name="slEngine"]').forEach((r) => {
      r.checked = r.value === eng;
    });
    container.querySelectorAll('.dev-audio-engine').forEach((l) => l.classList.toggle('active', l.dataset.engine === eng));
    q('#slGeminiPane').hidden = eng !== 'gemini';
    const wp = q('#slWorkerPane');
    wp.hidden = eng !== 'worker';
    if (eng === 'worker') {
      const ws = loadWorkerSettings();
      wp.textContent = ws.url && ws.token ? `將使用 Worker：${ws.url}` : '尚未設定 Worker 網址／Token——請先到「開發 · 電訪」的錄音上傳面板或 DEMO 模式填好並測試連線。';
    }
    q('#slConsentTarget').textContent = eng === 'worker' ? '我自己指定的遠端主機（新竹 Worker）' : 'Google Gemini';
    refreshBatchButton();
  }

  container.querySelectorAll('input[name="slEngine"]').forEach((r) =>
    r.addEventListener('change', async () => {
      state.settings = { ...state.settings, engine: currentEngine() };
      renderEngine();
      try {
        await saveSettings({ engine: state.settings.engine });
      } catch {
        /* ignore */
      }
    })
  );

  const keyProblem = () => {
    const v = keyEl.value.trim();
    return v ? describeApiKeyProblem(v) : '';
  };
  const renderKeyHint = () => {
    const p = keyProblem();
    keyHintEl.textContent = p;
    keyHintEl.classList.toggle('hidden', !p);
  };
  keyEl.addEventListener('input', () => {
    setApiKey?.(keyEl.value.trim());
    renderKeyHint();
    refreshBatchButton();
    refreshDiagnoseButton();
  });
  consentEl.addEventListener('change', refreshBatchButton);

  function needsTranscription() {
    return state.calls.filter((c) => state.selection.has(c.id) && !c.transcript?.length);
  }

  function refreshBatchButton() {
    const n = state.selection.size;
    const pending = needsTranscription().length;
    batchBtn.textContent = n ? `批次分析所選 ${n} 通${pending ? `（${pending} 通需轉錄）` : ''}` : '批次分析所選';
    let reason = '';
    if (state.busy) reason = '分析中…';
    else if (!n) reason = '請先勾選錄音';
    else if (pending) {
      const eng = currentEngine();
      if (eng === 'gemini') {
        if (!keyEl.value.trim()) reason = '請貼上 Gemini API Key';
        else if (keyProblem()) reason = keyProblem();
      } else {
        const ws = loadWorkerSettings();
        if (!ws.url || !ws.token) reason = '請先設定 Worker 網址與 Token';
      }
      if (!reason && !consentEl.checked) reason = '請勾選知情同意';
    }
    batchBtn.disabled = !!reason;
    if (reason) batchBtn.title = reason;
    else batchBtn.removeAttribute('title');
    q('#slImport').disabled = state.busy;
  }

  async function transcribeCall(call, onProgress) {
    const blob = await getAudio(call.id);
    if (!blob) throw new Error('錄音已刪除，無法轉錄');
    const file = blob instanceof File ? blob : new File([blob], call.name, { type: call.type || blob.type || 'application/octet-stream' });
    if (currentEngine() === 'worker') {
      const ws = loadWorkerSettings();
      const srt = await transcribeViaWorker({
        url: ws.url,
        token: ws.token,
        file,
        onProgress,
        registerAbort: (fn) => {
          state.workerAbort = fn;
        },
      });
      if (state.abort?.signal.aborted) throw Object.assign(new Error('已取消'), { name: 'AbortError' });
      return { segs: srtToSegments(srt), with: 'Worker' };
    }
    const apiKey = keyEl.value.trim();
    const r = await transcribeAudioWithGemini({
      apiKey,
      model: getModel?.(),
      file,
      signal: state.abort?.signal,
      onProgress,
      onRetry: ({ attempt, maxAttempts, delayMs }) => onProgress(`Google 忙碌，${Math.round(delayMs / 1000)} 秒後重試（${attempt}/${maxAttempts}）…`),
      onModelSwitch: (next, prev) => toast(`${prev} 忙碌，改試 ${next}…`),
    });
    onGeminiUsed?.(r.usedTokens);
    const segs = r.segs.map((s) => ({ ...s }));
    if (labeledRatio(segs) < 0.5) autoGuess(segs);
    return { segs, with: `Gemini ${r.modelUsed}`, truncated: r.truncated };
  }

  function analyzeCall(call) {
    const segs = enrichSegments(call.transcript.map((s) => ({ ...s })));
    const result = runAnalysis(segs);
    call.symptoms = extractSymptoms(result, segs);
    call.analyzedAt = Date.now();
    call.summary = {
      custRatio: result.stats.custRatio,
      deepest: result.deepest,
      trustStatus: result.trust?.status || null,
      totalDur: result.stats.totalDur,
    };
    if (!call.durationSec && result.stats.totalDur) call.durationSec = Math.round(result.stats.totalDur);
  }

  batchBtn.addEventListener('click', async () => {
    if (state.busy || !state.selection.size) return;
    const targets = state.calls.filter((c) => state.selection.has(c.id));
    const pending = needsTranscription();
    if (pending.length && !consentEl.checked) return refreshBatchButton();
    state.busy = true;
    state.abort = new AbortController();
    cancelBtn.classList.remove('hidden');
    refreshBatchButton();
    let done = 0;
    let failed = 0;
    try {
      for (let i = 0; i < targets.length; i++) {
        if (state.abort.signal.aborted) break;
        const c = targets[i];
        const prefix = `第 ${i + 1}/${targets.length} 通「${c.name}」：`;
        try {
          if (!c.transcript?.length) {
            const r = await transcribeCall(c, (msg) => setStatus(statusEl, `${prefix}${msg}`));
            c.transcript = plainSegs(r.segs);
            c.transcribedWith = r.with;
            if (r.truncated) toast(`${c.name} 錄音較長，轉錄輸出被截斷，只取得前段`);
          }
          setStatus(statusEl, `${prefix}規則分析中…`);
          analyzeCall(c);
          c.hasAudio = c.hasAudio !== false;
          await putCall(c);
          done += 1;
          renderCalls();
        } catch (e) {
          if (e?.name === 'AbortError' || state.abort.signal.aborted) break;
          failed += 1;
          toast(`${c.name}：${e.message || '失敗'}`);
        }
      }
      const cancelled = state.abort.signal.aborted;
      setStatus(statusEl, cancelled ? `已取消（完成 ${done} 通）` : `完成 ${done} 通${failed ? `，${failed} 通失敗` : ''}`, cancelled || failed ? 'err' : 'ok');
    } finally {
      state.busy = false;
      state.abort = null;
      state.workerAbort = null;
      consentEl.checked = false;
      cancelBtn.classList.add('hidden');
      refreshBatchButton();
      renderCalls();
      renderFunnelInputs();
      renderFunnelBar();
      renderAggregate();
      refreshMonth();
      refreshWeek();
      refreshStreaks();
    }
  });

  cancelBtn.addEventListener('click', () => {
    state.abort?.abort();
    state.workerAbort?.();
  });

  /* ---------------- 共同病症 ---------------- */

  async function refreshStreaks() {
    if (!state.selected) return;
    try {
      const summary = await summarizeRange(shiftDateKey(state.selected, -30), state.selected);
      state.streakHistory = Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, v.symptoms || []]));
    } catch {
      state.streakHistory = {};
    }
    renderAggregate();
  }

  function currentAggregate() {
    return aggregateSymptoms(state.calls);
  }

  function renderAggregate() {
    const agg = currentAggregate();
    q('#slAggCount').textContent = agg.total ? `已分析 ${agg.total}/${state.calls.length} 通` : '';
    const mEl = q('#slMetrics');
    const sEl = q('#slSymptoms');
    if (!agg.total) {
      mEl.innerHTML = '';
      sEl.innerHTML = '<p class="hint">勾選錄音後按「批次分析所選」，這裡會列出跨通共同出現的病症與原話證據。</p>';
      renderDiagnosis();
      refreshDiagnoseButton();
      return;
    }
    const m = agg.metrics;
    const chip = (label, value, hint = '') => `<div class="slog-chip"><span class="slog-chip-v">${value}</span><span class="slog-chip-l">${label}</span>${hint ? `<span class="slog-chip-h">${hint}</span>` : ''}</div>`;
    const min = (v) => (v == null ? '—' : `${Math.round(v * 10) / 10} 分`);
    mEl.innerHTML =
      chip('客戶說話比例', fmtPct(m.avgCustRatio), '目標 ≥ 45%') +
      chip('客戶第一次說出困擾', min(m.avgFirstTroubleMin), `${m.troubleReached}/${agg.total} 通有挖到`) +
      chip('第一次提方案', min(m.avgFirstPitchMin), '要晚於困擾') +
      chip('業務問句', m.avgQuestions == null ? '—' : `${Math.round(m.avgQuestions * 10) / 10} 句`, '目標 ≥ 3 再提方案') +
      chip('五層平均', m.avgDeepest == null ? '—' : `L${Math.round(m.avgDeepest * 10) / 10}`, '目標到 L5 或足以判斷');
    if (!agg.symptoms.length) {
      sEl.innerHTML = '<p class="hint">這幾通沒有偵測到共同病症。</p>';
    } else {
      sEl.innerHTML = agg.symptoms
        .map((s) => {
          const streak = symptomStreak(state.streakHistory, s.key, state.selected);
          const common = agg.total >= 2 && s.ratio >= 0.5;
          const ev = s.evidence
            .map((e) => `<span class="ev">[${formatDuration(e.start)}] ${escapeHTML(e.text)}<em>${escapeHTML(e.call)}</em></span>`)
            .join('');
          return `<div class="slog-sym ${common ? 'common' : ''}">
            <div class="slog-sym-head">
              <span class="slog-sym-group">${escapeHTML(s.group)}</span>
              <strong>${escapeHTML(s.label)}</strong>
              <span class="slog-sym-count">${s.count}/${agg.total} 通</span>
              ${streak >= 2 ? `<span class="slog-sym-streak">連續第 ${streak} 天</span>` : ''}
            </div>
            <div class="slog-sym-bar"><div style="width:${Math.round(s.ratio * 100)}%"></div></div>
            <div class="hint">${escapeHTML(s.hint)}</div>
            ${ev ? `<div class="slog-sym-ev">${ev}</div>` : ''}
          </div>`;
        })
        .join('');
    }
    renderDiagnosis();
    refreshDiagnoseButton();
  }

  function refreshDiagnoseButton() {
    const agg = currentAggregate();
    let reason = '';
    if (state.aiBusy) reason = '診斷中…';
    else if (!agg.total) reason = '請先批次分析至少一通';
    else if (!keyEl.value.trim()) reason = '請貼上 Gemini API Key';
    else if (keyProblem()) reason = keyProblem();
    else if (!aiConsentEl.checked) reason = '請勾選知情同意';
    diagnoseBtn.disabled = !!reason;
    if (reason) diagnoseBtn.title = reason;
    else diagnoseBtn.removeAttribute('title');
  }
  aiConsentEl.addEventListener('change', refreshDiagnoseButton);

  function renderDiagnosis() {
    const d = state.day?.diagnosis;
    if (!d) {
      diagnosisEl.innerHTML = '';
      return;
    }
    const at = d.at ? new Date(d.at) : null;
    diagnosisEl.innerHTML = `
      <div class="slog-diag-meta hint">AI 診斷（${escapeHTML(d.model || '')}${at ? ` · ${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}` : ''} · 依 ${d.total} 通）</div>
      ${d.pattern ? `<p class="slog-diag-pattern">${escapeHTML(d.pattern)}</p>` : ''}
      <ol class="slog-diag-list">
        ${(d.core_symptoms || [])
          .map(
            (c) => `<li><strong>${escapeHTML(c.name)}</strong><div>${escapeHTML(c.why)}</div>${c.evidence ? `<div class="slog-diag-ev">證據：${escapeHTML(c.evidence)}</div>` : ''}${c.tomorrow_action ? `<div class="slog-diag-act">明天：${escapeHTML(c.tomorrow_action)}</div>` : ''}</li>`
          )
          .join('')}
      </ol>
      ${d.one_thing ? `<div class="slog-diag-one"><span>只改一件事</span>${escapeHTML(d.one_thing)} <button type="button" class="btn slog-mini" id="slUseOneThing">帶入筆記</button></div>` : ''}
    `;
    diagnosisEl.querySelector('#slUseOneThing')?.addEventListener('click', () => {
      const inp = q('[data-note="action"]');
      if (inp && state.day) {
        inp.value = d.one_thing;
        state.day.note = { ...(state.day.note || {}), action: d.one_thing };
        persistNote();
      }
    });
  }

  diagnoseBtn.addEventListener('click', async () => {
    const agg = currentAggregate();
    if (!agg.total || !aiConsentEl.checked || state.aiBusy) return;
    const apiKey = keyEl.value.trim();
    if (!apiKey) return refreshDiagnoseButton();
    state.aiBusy = true;
    refreshDiagnoseButton();
    setStatus(aiStatusEl, 'Gemini 診斷中…');
    try {
      const recentNotes = [];
      for (let i = 1; i <= 3; i++) {
        const k = shiftDateKey(state.selected, -i);
        const d = await getDay(k).catch(() => null);
        if (d?.note?.action || d?.note?.free) recentNotes.push({ date: k, action: d.note.action, free: d.note.free });
      }
      const funnel = funnelFromCalls(state.day || {}, state.calls, state.settings);
      const prompt = buildDiagnosisPrompt(agg, { funnel, date: state.selected, recentNotes });
      let model = getModel?.();
      const { parsed, usedTokens, modelUsed } = await callGeminiResilient({
        apiKey,
        model,
        text: prompt,
        parse: (raw) => parseDiagnosis(raw),
        onRetry: ({ attempt, maxAttempts, delayMs, status }) => setStatus(aiStatusEl, `Google 回報 ${status}，${Math.round(delayMs / 1000)} 秒後重試（${attempt}/${maxAttempts}）…`),
        onModelSwitch: (next, prev) => toast(`${prev} 忙碌，改試 ${next}…`),
      });
      if (modelUsed) model = modelUsed;
      onGeminiUsed?.(usedTokens);
      state.day.diagnosis = { ...parsed, model, at: Date.now(), total: agg.total };
      state.day = await putDay(state.day);
      renderDiagnosis();
      setStatus(aiStatusEl, '診斷完成', 'ok');
      refreshMonth();
    } catch (e) {
      setStatus(aiStatusEl, e.message || '診斷失敗', 'err');
      toast(e.message || 'AI 診斷失敗');
    } finally {
      state.aiBusy = false;
      aiConsentEl.checked = false;
      refreshDiagnoseButton();
    }
  });

  /* ---------------- 筆記 ---------------- */

  let noteTimer = null;
  const persistNote = () => {
    clearTimeout(noteTimer);
    noteTimer = setTimeout(async () => {
      if (!state.day) return;
      try {
        state.day = await putDay(state.day);
        q('#slNoteSaved').textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
        refreshMonth();
      } catch (e) {
        showDbError(e);
      }
    }, 400);
  };

  function renderNotes() {
    const n = state.day?.note || {};
    container.querySelectorAll('[data-note]').forEach((el) => {
      el.value = n[el.dataset.note] || '';
    });
    q('#slNoteSaved').textContent = '';
    const y = state.yesterdayNote;
    const yEl = q('#slYesterday');
    if (y?.action) {
      yEl.innerHTML = `昨天你說要改的動作：<strong>${escapeHTML(y.action)}</strong>${y.verify ? `（驗證：${escapeHTML(y.verify)}）` : ''}——今天的錄音有做到嗎？`;
      yEl.hidden = false;
    } else {
      yEl.hidden = true;
      yEl.innerHTML = '';
    }
  }

  container.querySelectorAll('[data-note]').forEach((el) =>
    el.addEventListener('input', () => {
      if (!state.day) return;
      state.day.note = { ...(state.day.note || {}), [el.dataset.note]: el.value };
      persistNote();
    })
  );

  /* ---------------- 啟動 ---------------- */

  async function activate() {
    if (state.activated) {
      refreshMonth();
      refreshWeek();
      return;
    }
    state.activated = true;
    try {
      state.settings = await getSettings();
    } catch (e) {
      showDbError(e);
    }
    keyEl.value = getApiKey?.() || '';
    renderKeyHint();
    renderEngine();
    await refreshMonth();
    await refreshWeek();
    await selectDay(today);
  }

  return {
    activate,
    syncApiKey(value) {
      if (keyEl.value !== value) keyEl.value = value || '';
      renderKeyHint();
      refreshBatchButton();
      refreshDiagnoseButton();
    },
  };
}
