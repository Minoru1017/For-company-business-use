/**
 * DEMO 簡報模式裡的「DEMO 後複盤」：上半是目前這位客戶的建檔表單（自動儲存），
 * 下半是所有複盤檔案（統計、篩選、待跟進、匯出 CSV）。
 */
import {
  FITS,
  OUTCOMES,
  REVIEWS_CHANGED_EVENT,
  REVIEW_TEXT_FIELDS,
  TIER_OPTIONS,
  emptyReview,
  filterReviews,
  followUpStatus,
  getPendingReview,
  formatAnalysisSummary,
  loadReviews,
  mergeLinkFields,
  outcomeLabel,
  removeReview,
  reviewFileName,
  reviewForDeck,
  reviewHasContent,
  reviewMissing,
  reviewStats,
  reviewToText,
  reviewsToCsv,
  saveReviews,
  setPendingReview,
  tierLabel,
  todayKey,
  upsertReview,
  videoFromFile,
} from './demo-review.js';
import { openReviewCard } from './demo-review-card.js';
import { buildConsultPrompt, consultToText, parseConsultResponse } from './demo-review-consult.js';
import { mountDemoGuide } from './demo-review-guide-ui.js';
import { callGeminiResilient, describeApiKeyProblem } from './gemini.js';
import { ensureCustomerId } from './customers.js';
import { escapeHTML } from './utils.js';

const AUTO_START_KEY = 'call_coach_review_autostart';
const FOLLOW_LABELS = { overdue: '已過期', today: '今天跟進', nodate: '未填日期', upcoming: '' };

function downloadText(name, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {(deckId:string)=>boolean} opts.hasDeck  這份簡報還在不在
 * @param {(deckId:string)=>void} opts.onOpenDeck  切到那份簡報（會再呼叫 setDeck）
 * @param {(file:File, o:{autoStart:boolean})=>Promise<{ok:boolean,filename?:string,reason?:string}>} [opts.onSendVideo]  把錄影送進 DEMO 轉錄
 * @param {(historyId:string)=>boolean} [opts.hasAnalysis]  「最近分析」裡還找不找得到這筆
 * @param {(historyId:string)=>void} [opts.onOpenAnalysis]  開啟那筆分析
 * @param {()=>string} [opts.getApiKey]
 * @param {(value:string)=>void} [opts.setApiKey]
 * @param {()=>string} [opts.getModel]
 * @param {(tokens:number)=>void} [opts.onGeminiUsed]
 * @param {()=>string} [opts.getCourseNotes]
 * @param {(msg:string)=>void} [opts.showToast]
 * @returns {{ setDeck(rec:object|null):void, syncDeckInfo(rec:object):void, syncDeckContext(rec:object):void, openReview(id:string):boolean, refresh():void }}
 */
export function mountDemoReview(
  container,
  {
    hasDeck = () => false,
    onOpenDeck = () => {},
    onSendVideo,
    hasAnalysis = () => false,
    onOpenAnalysis,
    getApiKey,
    setApiKey,
    getModel,
    onGeminiUsed,
    getCourseNotes = () => '',
    showToast,
  } = {}
) {
  const toast = (m) => showToast?.(m);
  const state = {
    reviews: loadReviews(),
    reviewId: null,
    deck: null,
    filter: { outcome: '', followUp: false, q: '' },
    saveT: null,
    videoFile: null,
    videoFileFor: null,
    sending: false,
    consulting: false,
    consultTab: 'diagnosis',
  };

  container.innerHTML = `
    <div id="drGuide"></div>
    <section class="card dr-form">
      <div class="dr-head">
        <h3>DEMO 後複盤 <small id="drWho"></small></h3>
        <span class="hint" id="drSaved"></span>
      </div>
      <div class="dr-grid">
        <label class="dk-field short"><span>客戶</span><input type="text" class="field" data-dr="customer" maxlength="80"></label>
        <label class="dk-field short"><span>DEMO 時間</span><input type="text" class="field" data-dr="demoAt" maxlength="40" placeholder="1006 20:30"></label>
        <label class="dk-field short"><span>DEMO 結果</span>
          <select class="field" data-dr="outcome"><option value="">選擇結果</option>${OUTCOMES.map((o) => `<option value="${o.key}">${o.label}</option>`).join('')}</select></label>
        <label class="dk-field short"><span>這位客戶實際是</span>
          <select class="field" data-dr="tier"><option value="">還沒判斷</option>${TIER_OPTIONS.map((t) => `<option value="${t.key}">${t.label}</option>`).join('')}</select></label>
        <label class="dk-field short"><span>方案適配</span>
          <select class="field" data-dr="fit"><option value="">還沒判斷</option>${FITS.map((f) => `<option value="${f}">${f}</option>`).join('')}</select></label>
        <label class="dk-field short"><span>跟進日期</span><input type="date" class="field" data-dr="followUpDate"></label>
        <label class="dk-field wide"><span>下一步（約好什麼、誰要做什麼）</span><input type="text" class="field" data-dr="nextStep" maxlength="300" placeholder="例：週三晚上 8 點 1:1 諮詢，我先傳課綱"></label>
        ${REVIEW_TEXT_FIELDS.map(
          (f) => `<label class="dk-field wide"><span>${escapeHTML(f.label)}</span><textarea class="field" data-dr="${f.key}" rows="${f.rows}" placeholder="${escapeHTML(f.placeholder)}"></textarea></label>`
        ).join('')}
      </div>
      <div class="dr-video" id="drVideo">
        <div class="dr-video-head">
          <b>DEMO 錄影</b>
          <small>上傳這場 DEMO 的 MP4，送進「DEMO 轉錄」做逐字稿與分析；分析完成後結果會自動回填到這筆複盤。</small>
        </div>
        <div class="dr-video-drop" id="drVideoDrop" tabindex="0" role="button" aria-label="選擇或拖曳 DEMO 錄影 MP4">
          <span id="drVideoDropText">拖曳 MP4 到這裡，或點此選擇檔案</span>
          <input type="file" id="drVideoFile" accept=".mp4,video/mp4" hidden>
        </div>
        <p class="dr-video-state" id="drVideoState"></p>
        <div class="dr-video-actions">
          <button type="button" class="btn primary slog-mini" id="drVideoSend" hidden>送到 DEMO 轉錄分析</button>
          <label class="dr-video-auto" id="drVideoAutoWrap" hidden><input type="checkbox" id="drVideoAuto"> 送出後自動開始轉錄</label>
          <button type="button" class="btn slog-mini" id="drVideoOpen" hidden>開啟分析結果</button>
          <button type="button" class="btn slog-mini" id="drVideoClear" hidden>移除錄影</button>
        </div>
      </div>
      <section class="dr-consult" id="drConsult">
        <div class="dr-consult-head">
          <div>
            <span class="dr-consult-kicker">CONSULTATIVE P0</span>
            <h3>顧問工作台 <small>AI 是第二意見；先以你的複盤為準</small></h3>
          </div>
          <span class="dr-consult-meta" id="drConsultMeta"></span>
        </div>
        <div class="dr-consult-empty" id="drConsultEmpty">
          <b>把複盤變成下一次能行動的判斷</b>
          <span>一次整理顧問診斷、下次必問、AI 落地定義與具體下一步。資料不足會標成待確認，不替客戶補故事。</span>
        </div>
        <div class="dr-consult-tabs" id="drConsultTabs" role="tablist" aria-label="顧問工作台">
          <button type="button" class="dr-consult-tab" data-consult-tab="diagnosis"><span>01</span><b>顧問診斷</b><small>問題與適配</small></button>
          <button type="button" class="dr-consult-tab" data-consult-tab="gaps"><span>02</span><b>下次必問</b><small>資訊缺口</small></button>
          <button type="button" class="dr-consult-tab" data-consult-tab="implementation"><span>03</span><b>落地定義</b><small>可驗收成果</small></button>
          <button type="button" class="dr-consult-tab" data-consult-tab="next"><span>04</span><b>具體下一步</b><small>誰在何時做什麼</small></button>
        </div>
        <div class="dr-consult-detail" id="drConsultDetail"></div>
        <label class="dr-consult-consent"><input type="checkbox" id="drConsultConsent"> 我確認將這筆複盤與目前客戶資料送到 Google Gemini（建議隱去全名、電話）</label>
        <div class="dr-consult-key" id="drConsultKeyRow" hidden>
          <input type="password" class="field" id="drConsultKey" placeholder="貼上 Gemini API Key" autocomplete="off">
          <span class="hint" id="drConsultKeyHint"></span>
        </div>
        <div class="dr-consult-actions">
          <button type="button" class="btn primary" id="drConsultRun">產生顧問建議</button>
          <button type="button" class="btn" id="drConsultApply" hidden>套用到下一步</button>
          <button type="button" class="btn" id="drConsultCopy" hidden>複製四張卡</button>
          <span class="dr-consult-status" id="drConsultStatus"></span>
        </div>
      </section>
      <div class="dr-foot">
        <span class="dr-missing" id="drMissing"></span>
        <span class="dr-foot-actions">
          <button type="button" class="btn primary slog-mini" id="drCard" title="做成一張圖卡，直接傳給主管">分享圖卡</button>
          <button type="button" class="btn slog-mini" id="drCopy">複製這筆</button>
          <button type="button" class="btn slog-mini" id="drNew" title="不綁簡報，單獨建一筆">＋ 另開一筆</button>
        </span>
      </div>
    </section>
    <section class="card dr-archive">
      <div class="dr-head">
        <h3>複盤檔案 <small id="drCount"></small></h3>
        <button type="button" class="btn slog-mini" id="drExport">匯出 CSV</button>
      </div>
      <div class="dr-stats" id="drStats"></div>
      <div class="dr-filters">
        <input type="search" class="field" id="drSearch" placeholder="搜尋客戶或內容">
        <select class="field" id="drOutcomeFilter"><option value="">全部結果</option>${OUTCOMES.map((o) => `<option value="${o.key}">${o.label}</option>`).join('')}<option value="none">還沒填結果</option></select>
        <label class="dr-due"><input type="checkbox" id="drDueOnly"> 只看該跟進的</label>
      </div>
      <ul class="dr-list" id="drList"></ul>
    </section>`;

  const q = (sel) => container.querySelector(sel);
  const fieldEls = [...container.querySelectorAll('[data-dr]')];
  const els = {
    who: q('#drWho'),
    saved: q('#drSaved'),
    missing: q('#drMissing'),
    count: q('#drCount'),
    stats: q('#drStats'),
    list: q('#drList'),
    videoDrop: q('#drVideoDrop'),
    videoDropText: q('#drVideoDropText'),
    videoFile: q('#drVideoFile'),
    videoState: q('#drVideoState'),
    videoSend: q('#drVideoSend'),
    videoAuto: q('#drVideoAuto'),
    videoAutoWrap: q('#drVideoAutoWrap'),
    videoOpen: q('#drVideoOpen'),
    videoClear: q('#drVideoClear'),
    consultMeta: q('#drConsultMeta'),
    consultEmpty: q('#drConsultEmpty'),
    consultTabs: q('#drConsultTabs'),
    consultDetail: q('#drConsultDetail'),
    consultConsent: q('#drConsultConsent'),
    consultKeyRow: q('#drConsultKeyRow'),
    consultKey: q('#drConsultKey'),
    consultKeyHint: q('#drConsultKeyHint'),
    consultRun: q('#drConsultRun'),
    consultApply: q('#drConsultApply'),
    consultCopy: q('#drConsultCopy'),
    consultStatus: q('#drConsultStatus'),
  };

  const current = () => state.reviews.find((r) => r.id === state.reviewId) || null;
  let demoGuideUI = null;

  function flush() {
    if (!state.saveT) return;
    clearTimeout(state.saveT);
    state.saveT = null;
    try {
      saveReviews(state.reviews);
      els.saved.textContent = '已儲存';
    } catch (e) {
      toast(`複盤儲存失敗：${e?.message || e}`);
    }
  }

  function scheduleSave() {
    els.saved.textContent = '儲存中…';
    clearTimeout(state.saveT);
    state.saveT = setTimeout(flush, 400);
  }

  function deckDefaults() {
    const d = state.deck;
    if (!d) return {};
    return {
      deckId: d.id,
      customerId: d.customerId || '',
      customer: String(d.input?.name || '').trim() || d.deck?.customer || '',
      demoAt: d.input?.demoAt || '',
    };
  }

  function renderForm() {
    const r = current();
    const defaults = r ? null : deckDefaults();
    fieldEls.forEach((el) => {
      el.value = r ? r[el.dataset.dr] || '' : defaults[el.dataset.dr] || '';
    });
    els.who.textContent = r?.deckId && hasDeck(r.deckId) ? '・對應目前這份簡報' : r ? '・未綁定簡報' : state.deck ? '・對應目前這份簡報（填任何一欄就會建檔）' : '';
    els.saved.textContent = '';
    renderMissing();
    renderVideo();
    renderConsult();
    demoGuideUI?.render();
  }

  function fmtSize(n) {
    return n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.max(1, Math.round(n / 1024 / 1024))} MB`;
  }

  function renderVideo() {
    const r = current();
    const v = r?.video;
    const a = r?.analysis;
    const inMemory = !!(v && state.videoFile && state.videoFileFor === r.id);
    els.videoDropText.textContent = v ? `目前：${v.name}（${fmtSize(v.size)}）——點此或拖曳可更換` : '拖曳 MP4 到這裡，或點此選擇檔案';
    els.videoDrop.classList.toggle('has-file', !!v);
    let text = '';
    let tone = '';
    if (a) {
      text = `✓ 已完成轉錄分析：${formatAnalysisSummary(a.summary)}`;
      tone = 'ok';
    } else if (v?.transcribedAt) {
      text = '逐字稿已轉好。到「DEMO 轉錄」標記說話者（業務／客戶）後按「開始分析」，結果會回填到這裡。';
      tone = 'warn';
    } else if (v?.sentAt) {
      text = '錄影已送進轉錄助手。若沒有自動開始，到「DEMO 轉錄」面板按「開始轉錄」；轉好後會自動對上這筆複盤。';
      tone = 'warn';
    } else if (v) {
      text = inMemory ? '已選擇錄影，還沒送進轉錄。' : '複盤只記住檔名；要轉錄請重新選擇這個檔案。';
    }
    els.videoState.textContent = text;
    els.videoState.className = `dr-video-state ${tone}`;
    els.videoSend.hidden = !v || !onSendVideo || !!a;
    els.videoAutoWrap.hidden = els.videoSend.hidden;
    els.videoSend.disabled = state.sending;
    els.videoSend.textContent = state.sending ? '送出中…' : inMemory ? (v.sentAt ? '重新送到 DEMO 轉錄' : '送到 DEMO 轉錄分析') : '重新選擇檔案並送出';
    els.videoOpen.hidden = !(a && onOpenAnalysis && hasAnalysis(a.historyId));
    els.videoClear.hidden = !v;
  }

  const CONSULT_LABELS = {
    current: '現況',
    goal: '目標',
    bottleneck: '流程斷點',
    cost: '不處理的代價',
    decision: '決策條件',
    fit: '適配判斷',
    recommendation: '負責任的建議',
    confidence: '診斷可信度',
    user: '實際使用者',
    workflow: '原始工作流程',
    input: '需要的資料',
    output: '要產出的成果',
    acceptance: '可驗收標準',
    review: '人工審核點',
    risk: '風險／前置條件',
    action: '下一個最小行動',
    owner: '業務要做',
    counterpart: '客戶／決策人要做',
    date: '建議日期',
    condition: '完成條件',
    message: '可直接傳給客戶',
  };
  const EVIDENCE_LABELS = { confirmed: '已確認', inferred: '合理推測', missing: '待確認' };

  function consultRows(obj, keys) {
    return keys
      .filter((key) => obj?.[key])
      .map(
        (key) =>
          `<div class="dr-consult-row"><dt>${escapeHTML(CONSULT_LABELS[key] || key)}</dt><dd>${escapeHTML(obj[key])}</dd></div>`
      )
      .join('');
  }

  function renderConsult() {
    const consult = current()?.consult;
    const has = !!consult;
    els.consultEmpty.hidden = has;
    els.consultTabs.hidden = !has;
    els.consultDetail.hidden = !has;
    els.consultApply.hidden = !has || !(consult.next?.action || consult.next?.date);
    els.consultCopy.hidden = !has;
    els.consultRun.textContent = state.consulting ? 'AI 判讀中…' : has ? '重新產生' : '產生顧問建議';
    els.consultRun.disabled = state.consulting;
    els.consultMeta.textContent = has
      ? `AI 草稿 · ${consult.at ? new Date(consult.at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}`
      : '尚未產生';
    if (!has) {
      els.consultDetail.innerHTML = '';
      return;
    }

    [...els.consultTabs.querySelectorAll('[data-consult-tab]')].forEach((btn) => {
      const on = btn.dataset.consultTab === state.consultTab;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', String(on));
    });

    let html = '';
    if (state.consultTab === 'diagnosis') {
      const evidence = consult.evidence?.length
        ? `<div class="dr-evidence"><h4>判斷依據</h4>${consult.evidence
            .map(
              (e) => `<div class="dr-evidence-item">
                <span class="dr-evidence-status ${escapeHTML(e.status)}">${EVIDENCE_LABELS[e.status] || '合理推測'}</span>
                <div><b>${escapeHTML(e.claim)}</b><small>${escapeHTML(e.source || '沒有直接依據')}</small></div>
              </div>`
            )
            .join('')}</div>`
        : '';
      html = `<dl class="dr-consult-rows">${consultRows(consult.diagnosis, [
        'current',
        'goal',
        'bottleneck',
        'cost',
        'decision',
        'fit',
        'recommendation',
        'confidence',
      ])}</dl>${evidence}`;
    } else if (state.consultTab === 'gaps') {
      html = consult.gaps?.length
        ? `<ol class="dr-gap-list">${consult.gaps
            .map(
              (g) => `<li>
                <span class="dr-gap-priority ${escapeHTML(g.priority)}">${g.priority === 'high' ? '優先' : g.priority === 'low' ? '可後問' : '重要'}</span>
                <div><b>${escapeHTML(g.topic || '待確認')}</b><p>${escapeHTML(g.question)}</p>${g.why ? `<small>${escapeHTML(g.why)}</small>` : ''}</div>
              </li>`
            )
            .join('')}</ol>`
        : '<p class="hint">AI 沒有列出待追問項目；仍請由顧問確認資料是否足夠。</p>';
    } else if (state.consultTab === 'implementation') {
      html = `<dl class="dr-consult-rows implementation">${consultRows(consult.implementation, [
        'user',
        'workflow',
        'input',
        'output',
        'acceptance',
        'review',
        'risk',
      ])}</dl>`;
    } else {
      html = `<dl class="dr-consult-rows next">${consultRows(consult.next, [
        'action',
        'owner',
        'counterpart',
        'date',
        'condition',
        'message',
      ])}</dl><p class="dr-ai-caution">這是 AI 建議，不代表客戶已承諾。套用前請確認日期、參與人與雙方任務。</p>`;
    }
    els.consultDetail.innerHTML = html || '<p class="hint">這張卡目前沒有內容，建議補充複盤後重新產生。</p>';
  }

  function renderMissing() {
    const r = current();
    if (!r || !reviewHasContent(r)) {
      els.missing.textContent = '';
      els.missing.className = 'dr-missing';
      return;
    }
    const miss = reviewMissing(r);
    els.missing.textContent = miss.length ? `還缺：${miss.join('、')}` : '建檔完整';
    els.missing.className = `dr-missing ${miss.length ? 'warn' : 'ok'}`;
  }

  function renderArchive() {
    const stats = reviewStats(state.reviews);
    els.count.textContent = stats.total ? `${stats.total} 筆` : '';
    const chip = (label, value, cls = '') => `<div class="dr-chip ${cls}"><b>${value}</b><span>${label}</span></div>`;
    els.stats.innerHTML = stats.total
      ? [
          chip('已建檔', stats.total),
          chip('當場成交', stats.byOutcome.closed, 'ok'),
          chip('約下一步／考慮中', stats.byOutcome.next + stats.byOutcome.thinking),
          chip('成交率', stats.closeRate == null ? '—' : `${Math.round(stats.closeRate * 100)}%`),
          chip('該跟進', stats.due, stats.due ? 'warn' : ''),
          chip('資料不完整', stats.incomplete, stats.incomplete ? 'warn' : ''),
        ].join('')
      : '<p class="hint">還沒有複盤檔案。DEMO 結束後，在上面填一下結果與下一步就會建檔。</p>';
    const rows = filterReviews(state.reviews, state.filter);
    els.list.innerHTML = rows.length
      ? rows
          .map((r) => {
            const fu = followUpStatus(r);
            const miss = reviewMissing(r).length;
            const meta = [r.demoAt, r.tier ? tierLabel(r.tier) : '', r.fit ? `適配 ${r.fit}` : '', r.followUpDate ? `跟進 ${r.followUpDate}` : ''].filter(Boolean).join(' · ');
            return `<li class="dr-item${r.id === state.reviewId ? ' active' : ''}" data-id="${escapeHTML(r.id)}">
              <button type="button" class="dr-open" data-open>
                <b>${escapeHTML(r.customer || '未命名客戶')}</b>
                <span class="dr-badge ${escapeHTML(OUTCOMES.find((o) => o.key === r.outcome)?.tone || 'muted')}">${escapeHTML(outcomeLabel(r.outcome))}</span>
                ${FOLLOW_LABELS[fu] ? `<span class="dr-badge ${fu === 'upcoming' ? 'muted' : 'warn'}">${FOLLOW_LABELS[fu]}</span>` : ''}
                ${r.analysis ? '<span class="dr-badge ok">已分析錄影</span>' : r.video ? '<span class="dr-badge muted">有錄影</span>' : ''}
                ${miss ? '<span class="dr-badge muted">待補</span>' : ''}
                <small>${escapeHTML(meta)}</small>
                ${r.nextStep ? `<small class="dr-next">下一步：${escapeHTML(r.nextStep)}</small>` : ''}
              </button>
              <button type="button" class="dr-item-card" data-card title="分享圖卡" aria-label="分享圖卡">圖卡</button>
              <button type="button" class="dk-deck-del" data-del title="刪除這筆複盤" aria-label="刪除">×</button>
            </li>`;
          })
          .join('')
      : `<li class="hint">${state.reviews.length ? '沒有符合條件的檔案。' : ''}</li>`;
  }

  function patchCurrent(patch) {
    let r = current();
    if (!r) {
      r = emptyReview(deckDefaults());
      state.reviewId = r.id;
    }
    const { review, list } = upsertReview(state.reviews, { ...r, ...patch });
    state.reviews = list;
    state.reviewId = review.id;
    scheduleSave();
    renderMissing();
    renderArchive();
    return review;
  }

  function onField(el) {
    patchCurrent({ [el.dataset.dr]: el.value });
  }

  function pickVideo(file, { send = false } = {}) {
    if (!file) return;
    if (!/\.mp4$/i.test(file.name)) return toast('請選擇 .mp4 的 DEMO 錄影檔');
    const review = patchCurrent({ video: videoFromFile(file), analysis: null });
    state.videoFile = file;
    state.videoFileFor = review.id;
    renderVideo();
    if (send) sendVideo();
  }

  async function sendVideo() {
    const r = current();
    if (!r?.video || !onSendVideo || state.sending) return;
    if (!state.videoFile || state.videoFileFor !== r.id) {
      els.videoFile.dataset.send = '1';
      els.videoFile.click();
      return;
    }
    state.sending = true;
    renderVideo();
    flush();
    try {
      const res = await onSendVideo(state.videoFile, { autoStart: els.videoAuto.checked });
      if (res?.ok) {
        patchCurrent({ video: { ...current().video, sentAt: Date.now(), bridgeName: res.filename || current().video.bridgeName } });
        setPendingReview(current().id);
        flush();
      }
    } catch (e) {
      toast(`送出失敗：${e?.message || e}`);
    } finally {
      state.sending = false;
      renderVideo();
    }
  }

  async function generateConsult() {
    const r = current();
    if (!r || !reviewHasContent(r)) return toast('先完成 DEMO 複盤，再產生顧問建議');
    if (state.consulting) return;
    if (!els.consultConsent.checked) {
      els.consultStatus.textContent = '請先勾選同意把這筆資料送到 Google Gemini。';
      els.consultConsent.focus();
      return;
    }
    const key = String(getApiKey?.() || els.consultKey.value || '').trim();
    const keyProblem = describeApiKeyProblem(key);
    if (keyProblem) {
      els.consultKeyRow.hidden = false;
      els.consultKeyHint.textContent = keyProblem;
      els.consultKey.focus();
      return;
    }

    state.consulting = true;
    els.consultStatus.textContent = '正在交叉整理診斷、缺口與可驗收成果…';
    renderConsult();
    flush();
    try {
      const { parsed, usedTokens, modelUsed } = await callGeminiResilient({
        apiKey: key,
        model: getModel?.(),
        text: buildConsultPrompt({
          review: r,
          deckInput: state.deck?.input || {},
          courseNotes: getCourseNotes?.() || '',
          today: todayKey(),
        }),
        generationConfig: { temperature: 0.25, maxOutputTokens: 8192 },
        parse: parseConsultResponse,
        onRetry: ({ attempt, maxAttempts, delayMs, status }) => {
          els.consultStatus.textContent = `Google 回報 ${status}，${Math.round(delayMs / 1000)} 秒後重試（${attempt}/${maxAttempts}）…`;
        },
        onModelSwitch: (next) => {
          els.consultStatus.textContent = `目前模型忙碌，改用 ${next}…`;
        },
      });
      patchCurrent({ consult: { ...parsed, at: Date.now(), model: modelUsed } });
      flush();
      onGeminiUsed?.(usedTokens);
      state.consultTab = 'diagnosis';
      els.consultStatus.textContent = '已產生。請先核對「已確認／合理推測／待確認」再採用。';
      els.consultConsent.checked = false;
      demoGuideUI?.render();
    } catch (e) {
      els.consultStatus.textContent = e?.message || String(e);
    } finally {
      state.consulting = false;
      renderConsult();
    }
  }

  els.videoDrop.addEventListener('click', () => els.videoFile.click());
  els.videoDrop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      els.videoFile.click();
    }
  });
  els.videoDrop.addEventListener('dragover', (e) => {
    e.preventDefault();
    els.videoDrop.classList.add('drag');
  });
  els.videoDrop.addEventListener('dragleave', () => els.videoDrop.classList.remove('drag'));
  els.videoDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    els.videoDrop.classList.remove('drag');
    pickVideo(e.dataTransfer?.files?.[0]);
  });
  els.videoFile.addEventListener('change', () => {
    const file = els.videoFile.files?.[0];
    const send = els.videoFile.dataset.send === '1';
    delete els.videoFile.dataset.send;
    els.videoFile.value = '';
    pickVideo(file, { send });
  });
  try {
    els.videoAuto.checked = localStorage.getItem(AUTO_START_KEY) === '1';
  } catch {
    /* ignore */
  }
  els.videoAuto.addEventListener('change', () => {
    try {
      localStorage.setItem(AUTO_START_KEY, els.videoAuto.checked ? '1' : '0');
    } catch {
      /* ignore */
    }
  });
  els.videoSend.addEventListener('click', sendVideo);
  els.videoOpen.addEventListener('click', () => {
    const a = current()?.analysis;
    if (a) onOpenAnalysis?.(a.historyId);
  });
  els.videoClear.addEventListener('click', () => {
    if (!current()?.video) return;
    if (!window.confirm('移除這筆複盤的錄影與分析連結？（不會刪除轉錄助手裡的檔案）')) return;
    const removedId = current().id;
    patchCurrent({ video: null, analysis: null });
    if (getPendingReview() === removedId) setPendingReview('');
    state.videoFile = null;
    state.videoFileFor = null;
    renderVideo();
  });

  els.consultTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-consult-tab]')?.dataset.consultTab;
    if (!tab) return;
    state.consultTab = tab;
    renderConsult();
  });
  els.consultRun.addEventListener('click', generateConsult);
  els.consultKey.addEventListener('change', () => {
    const value = els.consultKey.value.trim();
    setApiKey?.(value);
    const problem = describeApiKeyProblem(value);
    els.consultKeyHint.textContent = problem || '已儲存，再按一次「產生顧問建議」';
    if (!problem) els.consultKeyRow.hidden = true;
  });
  els.consultApply.addEventListener('click', () => {
    const n = current()?.consult?.next;
    if (!n) return;
    const nextStep = [n.action, n.owner ? `業務：${n.owner}` : '', n.counterpart ? `客戶／決策人：${n.counterpart}` : '', n.condition ? `完成：${n.condition}` : '']
      .filter(Boolean)
      .join('｜')
      .slice(0, 300);
    const patch = { nextStep };
    if (n.date) patch.followUpDate = n.date;
    patchCurrent(patch);
    container.querySelector('[data-dr="nextStep"]').value = nextStep;
    if (n.date) container.querySelector('[data-dr="followUpDate"]').value = n.date;
    renderMissing();
    toast('已套用 AI 建議；請確認這確實是雙方約好的下一步');
  });
  els.consultCopy.addEventListener('click', async () => {
    const text = consultToText(current()?.consult);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('已複製四張顧問卡');
    } catch {
      toast('無法複製，請確認瀏覽器權限');
    }
  });

  fieldEls.forEach((el) => {
    if (el.dataset.dr === 'customer') {
      el.addEventListener('change', () => {
        const r = current();
        if (r) patchCurrent({ customerId: ensureCustomerId(el.value) });
      });
    }
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', () => onField(el));
  });

  q('#drNew').addEventListener('click', () => {
    flush();
    const r = emptyReview();
    state.reviews = [r, ...state.reviews];
    state.reviewId = r.id;
    saveReviews(state.reviews);
    renderForm();
    renderArchive();
    container.querySelector('[data-dr="customer"]').focus();
  });

  q('#drCard').addEventListener('click', () => {
    const r = current();
    if (!r || !reviewHasContent(r)) return toast('先填結果或下一步，才有東西可以做成圖卡');
    flush();
    openReviewCard(r, { showToast });
  });

  q('#drCopy').addEventListener('click', async () => {
    const r = current();
    if (!r || !reviewHasContent(r)) return toast('這筆還沒有內容');
    try {
      await navigator.clipboard.writeText(reviewToText(r));
      toast('已複製這筆複盤');
    } catch {
      toast('無法複製，請改用匯出 CSV');
    }
  });

  q('#drExport').addEventListener('click', () => {
    if (!state.reviews.length) return toast('還沒有複盤檔案可以匯出');
    downloadText(reviewFileName(), reviewsToCsv(filterReviews(state.reviews, state.filter)));
  });

  q('#drSearch').addEventListener('input', (e) => {
    state.filter.q = e.target.value;
    renderArchive();
  });
  q('#drOutcomeFilter').addEventListener('change', (e) => {
    state.filter.outcome = e.target.value;
    renderArchive();
  });
  q('#drDueOnly').addEventListener('change', (e) => {
    state.filter.followUp = e.target.checked;
    renderArchive();
  });

  els.list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-id]');
    if (!li) return;
    const r = state.reviews.find((x) => x.id === li.dataset.id);
    if (!r) return;
    if (e.target.closest('[data-card]')) {
      if (!reviewHasContent(r)) return toast('這筆還沒有內容');
      flush();
      openReviewCard(r, { showToast });
      return;
    }
    if (e.target.closest('[data-del]')) {
      if (!window.confirm(`刪除「${r.customer || '未命名客戶'}」的複盤檔案？`)) return;
      flush();
      state.reviews = removeReview(state.reviews, r.id);
      saveReviews(state.reviews);
      if (state.reviewId === r.id) state.reviewId = null;
      renderForm();
      renderArchive();
      return;
    }
    flush();
    if (r.deckId && hasDeck(r.deckId)) {
      state.reviewId = r.id;
      onOpenDeck(r.deckId);
    } else {
      state.reviewId = r.id;
      renderForm();
      renderArchive();
    }
    container.querySelector('.dr-form')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  });

  window.addEventListener('beforeunload', flush);
  window.addEventListener(REVIEWS_CHANGED_EVENT, () => {
    state.reviews = mergeLinkFields(state.reviews, loadReviews());
    renderVideo();
    renderMissing();
    renderArchive();
  });

  demoGuideUI = mountDemoGuide(q('#drGuide'), {
    getReview: current,
    getDeck: () => state.deck,
    updateReview: (patch) => {
      patchCurrent(patch);
      flush();
    },
    getCourseNotes,
    getApiKey,
    setApiKey,
    getModel,
    onGeminiUsed,
    showToast,
  });
  renderForm();
  renderArchive();

  return {
    /** 簡報切換時呼叫：顯示這份簡報對應的複盤（還沒有就是空白表單，填了才建檔） */
    setDeck(rec) {
      flush();
      state.deck = rec || null;
      const linked = rec ? reviewForDeck(state.reviews, rec.id) : null;
      const keepStandalone = !rec && current() && !current().deckId;
      state.reviewId = linked ? linked.id : keepStandalone ? state.reviewId : null;
      renderForm();
      renderArchive();
    },
    /** 簡報的客戶名／DEMO 時間改了：這份簡報還沒建檔時，表單的預設值跟著更新 */
    syncDeckInfo(rec) {
      if (!rec || state.deck?.id !== rec.id || current()) return;
      state.deck = rec;
      renderForm();
    },
    /** 任何客戶資料欄位更新時，讓第一次 DEMO 的 P1 路線規劃立即知道已有前期資料。 */
    syncDeckContext(rec) {
      if (!rec || state.deck?.id !== rec.id) return;
      state.deck = rec;
      demoGuideUI?.render();
    },
    /** 把還沒存的修改立刻寫進儲存（客戶主檔要改名、合併之前呼叫） */
    flush,
    /** 從首頁客戶進度點進來：開啟指定複盤（有對應簡報的由簡報那邊切換） */
    openReview(id) {
      const r = state.reviews.find((x) => x.id === id);
      if (!r) return false;
      flush();
      state.reviewId = r.id;
      renderForm();
      renderArchive();
      return true;
    },
    refresh() {
      flush();
      state.reviews = loadReviews();
      if (state.reviewId && !current()) state.reviewId = null;
      renderForm();
      renderArchive();
    },
  };
}
