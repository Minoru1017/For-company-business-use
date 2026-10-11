/**
 * DEMO 簡報模式裡的「DEMO 後複盤」：上半是目前這位客戶的建檔表單（自動儲存），
 * 下半是所有複盤檔案（統計、篩選、待跟進、匯出 CSV）。
 */
import {
  FITS,
  OUTCOMES,
  REVIEW_TEXT_FIELDS,
  TIER_OPTIONS,
  emptyReview,
  filterReviews,
  followUpStatus,
  loadReviews,
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
  tierLabel,
  upsertReview,
} from './demo-review.js';
import { escapeHTML } from './utils.js';

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
 * @param {(msg:string)=>void} [opts.showToast]
 * @returns {{ setDeck(rec:object|null):void, refresh():void }}
 */
export function mountDemoReview(container, { hasDeck = () => false, onOpenDeck = () => {}, showToast } = {}) {
  const toast = (m) => showToast?.(m);
  const state = { reviews: loadReviews(), reviewId: null, deck: null, filter: { outcome: '', followUp: false, q: '' }, saveT: null };

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

  function onField(el) {
    const key = el.dataset.dr;
    let r = current();
    if (!r) {
      r = emptyReview(deckDefaults());
      state.reviewId = r.id;
    }
    const { review, list } = upsertReview(state.reviews, { ...r, [key]: el.value });
    state.reviews = list;
    state.reviewId = review.id;
    scheduleSave();
    renderMissing();
    renderArchive();
  }

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
    refresh() {
      state.reviews = loadReviews();
      if (state.reviewId && !current()) state.reviewId = null;
      renderForm();
      renderArchive();
    },
  };
}
