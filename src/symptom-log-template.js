/**
 * 症狀紀錄面板的 HTML 骨架（日曆、作戰儀表板、每月總結、試算表同步、日檢視各卡片）。
 */
import { AUDIO_ACCEPT } from './audio-transcribe.js';
import { WEEKDAYS } from './symptom-log-helpers.js';
import { escapeHTML } from './utils.js';

export function symptomLogTemplate() {
  return `
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
      <div class="slog-monthly-drill" id="slMonthlyDrill" hidden></div>
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
          <input type="file" id="slFile" accept="${escapeHTML(AUDIO_ACCEPT)}" multiple hidden>
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
        <p class="hint">資料來自播放器的 <kbd>M</kbd> 標記。每個話點拆成「客戶字面上說的」和「他真正想傳達的」；真意是推論，<strong>沒有原句或行為證據就只是「我覺得」</strong>，不能寫進複盤。每通錄音一個分頁、「總覽」看全天；節點可拖曳，位置會記住；點時間可回放該段。</p>
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
}
