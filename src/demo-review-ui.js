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
  upsertReview,
  videoFromFile,
} from './demo-review.js';
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
 * @param {(msg:string)=>void} [opts.showToast]
 * @returns {{ setDeck(rec:object|null):void, syncDeckInfo(rec:object):void, openReview(id:string):boolean, refresh():void }}
 */
export function mountDemoReview(
  container,
  { hasDeck = () => false, onOpenDeck = () => {}, onSendVideo, hasAnalysis = () => false, onOpenAnalysis, showToast } = {}
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
  };

  container.innerHTML = `
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
      <div class="dr-foot">
        <span class="dr-missing" id="drMissing"></span>
        <span class="dr-foot-actions">
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
  };

  const current = () => state.reviews.find((r) => r.id === state.reviewId) || null;

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

  fieldEls.forEach((el) => {
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
      state.reviews = loadReviews();
      if (state.reviewId && !current()) state.reviewId = null;
      renderForm();
      renderArchive();
    },
  };
}
