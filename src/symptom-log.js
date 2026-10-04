/**
 * 開發症狀紀錄（純瀏覽器版）
 *   日曆 → 點一天 → 填漏斗（撥出／接通／>N 分／長 Call／進邀約＝客戶同意時間）→ 匯入公司電話系統的 wav
 *   → 點檔名直接播放、全選 → 批次分析（先轉錄再跑規則分析）→ 共同病症 → AI 診斷 → 改善筆記。
 * 錄音與逐字稿都存在這台電腦的 IndexedDB；只有轉錄／AI 診斷會把資料送到你選的引擎。
 */
import { renderMonthPaceHtml } from './coach-philosophy.js';
import {
  MONTHLY_REVIEW_FIELDS,
  buildMonthlyStatsHint,
  computeMonthlyStats,
  getMonthlyReviewFromSettings,
  monthlyReviewFilled,
  patchMonthlyReviews,
  q4Label,
  reviewMonthKey,
} from './monthly-review.js';
import {
  ADJUSTMENT_CHECKPOINTS,
  MANAGER_ANALYSIS_FIELDS,
  PLAN_CHECKPOINTS,
  PLAN_METRICS,
  checkpointDateKey,
  checkpointDue,
  computeCheckpointActuals,
  evaluateCheckpoint,
  getMonthlyPlanFromSettings,
  managerDiscussionReadiness,
  patchMonthlyPlans,
  targetSequenceWarnings,
} from './monthly-plan.js';
import { isAiAnalysisUnlocked, summarizeDayJournalForPrompt, unlockStatusMessage } from './reflection-journal.js';
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
  classifyCallDuration,
  funnelFromCalls,
  ICEBREAK_SYMPTOM_KEYS,
  inviteTone,
  isShortCall,
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
  listCallsBetween,
  listDays,
  newId,
  putAudio,
  putCall,
  putDay,
  saveSettings,
  storageEstimate,
  summarizeRange,
} from './symptom-store.js';
import {
  APPS_SCRIPT_TEMPLATE,
  FOLLOW_THROUGH_OPTIONS,
  a1ToCol,
  buildSheetModel,
  fetchSheetModel,
  markIsOn,
  planDayWrites,
  writeSheetCells,
} from './sheet-sync.js';
import { mountTimelinePlayer } from './call-timeline-player.js';
import { mountMarkerMindmap } from './marker-mindmap.js';
import { buildDirectivesPromptAddendum } from './coach-directives.js';
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

function startKey(settings) {
  return parseDateKey(settings?.startDate) ? settings.startDate : '';
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
    playerCtrl: null,
    mindmap: null,
    activated: false,
    dbError: '',
    sheet: { rows: null, model: null, loadedAt: 0, error: '', busy: false, writing: false, flash: false },
    callFilter: 'all',
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
          <div id="slMonthPace"></div>
          <p class="hint slog-legend"><span class="slog-dot calls"></span>有錄音 <span class="slog-dot analyzed"></span>已分析 <span class="slog-dot note"></span>有筆記 <span class="slog-dot self"></span>自評病症 ・ <span class="slog-swatch good"></span>同意時間 ≥ 2 <span class="slog-swatch zero"></span>有 &gt;N 分通但同意 0 ・ 邀約率＝同意時間÷&gt;N 分通 ・ 點日期進入當天</p>
          <div class="hint" id="slStorage"></div>
          <div class="bridge-upload-status err hidden" id="slDbError"></div>
        </div>
        <div class="card slog-week">
          <h2>近 7 天</h2>
          <div id="slWeek" class="slog-week-list"></div>
        </div>
      </div>

      <details class="card slog-plan" id="slPlanCard" open>
        <summary>
          <div><span class="slog-plan-kicker">MONTHLY BATTLE PLAN</span><h2 id="slPlanTitle">本月作戰儀表板</h2></div>
          <span class="slog-count" id="slPlanBadge">設定目標</span>
        </summary>
        <p class="hint slog-plan-def">定義：<b>通次＝撥出</b> · <b>邀約＝客戶明確同意時間</b> · <b>Demo＝實際出席</b> · <b>承攬＝完成承攬</b>。目標填累計值；實際數字從每天漏斗自動加總。</p>
        <div id="slPlanProgress" class="slog-plan-progress"></div>
        <div id="slPlanTargets" class="slog-plan-targets"></div>
        <div id="slPlanWarnings" class="slog-plan-warnings"></div>
        <section class="slog-plan-adjust">
          <div class="slog-plan-subhead"><span>04</span><div><h3>如果進度落後了，怎麼調整？</h3><p class="hint">每個檢查點先寫好具體的「如果—那麼」，不要只寫更努力。</p></div></div>
          <div id="slPlanAdjustments" class="slog-plan-adjust-grid"></div>
        </section>
        <section class="slog-plan-manager">
          <div class="slog-plan-subhead"><span>05</span><div><h3>什麼時候該找主管討論？</h3><p class="hint">不是業績達標才能討論；先確認自己設定的行為量有落實，並帶著分析過程來。</p></div></div>
          <div id="slPlanReadiness" class="slog-plan-readiness"></div>
          <div id="slPlanAnalysis" class="slog-plan-analysis"></div>
        </section>
        <p class="hint" id="slPlanSaved"></p>
      </details>

      <details class="card slog-monthly-review" id="slMonthlyReviewCard">
        <summary><h2>每月總結</h2><span class="slog-count" id="slMonthlyReviewBadge">待填</span></summary>
        <p class="hint">對照當月日曆與 AI 診斷，<b>自己先寫</b>（主管复盘四问）。數據只輔助，不能代替你的思考。</p>
        <p class="hint slog-monthly-stats" id="slMonthlyStatsHint"></p>
        <div id="slMonthlyReviewFields" class="slog-monthly-fields"></div>
        <p class="hint" id="slMonthlySaved"></p>
      </details>

      <details class="card slog-sheet" id="slSheetCard">
        <summary><h2>Google 試算表同步 <span class="slog-count" id="slSheetState"></span></h2></summary>
        <p class="hint">你的病症試算表：第 1 列是病症名稱、A 欄是日期、格子填「有」。這裡會把它讀進來當「自評病症」，勾選會寫回同一格；漏斗數字與筆記可寫到右側新欄。</p>
        <label class="slog-sheet-field">試算表網址（共用設定：知道連結的使用者可檢視）
          <input type="text" id="slSheetUrl" class="bridge-token" placeholder="https://docs.google.com/spreadsheets/d/…/edit" autocomplete="off"></label>
        <div class="bridge-actions">
          <button type="button" class="btn" id="slSheetReload">重新讀取</button>
          <a class="btn slog-link" id="slSheetOpen" href="#" target="_blank" rel="noopener noreferrer">在 Google 開啟</a>
        </div>
        <div class="bridge-upload-status hidden" id="slSheetStatus"></div>
        <label class="slog-sheet-field">Apps Script 網頁應用程式網址（要「寫回」試算表才需要；空白＝唯讀）
          <input type="text" id="slScriptUrl" class="bridge-token" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off"></label>
        <label class="slog-sheet-field">Token（與 Apps Script 裡的 TOKEN 一樣）
          <input type="password" id="slScriptToken" class="bridge-token" placeholder="CHANGE_ME" autocomplete="off"></label>
        <div class="bridge-actions">
          <button type="button" class="btn" id="slTestWrite">測試寫入</button>
        </div>
        <div class="bridge-upload-status hidden" id="slScriptStatus"></div>
        <details class="slog-settings">
          <summary>怎麼取得 Apps Script 網址（一次設定，約 2 分鐘）</summary>
          <ol class="slog-steps">
            <li>開試算表 → 上方「擴充功能」→「Apps Script」</li>
            <li>把下面整段貼上取代原本內容，把 <code>CHANGE_ME</code> 改成你自己的一串字，存檔</li>
            <li>右上「部署」→「新增部署」→ 類型選「網頁應用程式」→ 執行身分「我」→ 存取權「所有人」→ 部署（第一次會要你授權）</li>
            <li>複製「網頁應用程式 URL」（<code>/exec</code> 結尾）貼到上面，Token 填同一串字，按「測試寫入」</li>
          </ol>
          <textarea class="slog-code" id="slScriptCode" readonly rows="10"></textarea>
          <div class="bridge-actions">
            <button type="button" class="btn" id="slCopyScript">複製程式碼</button>
          </div>
          <p class="hint">存取權選「所有人」只代表任何人可以「呼叫這支程式」，不是公開試算表；Token 不符會被程式擋下。只寫得到你部署時所在的那張試算表。</p>
        </details>
      </details>

      <div class="slog-day" id="slDay" hidden>
        <div class="card slog-funnel">
          <h2 id="slDayTitle"></h2>
          <div class="slog-funnel-grid">
            <label>撥出<input type="number" min="0" inputmode="numeric" data-day="dialed" placeholder="0"></label>
            <label>接通<input type="number" min="0" inputmode="numeric" data-day="connected" placeholder="0"></label>
            <label>超過 <span id="slShortMinLabel">5</span> 分<input type="number" min="0" inputmode="numeric" data-day="over5Manual" placeholder="自動"></label>
            <label>長 Call（≥<span id="slLongMinLabel">15</span> 分）<input type="number" min="0" inputmode="numeric" data-day="longManual" placeholder="自動"></label>
            <label>進邀約（客戶同意時間）<input type="number" min="0" inputmode="numeric" data-day="invites" placeholder="0" title="客戶明確同意某個諮詢／見面時間才計入，僅開口約不算"></label>
            <label>Demo 出席<input type="number" min="0" inputmode="numeric" data-day="demos" placeholder="0" title="實際出席 Demo 才計入"></label>
            <label>完成承攬<input type="number" min="0" inputmode="numeric" data-day="contracts" placeholder="0" title="完成承攬才計入"></label>
          </div>
          <p class="hint">留存率＝超過 N 分通 ÷ 接通（破冰留客）｜邀約率＝進邀約（客戶同意時間）÷ 超過 N 分通。Demo 與承攬會帶入本月作戰儀表板。</p>
          <div class="slog-funnel-bar" id="slFunnelBar"></div>
          <div class="slog-ice-stats" id="slIceStats"></div>
          <details class="slog-settings">
            <summary>門檻設定</summary>
            <label>「超過 N 分」的 N <input type="number" min="1" max="60" data-setting="shortMin"></label>
            <label>「長 Call」≥ 幾分 <input type="number" min="1" max="180" data-setting="longMin"></label>
            <label>入職日（日曆從這天開始） <input type="date" data-setting="startDate"></label>
            <span class="hint">留空的欄位會依匯入錄音的長度自動計算；手填會覆蓋自動值。入職日之前的日期不會顯示。</span>
          </details>
        </div>

        <div class="card slog-self" id="slSelfCard" hidden>
          <h2>自評病症 <span class="slog-count">來自試算表</span></h2>
          <div id="slSelfList" class="slog-self-list"></div>
          <div class="slog-self-status">
            <span class="slog-self-label">昨天說要改的動作，今天有做到嗎？</span>
            <div id="slFollow" class="slog-follow"></div>
          </div>
          <div class="bridge-actions">
            <button type="button" class="btn" id="slPushDay">把今天的漏斗＋筆記寫入試算表</button>
          </div>
          <div class="bridge-upload-status hidden" id="slSelfStatus"></div>
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
          <div class="slog-call-filters bridge-actions" id="slCallFilters">
            <span class="slog-filter-label">錄音篩選</span>
            <button type="button" class="btn slog-filter on" data-call-filter="all">全部</button>
            <button type="button" class="btn slog-filter" data-call-filter="short">短通 (&lt;3 分)</button>
            <button type="button" class="btn slog-filter" data-call-filter="no-retention">未留存 (&lt;N 分)</button>
            <button type="button" class="btn" id="slSelectShort">全選目前篩選</button>
          </div>
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

        <div class="card slog-mindmap">
          <h2>話點心智圖 <span class="slog-count">表層資訊 → 內心真意 → 證據</span></h2>
          <p class="hint">資料來自播放器的 <kbd>M</kbd> 標記。每個話點拆成「客戶字面上說的」和「他真正想傳達的」；真意是推論，<strong>沒有原句或行為證據就只是「我覺得」</strong>，不能寫進複盤。節點可拖曳，位置會記住；點時間可回放該段。</p>
          <div id="slMindmap"></div>
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
            <p class="hint" id="slDiagnoseHint">AI 診斷是第二意見：請先在「開發 · 電訪」完成今日三通自寫複盤，並寫好當天改善筆記。</p>
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
  const sheetUrlEl = q('#slSheetUrl');
  const scriptUrlEl = q('#slScriptUrl');
  const scriptTokenEl = q('#slScriptToken');
  const sheetStatusEl = q('#slSheetStatus');
  const selfCard = q('#slSelfCard');
  const selfListEl = q('#slSelfList');
  const followEl = q('#slFollow');
  const selfStatusEl = q('#slSelfStatus');

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
    const paceEl = q('#slMonthPace');
    if (paceEl) {
      const now = new Date();
      const ref =
        state.year === now.getFullYear() && state.month === now.getMonth() + 1
          ? now
          : new Date(state.year, state.month - 1, 15);
      paceEl.innerHTML = renderMonthPaceHtml(ref);
    }
    const start = startKey(state.settings);
    const prevBtn = q('.slog-nav[data-nav="-1"]');
    if (prevBtn) prevBtn.disabled = !!start && `${state.year}-${String(state.month).padStart(2, '0')}` <= start.slice(0, 7);
    gridEl.innerHTML = cells
      .map((c) => {
        if (start && c.key < start) {
          return `<span class="slog-cell before-start ${c.inMonth ? '' : 'out'}" aria-hidden="true"></span>`;
        }
        const s = state.monthSummary[c.key];
        const cls = ['slog-cell'];
        if (!c.inMonth) cls.push('out');
        if (start && c.key === start) cls.push('start');
        if (c.key === today) cls.push('today');
        if (c.key === state.selected) cls.push('selected');
        if (c.weekday === 0 || c.weekday === 6) cls.push('weekend');
        const tone = inviteTone(s);
        if (tone) cls.push(`invite-${tone}`);
        const selfN = selfMarkNames(c.key).length;
        const dots =
          (s
            ? `${s.calls ? `<span class="slog-dot calls" title="${s.calls} 通錄音"></span>` : ''}${s.analyzed ? '<span class="slog-dot analyzed" title="已分析"></span>' : ''}${s.hasNote ? '<span class="slog-dot note" title="有筆記"></span>' : ''}`
            : '') + (selfN ? `<span class="slog-dot self" title="自評 ${selfN} 項病症"></span>` : '');
        const n = s?.calls ? `<span class="slog-cell-n">${s.calls}</span>` : '';
        const inv = s?.invites != null && s.invites > 0 ? `<span class="slog-cell-inv" title="客戶同意時間 ${s.invites} 通">約 ${s.invites}</span>` : '';
        const startTag = start && c.key === start ? '<span class="slog-cell-start">入職</span>' : '';
        return `<button type="button" class="${cls.join(' ')}" data-date="${c.key}"><span class="slog-cell-d">${c.day}</span>${n}${inv}${startTag}<span class="slog-dots">${dots}</span></button>`;
      })
      .join('');
    refreshStorage();
    renderMonthlyReview();
    renderMonthlyPlan();
  }

  let monthlyReviewTimer = null;
  let monthlyPlanTimer = null;

  function readMonthlyPlanForm(base) {
    const next =
      typeof structuredClone === 'function'
        ? structuredClone(base)
        : JSON.parse(JSON.stringify(base));
    q('#slPlanTargets')?.querySelectorAll('[data-plan-target]').forEach((input) => {
      const [checkpoint, metric] = input.dataset.planTarget.split(':');
      next.targets[checkpoint][metric] = Math.max(0, Math.floor(Number(input.value) || 0));
    });
    q('#slPlanAdjustments')?.querySelectorAll('[data-plan-adjust]').forEach((input) => {
      next.adjustments[input.dataset.planAdjust] = input.value;
    });
    q('#slPlanAnalysis')?.querySelectorAll('[data-plan-analysis]').forEach((input) => {
      next.analysis[input.dataset.planAnalysis] = input.value;
    });
    return next;
  }

  function scheduleMonthlyPlanSave(plan) {
    clearTimeout(monthlyPlanTimer);
    monthlyPlanTimer = setTimeout(async () => {
      try {
        const next = readMonthlyPlanForm(plan);
        const bag = patchMonthlyPlans(state.settings, state.year, state.month, next);
        state.settings = await saveSettings({ monthlyPlans: bag });
        const saved = q('#slPlanSaved');
        if (saved) saved.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
        const badge = q('#slPlanBadge');
        const total = next.targets.end;
        if (badge) badge.textContent = PLAN_METRICS.every((metric) => total[metric.key] > 0) ? '月底目標已設定' : '尚未填完月底目標';
      } catch (error) {
        showDbError(error);
      }
    }, 400);
  }

  async function renderMonthlyPlan() {
    const title = q('#slPlanTitle');
    if (title) title.textContent = `${state.month} 月作戰儀表板`;
    const from = `${reviewMonthKey(state.year, state.month)}-01`;
    const last = new Date(state.year, state.month, 0).getDate();
    const to = `${reviewMonthKey(state.year, state.month)}-${String(last).padStart(2, '0')}`;
    let days = [];
    try {
      days = await listDays(from, to);
    } catch {
      days = [];
    }
    const plan = getMonthlyPlanFromSettings(state.settings, state.year, state.month);
    const actuals = computeCheckpointActuals(days, state.year, state.month);
    const evaluations = Object.fromEntries(
      PLAN_CHECKPOINTS.map((cp) => [cp.id, evaluateCheckpoint(plan.targets[cp.id], actuals[cp.id])])
    );
    const dueList = PLAN_CHECKPOINTS.filter((cp) => checkpointDue(state.year, state.month, cp, today));
    const focus = dueList.at(-1) || PLAN_CHECKPOINTS[0];
    const focusEval = evaluations[focus.id];
    const focusDue = checkpointDue(state.year, state.month, focus, today);

    const badge = q('#slPlanBadge');
    if (badge) {
      const total = plan.targets.end;
      badge.textContent = PLAN_METRICS.every((metric) => total[metric.key] > 0) ? '月底目標已設定' : '設定目標';
    }

    const progress = q('#slPlanProgress');
    if (progress) {
      const metricHtml = PLAN_METRICS.map((metric) => {
        const item = focusEval.metrics[metric.key];
        const cls = !focusDue || item.status === 'unset' ? '' : item.status;
        return `<span class="slog-plan-progress-metric ${cls}"><b>${escapeHTML(metric.short)}</b>${item.actual}<i>/ ${item.target || '—'}</i></span>`;
      }).join('');
      const focusDate = checkpointDateKey(state.year, state.month, focus);
      progress.innerHTML = `<div class="slog-plan-progress-head">
          <div><span>${focusDue ? '最近檢查點' : '下一檢查點'}</span><strong>${escapeHTML(fmtDateLabel(focusDate))}</strong></div>
          <span class="slog-plan-state ${focusDue ? focusEval.status : 'upcoming'}">${
            focusDue ? (focusEval.status === 'met' ? '行為進度達標' : focusEval.status === 'behind' ? '需要調整' : '請先設定目標') : '進行中'
          }</span>
        </div><div class="slog-plan-progress-metrics">${metricHtml}</div>`;
    }

    const targets = q('#slPlanTargets');
    if (targets) {
      targets.innerHTML = `
        <div class="slog-plan-table-head"><span>檢查點</span>${PLAN_METRICS.map((m) => `<span>${escapeHTML(m.label)}</span>`).join('')}</div>
        ${PLAN_CHECKPOINTS.map((cp) => {
          const due = checkpointDue(state.year, state.month, cp, today);
          const evaluation = evaluations[cp.id];
          return `<div class="slog-plan-target-row ${due ? evaluation.status : 'upcoming'}">
            <div class="slog-plan-cp"><strong>${state.month}/${cp.day === 'end' ? last : cp.day} 前</strong><span>${cp.id === 'end' ? '總計' : '累計'}</span></div>
            ${PLAN_METRICS.map((metric) => {
              const item = evaluation.metrics[metric.key];
              return `<label class="slog-plan-target ${due ? item.status : ''}">
                <span class="slog-plan-mobile-label">${escapeHTML(metric.label)}</span>
                <input type="number" min="0" inputmode="numeric" data-plan-target="${cp.id}:${metric.key}" value="${item.target || ''}" placeholder="目標">
                <small>實際 <b>${item.actual}</b>${due && item.target ? ` · ${item.status === 'met' ? '達標' : '差 ' + Math.max(0, item.target - item.actual)}` : ''}</small>
              </label>`;
            }).join('')}
          </div>`;
        }).join('')}`;
    }

    const warnings = targetSequenceWarnings(plan);
    const warningsEl = q('#slPlanWarnings');
    if (warningsEl) {
      warningsEl.innerHTML = warnings.length
        ? warnings.map((w) => `<p>⚠ ${escapeHTML(w)}</p>`).join('')
        : '';
    }

    const adjustments = q('#slPlanAdjustments');
    if (adjustments) {
      adjustments.innerHTML = ADJUSTMENT_CHECKPOINTS.map(
        (cp) => `<label><span>如果 ${state.month}/${cp.day} 前沒達標，我會：</span>
          <textarea class="field" rows="2" data-plan-adjust="${cp.id}" placeholder="例：回聽 3 通有聊到困擾卻沒邀約的電話，重寫價值橋接句，隔天每通練一次">${escapeHTML(plan.adjustments[cp.id])}</textarea>
        </label>`
      ).join('');
    }

    const readiness = managerDiscussionReadiness(plan, actuals, state.year, state.month, today);
    const readinessEl = q('#slPlanReadiness');
    if (readinessEl) {
      const cpLabel = readiness.checkpoint ? `${state.month}/${readiness.checkpoint.day === 'end' ? last : readiness.checkpoint.day}` : '首個檢查點';
      readinessEl.innerHTML = `
        <div class="slog-plan-condition ${readiness.behaviorReady ? 'ok' : ''}">
          <span>${readiness.behaviorReady ? '✓' : '1'}</span><div><strong>行為量要夠</strong><p>${readiness.checkpoint ? `以 ${cpLabel} 累計目標檢查 Demo／邀約／通次：${readiness.behaviorReady ? '已達到自己設定的量。' : '尚未全部達標，先確認是否真的落實動作量。'}` : '第一個檢查點尚未到期；先填好 Demo／邀約／通次目標。'}</p></div>
        </div>
        <div class="slog-plan-condition ${readiness.analysisReady ? 'ok' : ''}">
          <span>${readiness.analysisReady ? '✓' : '2'}</span><div><strong>真的努力分析過</strong><p>${readiness.analysisReady ? '四個分析問題都有具體紀錄。' : '請先具體寫下聽了什麼、做了什麼、看了什麼，以及推理路徑。'}</p></div>
        </div>
        <p class="slog-plan-ready ${readiness.ready ? 'ok' : ''}">${readiness.ready ? '已準備好：帶著數據與分析去找主管討論。' : '準備中：不是要獨自撐住，而是先帶著證據與假設來討論。'}</p>
        <p class="hint slog-plan-escalate">合規、客訴或重大承諾風險請立刻找主管，不必等行為量達標。</p>`;
    }

    const analysis = q('#slPlanAnalysis');
    if (analysis) {
      analysis.innerHTML = MANAGER_ANALYSIS_FIELDS.map(
        (field) => `<label><span>${escapeHTML(field.label)}</span>
          <textarea class="field" rows="2" data-plan-analysis="${field.key}" placeholder="${escapeHTML(field.placeholder)}">${escapeHTML(plan.analysis[field.key])}</textarea>
        </label>`
      ).join('');
    }

    q('#slPlanCard')?.querySelectorAll('[data-plan-target], [data-plan-adjust], [data-plan-analysis]').forEach((input) => {
      input.addEventListener('input', () => scheduleMonthlyPlanSave(plan));
    });
    q('#slPlanTargets')?.querySelectorAll('[data-plan-target]').forEach((input) => {
      input.addEventListener('change', () => {
        scheduleMonthlyPlanSave(plan);
        setTimeout(renderMonthlyPlan, 450);
      });
    });
  }

  function bindMonthlyReviewFields() {
    const fieldsHost = q('#slMonthlyReviewFields');
    if (!fieldsHost) return;
    const mk = reviewMonthKey(state.year, state.month);
    if (fieldsHost.dataset.monthKey === mk) return;
    fieldsHost.dataset.monthKey = mk;
    fieldsHost.innerHTML = MONTHLY_REVIEW_FIELDS.map((f) => {
      const label = f.key === 'q4' ? q4Label(state.year, state.month) : f.label;
      return `<label class="slog-monthly-q"><span class="slog-monthly-q-label">${escapeHTML(label)}</span>
        <textarea class="field" data-mr="${f.key}" rows="4" placeholder="${escapeHTML(f.placeholder)}"></textarea></label>`;
    }).join('');
    fieldsHost.querySelectorAll('[data-mr]').forEach((el) => {
      el.addEventListener('input', () => {
        if (!state.settings) return;
        const key = el.dataset.mr;
        const cur = getMonthlyReviewFromSettings(state.settings, state.year, state.month);
        clearTimeout(monthlyReviewTimer);
        monthlyReviewTimer = setTimeout(async () => {
          try {
            const bag = patchMonthlyReviews(state.settings, state.year, state.month, {
              ...cur,
              [key]: el.value,
            });
            state.settings = await saveSettings({ monthlyReviews: bag });
            const saved = q('#slMonthlySaved');
            if (saved) {
              saved.textContent = `已自動儲存 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
            }
            const badge = q('#slMonthlyReviewBadge');
            if (badge) {
              badge.textContent = monthlyReviewFilled(getMonthlyReviewFromSettings(state.settings, state.year, state.month))
                ? '已填'
                : '待填';
            }
          } catch (e) {
            showDbError(e);
          }
        }, 400);
      });
    });
  }

  async function renderMonthlyReview() {
    bindMonthlyReviewFields();
    const review = getMonthlyReviewFromSettings(state.settings, state.year, state.month);
    q('#slMonthlyReviewFields')?.querySelectorAll('[data-mr]').forEach((el) => {
      el.value = review[el.dataset.mr] || '';
    });
    const badge = q('#slMonthlyReviewBadge');
    if (badge) badge.textContent = monthlyReviewFilled(review) ? '已填' : '待填';
    const statsEl = q('#slMonthlyStatsHint');
    if (statsEl) {
      try {
        const stats = await computeMonthlyStats({
          year: state.year,
          month: state.month,
          summarizeRange,
          listDays,
          listCallsBetween,
        });
        const tops = stats.topSymptoms.map((k) => SYMPTOM_DEFS[k]?.label || k);
        statsEl.textContent = buildMonthlyStatsHint({ ...stats, topSymptoms: tops });
      } catch {
        statsEl.textContent = '';
      }
    }
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
    const hired = startKey(state.settings);
    for (let i = 6; i >= 0; i--) {
      const k = shiftDateKey(end, -i);
      if (hired && k < hired) continue;
      const s = summary[k];
      const d = dayMap[k];
      const f = d || s ? funnelFromCalls(d || {}, (s?.durations || []).map((sec) => ({ durationSec: sec })), state.settings) : null;
      const detected = s?.symptoms?.length
        ? s.symptoms
            .slice(0, 2)
            .map((key) => SYMPTOM_DEFS[key]?.label)
            .filter(Boolean)
            .join('、')
        : '';
      const self = selfMarkNames(k).slice(0, 2).join('、');
      const top = [detected, self ? `自評：${self}` : ''].filter(Boolean).join(' ・ ');
      const empty = !s && !d && !self;
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
      const start = startKey(state.settings);
      if (start && dateKey(d).slice(0, 7) < start.slice(0, 7)) return;
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
    const start = startKey(state.settings);
    if (start && key < start) {
      toast(`${fmtDateLabel(start)} 入職前的日期不在紀錄範圍`);
      return;
    }
    stopPlayback();
    state.selected = key;
    state.selection = new Set();
    state.sheet.flash = false;
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
    renderSelf();
    await Promise.all([refreshMonth(), refreshWeek(), refreshStreaks()]);
    if (state.sheet.model && Date.now() - state.sheet.loadedAt > 60000) loadSheet({ quiet: true });
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
      step(`>${f.shortMin} 分`, f.over, f.retentionRate ?? f.overRate, '留存率') +
      step(`長 Call ≥${f.longMin} 分`, f.long, f.longRate, `>${f.shortMin} 分中`) +
      step('同意時間', f.invites, f.inviteRate, '邀約率');
    renderIceStats(f);
  }

  function callsForFilter(list = state.calls) {
    if (state.callFilter === 'all') return list;
    return list.filter((c) => classifyCallDuration(c.durationSec, state.settings) === state.callFilter);
  }

  function renderIceStats(f) {
    const el = q('#slIceStats');
    if (!el) return;
    const shortN = state.calls.filter((c) => isShortCall(c.durationSec)).length;
    const noRetN = state.calls.filter((c) => classifyCallDuration(c.durationSec, state.settings) === 'no-retention').length;
    const okN = state.calls.filter((c) => classifyCallDuration(c.durationSec, state.settings) === 'ok').length;
    const unkN = state.calls.length - shortN - noRetN - okN;
    el.innerHTML = `<p class="hint slog-ice-line">本機錄音：<b>${shortN}</b> 通短通（&lt;3 分）· <b>${noRetN}</b> 通未留存（&lt;${state.settings.shortMin} 分）· <b>${okN}</b> 通已留存${unkN ? ` · ${unkN} 通時長未知（匯入後可自動讀取）` : ''}。破冰複盤請先篩「短通」批次分析。</p>`;
    if (f?.connected) {
      el.innerHTML += `<p class="hint">當日留存率 ${fmtPct(f.retentionRate ?? f.overRate)}（${f.over}/${f.connected} 接通聊滿 &gt;${f.shortMin} 分）</p>`;
    }
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
      const k = inp.dataset.setting;
      const v = k === 'startDate' ? (parseDateKey(inp.value) ? inp.value : '') : Math.max(1, Math.floor(Number(inp.value)) || 1);
      state.settings = { ...state.settings, [k]: v };
      try {
        state.settings = await saveSettings({ [k]: v });
      } catch {
        /* keep in-memory */
      }
      renderFunnelInputs();
      renderFunnelBar();
      if (k === 'startDate') {
        if (v && state.selected && state.selected < v) {
          await selectDay(v <= today ? today : v);
          return;
        }
        refreshMonth();
      }
      refreshWeek();
    })
  );

  /* ---------------- 錄音清單 ---------------- */

  function callStatus(c) {
    if (c.symptoms?.keys) return { text: `已分析 · ${c.symptoms.keys.length} 症狀`, cls: 'ok' };
    if (c.transcript?.length) return { text: `已轉錄（${c.transcribedWith || ''}）`, cls: 'busy' };
    return { text: '未轉錄', cls: '' };
  }

  function destroyPlayer() {
    state.playerCtrl?.destroy();
    state.playerCtrl = null;
  }

  function renderCalls() {
    destroyPlayer();
    const visible = callsForFilter();
    const total = state.calls.length;
    q('#slCallCount').textContent = total
      ? state.callFilter === 'all'
        ? `${total} 通`
        : `顯示 ${visible.length}/${total} 通`
      : '';
    container.querySelectorAll('[data-call-filter]').forEach((b) => b.classList.toggle('on', b.dataset.callFilter === state.callFilter));
    if (!total) {
      listEl.innerHTML = '<li class="slog-empty">這天還沒有錄音。按「匯入錄音檔」或把檔案拖到上面。</li>';
    } else if (!visible.length) {
      listEl.innerHTML = '<li class="slog-empty">此篩選沒有符合的錄音。試試「全部」或匯入更多 wav。</li>';
    } else {
      listEl.innerHTML = visible
        .map((c) => {
          const durCls = classifyCallDuration(c.durationSec, state.settings);
          const durTag =
            durCls === 'short'
              ? '<span class="slog-tag bad">短通</span>'
              : durCls === 'no-retention'
                ? '<span class="slog-tag warn">未留存</span>'
                : durCls === 'ok'
                  ? '<span class="slog-tag ok">已留存</span>'
                  : '';
          const st = callStatus(c);
          const checked = state.selection.has(c.id) ? 'checked' : '';
          const playing = state.playingId === c.id;
          const top = c.symptoms?.keys?.slice(0, 3).map((k) => `<span class="slog-tag">${escapeHTML(SYMPTOM_DEFS[k]?.label || k)}</span>`).join('') || '';
          const markerN = (c.devMarkers || []).length;
          const markerTag = markerN ? `<span class="slog-tag ctp-count" title="開發複盤話點">${markerN} 話點</span>` : '';
          return `<li class="slog-item ${playing ? 'playing' : ''}" data-id="${c.id}">
            <label class="slog-item-check"><input type="checkbox" data-select="${c.id}" ${checked}></label>
            <button type="button" class="slog-item-name" data-play="${c.id}" title="點擊播放／暫停">
              <span class="slog-item-time">${escapeHTML(c.startTime || '--:--')}</span>
              <span class="slog-item-file">${playing ? '▮▮ ' : '▶ '}${escapeHTML(c.name)}</span>
              <span class="slog-item-dur">${c.durationSec ? formatDuration(c.durationSec) : ''}${c.size ? ` · ${describeSize(c.size)}` : ''}</span>
            </button>
            <span class="slog-item-status ${st.cls}">${st.text}</span>
            <span class="slog-item-tags">${durTag}${markerTag}${top}</span>
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
    state.mindmap?.refresh();
  }

  /** 心智圖點時間 → 開啟（或沿用）那通的播放器並跳到該秒 */
  async function jumpToCall(callId, sec) {
    if (state.playingId !== callId) await togglePlay(callId);
    const audio = state.playerCtrl?.getAudio?.();
    if (!audio || state.playingId !== callId) return;
    const seek = () => {
      audio.currentTime = Math.max(0, Number(sec) || 0);
      audio.play?.()?.catch?.(() => {});
    };
    if (audio.readyState >= 1) seek();
    else audio.addEventListener('loadedmetadata', seek, { once: true });
    listEl.querySelector(`[data-player="${callId}"]`)?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  state.mindmap = mountMarkerMindmap(q('#slMindmap'), {
    getDay: () => ({ key: state.selected || '', label: state.selected ? fmtDateLabel(state.selected) : '當天' }),
    getCalls: () => state.calls,
    onJump: jumpToCall,
    onMarkerChange: async (callId, markers) => {
      const c = state.calls.find((x) => x.id === callId);
      if (!c) return;
      c.devMarkers = markers;
      if (state.playingId === callId) state.playerCtrl?.setMarkers?.(markers);
      try {
        await putCall(c);
      } catch (e) {
        showDbError(e);
      }
    },
    onPositionsChange: async (callId, positions) => {
      const c = state.calls.find((x) => x.id === callId);
      if (!c) return;
      c.mindmapPos = positions;
      try {
        await putCall(c);
      } catch (e) {
        showDbError(e);
      }
    },
  });

  function mountPlayer(id, url) {
    const slot = listEl.querySelector(`[data-player="${id}"]`);
    if (!slot) return;
    slot.hidden = false;
    const call = state.calls.find((x) => x.id === id);
    state.playerCtrl = mountTimelinePlayer(slot, {
      src: url,
      title: call?.name || '錄音',
      subtitle: [call?.startTime, call?.durationSec ? formatDuration(call.durationSec) : '']
        .filter(Boolean)
        .join(' · ') || '開發複盤',
      markers: call?.devMarkers,
      onChange: async (markers) => {
        const c = state.calls.find((x) => x.id === id);
        if (!c) return;
        c.devMarkers = markers;
        state.mindmap?.refresh();
        try {
          await putCall(c);
        } catch (e) {
          showDbError(e);
        }
      },
    });
    const audio = state.playerCtrl.getAudio();
    audio.autoplay = true;
    audio.addEventListener('ended', () => {
      slot.closest('.slog-item')?.classList.remove('playing');
    });
  }

  function stopPlayback() {
    destroyPlayer();
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
  container.querySelectorAll('[data-call-filter]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.callFilter = btn.dataset.callFilter || 'all';
      renderCalls();
      renderAggregate();
    })
  );
  q('#slSelectShort')?.addEventListener('click', () => {
    callsForFilter().forEach((c) => state.selection.add(c.id));
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
    const pool = state.callFilter === 'all' ? state.calls : callsForFilter();
    return aggregateSymptoms(pool);
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
      const iceMode = state.callFilter !== 'all';
      const sorted = [...agg.symptoms].sort((a, b) => {
        const ai = ICEBREAK_SYMPTOM_KEYS.indexOf(a.key);
        const bi = ICEBREAK_SYMPTOM_KEYS.indexOf(b.key);
        if (iceMode && ai >= 0 && bi >= 0) return ai - bi;
        if (iceMode && ai >= 0) return -1;
        if (iceMode && bi >= 0) return 1;
        return b.count - a.count;
      });
      sEl.innerHTML = sorted
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
    else if (!isAiAnalysisUnlocked()) reason = unlockStatusMessage().message;
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
      ${
        d.invite_zero_analysis
          ? `<section class="slog-invite-zero" aria-label="邀約數為零分析">
        <div class="slog-invite-zero-head"><span class="slog-invite-zero-kicker">邀約數 0</span><strong>為什麼邀不到人？</strong></div>
        ${d.invite_zero_analysis.reason ? `<p class="slog-invite-zero-reason">${escapeHTML(d.invite_zero_analysis.reason)}</p>` : ''}
        ${d.invite_zero_analysis.evidence ? `<p class="slog-invite-zero-evidence"><span>判斷依據</span>${escapeHTML(d.invite_zero_analysis.evidence)}</p>` : ''}
        ${
          d.invite_zero_analysis.better_script
            ? `<div class="slog-invite-zero-script"><span>可以怎麼說較好</span><blockquote>${escapeHTML(d.invite_zero_analysis.better_script)}</blockquote>
          ${d.invite_zero_analysis.why_better ? `<p>${escapeHTML(d.invite_zero_analysis.why_better)}</p>` : ''}</div>`
            : ''
        }
      </section>`
          : ''
      }
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
      const prompt = buildDiagnosisPrompt(agg, {
        funnel,
        date: state.selected,
        recentNotes,
        selfSymptoms: selfMarkNames(state.selected),
        followThrough: state.sheet.model?.days?.[state.selected]?.status || '',
        userJournal: summarizeDayJournalForPrompt(state.selected),
        directives: buildDirectivesPromptAddendum(),
      });
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
      const st = state.sheet.model?.days?.[state.selected]?.status;
      yEl.innerHTML = `昨天你說要改的動作：<strong>${escapeHTML(y.action)}</strong>${y.verify ? `（驗證：${escapeHTML(y.verify)}）` : ''}——${st ? `你在試算表填的是「${escapeHTML(st)}」` : '今天的錄音有做到嗎？'}`;
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

  /* ---------------- 試算表同步 ---------------- */

  function selfMarkNames(key) {
    const m = state.sheet.model;
    const day = m?.days?.[key];
    if (!m || !day) return [];
    return m.headers.filter((h) => markIsOn(day.marks[h.col])).map((h) => h.name);
  }

  function canWrite() {
    return !!(state.settings.scriptUrl || '').trim();
  }

  function renderSheetState() {
    const el = q('#slSheetState');
    const m = state.sheet.model;
    if (state.sheet.error) el.textContent = '讀取失敗';
    else if (!m) el.textContent = state.settings.sheetUrl ? '尚未讀取' : '未設定';
    else el.textContent = `${m.headers.length} 個病症 · ${Object.keys(m.days).length} 天${canWrite() ? ' · 可寫回' : ' · 唯讀'}`;
    const open = q('#slSheetOpen');
    if (open) open.href = state.settings.sheetUrl || '#';
  }

  async function loadSheet({ quiet = false } = {}) {
    const url = (state.settings.sheetUrl || '').trim();
    if (!url) {
      state.sheet.model = null;
      renderSheetState();
      renderSelf();
      return;
    }
    if (state.sheet.busy) return;
    state.sheet.busy = true;
    if (!quiet) setStatus(sheetStatusEl, '讀取試算表…');
    try {
      const { model, rows } = await fetchSheetModel({ sheetUrl: url });
      state.sheet.model = model;
      state.sheet.rows = rows;
      state.sheet.loadedAt = Date.now();
      state.sheet.error = '';
      if (!quiet) setStatus(sheetStatusEl, `已讀取：${model.headers.length} 個病症欄、${Object.keys(model.days).length} 天${model.statusCol >= 0 ? '、找到「有沒有做到」欄' : ''}`, 'ok');
    } catch (e) {
      state.sheet.error = e.message || '讀取失敗';
      if (!quiet) setStatus(sheetStatusEl, state.sheet.error, 'err');
    } finally {
      state.sheet.busy = false;
    }
    renderSheetState();
    renderSelf();
    refreshMonth();
    refreshWeek();
  }

  /** 寫入成功後先把本地的 rows 依 cells 改掉再重建模型，不用等 Google 的 CSV 快取更新 */
  function applyCellsLocally(cells) {
    const rows = state.sheet.rows || [[]];
    cells.forEach(({ a1, value }) => {
      const m = /^([A-Z]+)(\d+)$/.exec(a1);
      if (!m) return;
      const c = a1ToCol(m[1]);
      const r = Number(m[2]) - 1;
      while (rows.length <= r) rows.push([]);
      const row = rows[r];
      while (row.length <= c) row.push('');
      row[c] = value == null ? '' : String(value);
      if (rows[0].length < row.length) while (rows[0].length < row.length) rows[0].push('');
    });
    state.sheet.rows = rows;
    state.sheet.model = buildSheetModel(rows);
  }

  async function writeDay(changes, { label = '寫入' } = {}) {
    if (!state.sheet.model || !state.selected) return false;
    if (!canWrite()) {
      setStatus(selfStatusEl, '目前是唯讀：要從這裡寫回試算表，請在上方「Google 試算表同步」填 Apps Script 網址', 'err');
      return false;
    }
    if (state.sheet.writing) return false;
    state.sheet.writing = true;
    state.sheet.flash = true;
    setStatus(selfStatusEl, `${label}中…`);
    try {
      const plan = planDayWrites(state.sheet.model, state.selected, changes);
      await writeSheetCells({ scriptUrl: state.settings.scriptUrl.trim(), token: state.settings.scriptToken || '', cells: plan.cells });
      applyCellsLocally(plan.cells);
      state.sheet.loadedAt = Date.now();
      setStatus(selfStatusEl, `${label}完成（${plan.newRow ? `新增 ${fmtDateLabel(state.selected)} 這一列，` : ''}${plan.cells.length} 格）`, 'ok');
      renderSheetState();
      refreshMonth();
      refreshWeek();
      setTimeout(() => loadSheet({ quiet: true }), 2500);
      return true;
    } catch (e) {
      setStatus(selfStatusEl, e.message || `${label}失敗`, 'err');
      toast(e.message || `${label}失敗`);
      return false;
    } finally {
      state.sheet.writing = false;
      renderSelf();
    }
  }

  function renderSelf() {
    const m = state.sheet.model;
    if (!selfCard) return;
    if (!m || !state.selected) {
      selfCard.hidden = true;
      return;
    }
    selfCard.hidden = false;
    const day = m.days[state.selected];
    const ro = !canWrite();
    const writing = state.sheet.writing;
    selfListEl.innerHTML = m.headers.length
      ? m.headers
          .map((h) => {
            const on = day ? markIsOn(day.marks[h.col]) : false;
            return `<label class="slog-self-item ${on ? 'on' : ''}"><input type="checkbox" data-self-col="${h.col}" ${on ? 'checked' : ''} ${ro || writing ? 'disabled' : ''}><span>${escapeHTML(h.name)}</span></label>`;
          })
          .join('')
      : '<p class="hint">試算表第 1 列還沒有病症名稱（B 欄起每欄填一個）。</p>';
    const status = day?.status || '';
    followEl.innerHTML =
      FOLLOW_THROUGH_OPTIONS.map(
        (o) => `<label class="slog-follow-opt ${status === o ? 'on' : ''}"><input type="radio" name="slFollow" value="${escapeHTML(o)}" ${status === o ? 'checked' : ''} ${ro || writing ? 'disabled' : ''}>${escapeHTML(o)}</label>`
      ).join('') + (status && !FOLLOW_THROUGH_OPTIONS.includes(status) ? `<span class="hint">試算表目前填：${escapeHTML(status)}</span>` : '');
    q('#slPushDay').disabled = ro || writing;
    q('#slPushDay').title = ro ? '需先填 Apps Script 網址' : '';
    if (state.sheet.flash) return;
    if (ro) {
      setStatus(selfStatusEl, day ? '唯讀：顯示試算表裡這一天的內容。填 Apps Script 網址後可直接在這裡勾選寫回。' : '試算表裡還沒有這一天；填 Apps Script 網址後，第一次勾選會自動新增這一列。', 'busy');
    } else if (!day) {
      setStatus(selfStatusEl, '試算表裡還沒有這一天，第一次勾選會自動新增這一列。', 'busy');
    } else hideStatus(selfStatusEl);
  }

  selfListEl?.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-self-col]');
    if (!cb) return;
    const col = Number(cb.dataset.selfCol);
    const name = state.sheet.model?.headers.find((h) => h.col === col)?.name || '';
    writeDay({ marks: { [col]: cb.checked } }, { label: `「${name}」${cb.checked ? '記為有' : '記為無'}` });
  });
  followEl?.addEventListener('change', (e) => {
    const r = e.target.closest('input[name="slFollow"]');
    if (r) writeDay({ status: r.value }, { label: '「有沒有做到」' });
  });
  q('#slPushDay')?.addEventListener('click', () => {
    const f = funnelFromCalls(state.day || {}, state.calls, state.settings);
    const agg = currentAggregate();
    const detected = agg.symptoms.filter((s) => s.count >= Math.max(1, Math.ceil(agg.total / 2))).slice(0, 5).map((s) => s.label).join('、');
    writeDay(
      {
        tool: {
          撥出: f.dialed,
          接通: f.connected,
          超過5分: f.over,
          長Call: f.long,
          進邀約: f.invites,
          工具偵測病症: agg.total ? `${detected || '無'}（${agg.total} 通）` : '',
          明天只改一個動作: state.day?.note?.action || '',
        },
      },
      { label: '漏斗＋筆記寫入' }
    );
  });

  const persistSheetSettings = (() => {
    let t = null;
    return () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const patch = { sheetUrl: sheetUrlEl.value.trim(), scriptUrl: scriptUrlEl.value.trim(), scriptToken: scriptTokenEl.value.trim() };
        state.settings = { ...state.settings, ...patch };
        try {
          state.settings = await saveSettings(patch);
        } catch {
          /* keep in-memory */
        }
        renderSheetState();
        renderSelf();
      }, 300);
    };
  })();
  [sheetUrlEl, scriptUrlEl, scriptTokenEl].forEach((el) => el?.addEventListener('input', persistSheetSettings));
  sheetUrlEl?.addEventListener('change', () => setTimeout(() => loadSheet(), 350));
  q('#slSheetReload')?.addEventListener('click', () => loadSheet());
  q('#slCopyScript')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(APPS_SCRIPT_TEMPLATE);
      toast('已複製 Apps Script 程式碼');
    } catch {
      q('#slScriptCode')?.select();
      toast('請按 Ctrl+C 複製');
    }
  });
  q('#slTestWrite')?.addEventListener('click', async () => {
    const scriptStatusEl = q('#slScriptStatus');
    const scriptUrl = scriptUrlEl.value.trim();
    if (!scriptUrl) return setStatus(scriptStatusEl, '請先貼 Apps Script 網址', 'err');
    setStatus(scriptStatusEl, '測試寫入（只碰空格子 ZZ1000，寫完立刻清空）…');
    try {
      await writeSheetCells({ scriptUrl, token: scriptTokenEl.value.trim(), cells: [{ a1: 'ZZ1000', value: 'call-coach-test' }] });
      await writeSheetCells({ scriptUrl, token: scriptTokenEl.value.trim(), cells: [{ a1: 'ZZ1000', value: '' }] });
      setStatus(scriptStatusEl, '寫入測試成功，之後勾選會直接寫回試算表', 'ok');
    } catch (e) {
      setStatus(scriptStatusEl, e.message || '測試失敗', 'err');
    }
  });

  /* ---------------- 啟動 ---------------- */

  async function activate() {
    if (state.activated) {
      refreshMonth();
      refreshWeek();
      refreshDiagnoseButton();
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
    sheetUrlEl.value = state.settings.sheetUrl || '';
    scriptUrlEl.value = state.settings.scriptUrl || '';
    scriptTokenEl.value = state.settings.scriptToken || '';
    const codeEl = q('#slScriptCode');
    if (codeEl) codeEl.value = APPS_SCRIPT_TEMPLATE;
    renderSheetState();
    await refreshMonth();
    await refreshWeek();
    await renderMonthlyReview();
    await selectDay(today);
    loadSheet({ quiet: true });
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
