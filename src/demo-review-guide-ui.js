/**
 * 顧問式 DEMO P1 UI：路線規劃 → 現場驗證 → 阻力診斷 → 兩種決策卡。
 * 掛在 DEMO 複盤裡，但自己的 DOM 與事件都封裝在本模組。
 */
import {
  applyQuoteMatches,
  buildDecisionPrompt,
  buildDemoGuidePrompt,
  buildQuoteMatchPrompt,
  findQuoteMoments,
  formatClock,
  guideStats,
  normalizeDemoGuide,
  parseDecisionResponse,
  parseClock,
  parseDemoGuideResponse,
  parseQuoteMatchResponse,
  patchGuideRoute,
  quoteMatchSchema,
  selectQuoteCandidates,
  STANCE_RESULT,
} from './demo-review-guide.js';
import { openDemoDecisionCards } from './demo-review-decision-card.js';
import { callGeminiResilient, describeApiKeyProblem } from './gemini.js';
import { escapeHTML } from './utils.js';

const RESULT_LABELS = {
  pending: '待驗證',
  confirmed: '已驗證',
  revise: '需修正',
  rejected: '不適用',
};
const STANCE_LABELS = { support: '支持假設', revise: '需修正假設', reject: '推翻假設' };
const CONFIDENCE_LABELS = { high: '字面明確', medium: '需推論', low: '勉強相關' };
const FIELD_RESULTS = ['confirmed', 'revise', 'rejected'];
const REACTION_OPTIONS = [
  ['none', '尚未記錄反應'],
  ['inquiry', '主動追問'],
  ['agreed', '明確認同'],
  ['hesitant', '猶豫'],
  ['objection', '提出疑慮'],
];
const RESISTANCE_LABELS = {
  outcome: '成果不確定',
  self: '擔心自己做不到',
  process: '資料／流程未成熟',
  authority: '決策人未參與',
  timing: '時機未到',
  price: '價格／回收疑慮',
  fit: '目前不適配',
  none: '尚未辨識',
};

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @returns {{render():void}}
 */
export function mountDemoGuide(
  container,
  {
    getReview,
    getDeck = () => null,
    updateReview,
    getCourseNotes = () => '',
    getApiKey,
    setApiKey,
    getModel,
    onGeminiUsed,
    showToast,
    getTranscript,
    onPlayAt,
  } = {}
) {
  if (!container) return { render() {} };
  const state = { routeId: '', busy: '', status: '', pickOpen: false, pickQuery: null, openDetails: new Set() };

  container.innerHTML = `
    <section class="dr-guide">
      <div class="dr-guide-head">
        <div><span class="dr-consult-kicker">CONSULTATIVE P1</span><h3>顧問式 DEMO <small>展示不是目的，驗證判斷才是</small></h3></div>
        <span class="dr-guide-progress" id="drGuideProgress"></span>
      </div>
      <div class="dr-guide-gate" id="drGuideGate"></div>
      <div id="drGuideWorkspace" hidden>
        <nav class="dr-route-nav" id="drRouteNav" aria-label="DEMO 驗證路線"></nav>
        <article class="dr-route-card" id="drRouteCard"></article>
        <div class="dr-resistance-input">
          <label><b>客戶阻力原話</b><span>先記原話，不急著反駁；整理決策時才判斷真正原因。</span></label>
          <textarea class="field" id="drResistanceWords" rows="2" placeholder="例：我覺得很好，但要先問主管；原本是誰說的、完整句子是什麼？"></textarea>
        </div>
        <div class="dr-decision-result" id="drDecisionResult"></div>
      </div>
      <label class="dr-consult-consent"><input type="checkbox" id="drGuideConsent"> 我確認將客戶資料、P0 診斷（若有）、現場驗證筆記，以及比對時從逐字稿篩出的客戶候選句（最多 40 句，不含業務發言）送到 Google Gemini（建議隱去全名、電話）</label>
      <div class="dr-consult-key" id="drGuideKeyRow" hidden>
        <input type="password" class="field" id="drGuideKey" placeholder="貼上 Gemini API Key" autocomplete="off">
        <span class="hint" id="drGuideKeyHint"></span>
      </div>
      <div class="dr-guide-actions">
        <button type="button" class="btn primary" id="drGuideGenerate">規劃驗證路線</button>
        <button type="button" class="btn" id="drGuideMatch" hidden>AI 比對逐字稿原話</button>
        <button type="button" class="btn" id="drGuideDecision" hidden>整理阻力與決策卡</button>
        <button type="button" class="btn" id="drGuideCards" hidden>開啟兩種決策卡</button>
        <span class="dr-consult-status" id="drGuideStatus"></span>
      </div>
    </section>`;

  const q = (s) => container.querySelector(s);
  const els = {
    progress: q('#drGuideProgress'),
    gate: q('#drGuideGate'),
    workspace: q('#drGuideWorkspace'),
    nav: q('#drRouteNav'),
    card: q('#drRouteCard'),
    resistanceWords: q('#drResistanceWords'),
    decisionResult: q('#drDecisionResult'),
    consent: q('#drGuideConsent'),
    keyRow: q('#drGuideKeyRow'),
    key: q('#drGuideKey'),
    keyHint: q('#drGuideKeyHint'),
    generate: q('#drGuideGenerate'),
    match: q('#drGuideMatch'),
    decision: q('#drGuideDecision'),
    cards: q('#drGuideCards'),
    status: q('#drGuideStatus'),
  };

  const review = () => getReview?.() || null;
  const guide = () => review()?.demoGuide || null;
  const activeRoute = () => {
    const routes = guide()?.routes || [];
    return routes.find((r) => r.id === state.routeId) || routes[0] || null;
  };

  function saveGuide(next) {
    if (!next) return;
    updateReview?.({ demoGuide: next });
  }

  function transcript() {
    const id = review()?.analysis?.historyId;
    const segs = id ? getTranscript?.(id) : null;
    return Array.isArray(segs) && segs.length ? segs : null;
  }

  function pickListHtml(r, query) {
    const hits = findQuoteMoments(transcript(), query);
    if (!hits.length) return '<p class="dr-pick-empty">逐字稿裡找不到相近的客戶發言，換幾個關鍵字試試。</p>';
    return hits
      .map(
        (h) =>
          `<button type="button" class="dr-pick-item ${r.quoteAt === h.start ? 'on' : ''}" data-pick-start="${h.start}" data-pick-index="${h.index}">
            <time>${formatClock(h.start)}</time><span>${escapeHTML(h.text)}</span>
          </button>`
      )
      .join('');
  }

  function matchesHtml(r) {
    if (!r.matches?.length) {
      return guide()?.matchAt ? '<p class="dr-match-empty">AI 在逐字稿裡沒找到這個假設的客戶證據——現場可能沒聊到，下次要補問。</p>' : '';
    }
    return `<div class="dr-match">
      <div class="dr-match-head"><b>AI 建議原話</b><span>AI 只做選擇題，原話與時間取自逐字稿；採用前請確認</span></div>
      ${r.matches
        .map(
          (m, i) => `<div class="dr-match-item ${m.stance} ${r.quoteAt === m.start && r.observedQuote === m.text ? 'used' : ''}">
            <div class="dr-match-meta">
              <span class="dr-stance ${m.stance}">${STANCE_LABELS[m.stance]}</span>
              <small>${CONFIDENCE_LABELS[m.confidence]} · 建議按「${RESULT_LABELS[STANCE_RESULT[m.stance]]}」</small>
              <button type="button" class="dr-quote-time" data-match-play="${i}">▶ ${formatClock(m.start)}</button>
            </div>
            <p>${escapeHTML(m.text)}</p>
            <button type="button" class="dr-match-use" data-match-use="${i}">${r.quoteAt === m.start && r.observedQuote === m.text ? '已採用' : '採用這句'}</button>
          </div>`
        )
        .join('')}
    </div>`;
  }

  function routeCardHtml(r) {
    const resultButtons = FIELD_RESULTS.map(
      (key) =>
        `<button type="button" class="dr-result-btn ${r.result === key ? 'on' : ''} ${key}" data-result="${key}" aria-pressed="${r.result === key}">${RESULT_LABELS[key]}</button>`
    ).join('');
    const hasTranscript = !!transcript();
    const hasTime = r.quoteAt != null;
    const timeChip = hasTime
      ? `<button type="button" class="dr-quote-time" data-play title="跳到錄影／逐字稿這個時間點">▶ ${formatClock(r.quoteAt)}</button><button type="button" class="dr-quote-clear" data-clear-time aria-label="移除時間點">×</button>`
      : '';
    const pickToggle = hasTranscript
      ? `<button type="button" class="dr-quote-pick-btn ${state.pickOpen ? 'on' : ''}" data-pick-toggle>${state.pickOpen ? '收起逐字稿' : '從逐字稿挑原話'}</button>`
      : '';
    const query = state.pickQuery ?? (r.observedQuote || r.hypothesis || '');
    const picker =
      hasTranscript && state.pickOpen
        ? `<div class="dr-pick">
            <input type="search" class="field" data-pick-query value="${escapeHTML(query)}" placeholder="輸入客戶可能說過的關鍵字">
            <div class="dr-pick-list" id="drPickList">${pickListHtml(r, query)}</div>
          </div>`
        : '';
    const open = (key) => (state.openDetails.has(key) ? 'open' : '');
    return `
      <header class="dr-route-title">
        <span>待驗證假設</span>
        <h4>${escapeHTML(r.title)}</h4>
        <p>${escapeHTML(r.hypothesis)}</p>
      </header>
      <div class="dr-route-flow">
        <section><span>BEFORE</span><b>展示前先問</b><p>${escapeHTML(r.beforeQuestion)}</p></section>
        <section class="demo"><span>DEMO</span><b>只展示這個場景</b><p>${escapeHTML(r.demo)}</p></section>
        <section><span>VERIFY</span><b>展示後驗收</b><p>${escapeHTML(r.afterQuestion)}</p></section>
      </div>
      <div class="dr-field-evidence">
        <div class="dr-result-pick" role="group" aria-label="驗證結果（再按一次可取消）">${resultButtons}</div>
        <div class="dr-quote">
          <div class="dr-quote-head"><b>客戶原話</b>${timeChip}${pickToggle}</div>
          <textarea class="field" rows="2" data-route-field="observedQuote" placeholder="只記客戶真的說過的話，不替他下結論">${escapeHTML(r.observedQuote)}</textarea>
          ${picker}
        </div>
        ${matchesHtml(r)}
      </div>
      <details class="dr-route-more" data-details="prep" ${open('prep')}>
        <summary>展示前提醒：觀察訊號・停損・不要講</summary>
        <div class="dr-route-guard">
          <div><b>觀察訊號</b><ul>${(r.signals || []).map((x) => `<li>${escapeHTML(x)}</li>`).join('') || '<li>尚未設定</li>'}</ul></div>
          <div><b>停損條件</b><p>${escapeHTML(r.stopCondition || '尚未設定')}</p></div>
          <div><b>這段不要講</b><p>${escapeHTML(r.avoid || '尚未設定')}</p></div>
        </div>
        <blockquote>假設依據：${escapeHTML(r.customerQuote || '目前無直接原話')}</blockquote>
      </details>
      <details class="dr-route-more" data-details="after" ${open('after')}>
        <summary>會後補充：反應・時間點・備註</summary>
        <div class="dr-after-grid">
          <label>客戶反應
            <select class="field" data-route-field="reaction">${REACTION_OPTIONS.map(([key, label]) => `<option value="${key}" ${r.reaction === key ? 'selected' : ''}>${label}</option>`).join('')}</select>
          </label>
          <label>原話時間點
            <input class="field" data-route-field="quoteAtClock" inputmode="numeric" placeholder="例：32:18" value="${hasTime ? formatClock(r.quoteAt) : ''}">
          </label>
          <label class="wide">現場備註
            <textarea class="field" rows="2" data-route-field="note" placeholder="資料限制、誰是決策人、哪個假設需要改…">${escapeHTML(r.note)}</textarea>
          </label>
        </div>
      </details>`;
  }

  function decisionHtml(d) {
    if (!d) return '';
    const r = d.resistance;
    return `<div class="dr-resistance-result">
      <div class="dr-resistance-title"><span>阻力診斷</span><b>${escapeHTML(RESISTANCE_LABELS[r.category] || '尚未辨識')}</b><small>${r.status === 'confirmed' ? '已由原話確認' : '仍需向客戶確認'}</small></div>
      ${r.customerWords ? `<blockquote>${escapeHTML(r.customerWords)}</blockquote>` : ''}
      <dl>
        ${r.hypothesis ? `<div><dt>可能原因</dt><dd>${escapeHTML(r.hypothesis)}</dd></div>` : ''}
        ${r.verifyQuestion ? `<div><dt>先問這句</dt><dd>${escapeHTML(r.verifyQuestion)}</dd></div>` : ''}
        ${r.action ? `<div><dt>確認後行動</dt><dd>${escapeHTML(r.action)}</dd></div>` : ''}
      </dl>
    </div>`;
  }

  function render() {
    const r = review();
    const g = guide();
    const input = getDeck?.()?.input || {};
    const hasP0 = !!r?.consult;
    const hasPreDemoContext = !!Object.values(input).some((x) => String(x || '').trim());
    const hasContext = hasP0 || hasPreDemoContext;
    const hasGuide = !!g?.routes?.length;
    const stats = guideStats(g);
    els.gate.hidden = hasGuide;
    els.workspace.hidden = !hasGuide;
    els.gate.innerHTML = hasGuide
      ? ''
      : hasP0
        ? '<b>用 P0 診斷規劃這場 DEMO</b><span>AI 只安排 1–3 個需要驗證的場景，不會把整套功能塞進來。</span>'
        : hasPreDemoContext
          ? '<b>第一次 DEMO：先把前期資料變成待驗證假設</b><span>這些不是結論；現場必須由客戶確認、修正或推翻。完成 P0 後可再重新規劃。</span>'
          : '<b>先填上方客戶資料</b><span>至少需要目標、疑慮或開發紀錄，才能規劃一場有依據的 DEMO。</span>';
    els.generate.disabled = !hasContext || !!state.busy;
    els.generate.textContent = state.busy === 'route' ? '規劃中…' : hasGuide ? '重新規劃路線' : '規劃驗證路線';
    els.match.hidden = !hasGuide || !transcript();
    els.match.disabled = !!state.busy;
    els.match.textContent = state.busy === 'match' ? '比對中…' : g?.matchAt ? '重新比對逐字稿' : 'AI 比對逐字稿原話';
    els.decision.hidden = !hasGuide;
    els.decision.disabled = !stats.tested || !!state.busy;
    els.decision.textContent = state.busy === 'decision' ? '整理中…' : g?.decision ? '重新整理阻力與決策卡' : '整理阻力與決策卡';
    els.cards.hidden = !g?.decision;
    els.progress.textContent = hasGuide ? `已驗證 ${stats.tested} / ${stats.total} · 有原話 ${stats.withQuote} · 有時間點 ${stats.withTime}` : '尚未規劃';
    els.status.textContent = state.status;
    if (!hasGuide) return;

    if (!state.routeId || !g.routes.some((x) => x.id === state.routeId)) state.routeId = g.routes[0].id;
    renderNav(g);
    const route = activeRoute();
    els.card.innerHTML = route ? routeCardHtml(route) : '';
    els.resistanceWords.value = g.resistanceWords || '';
    els.decisionResult.innerHTML = decisionHtml(g.decision);
  }

  function renderNav(g) {
    els.nav.innerHTML = g.routes
      .map(
        (x, i) =>
          `<button type="button" class="dr-route-tab ${x.id === state.routeId ? 'on' : ''} ${x.result}" data-route="${escapeHTML(x.id)}">
            <span>${String(i + 1).padStart(2, '0')}</span><b>${escapeHTML(x.title)}</b><small>${RESULT_LABELS[x.result]}</small>
          </button>`
      )
      .join('');
  }

  /** 打字欄位只更新進度與分頁，避免整張卡重畫讓游標跳掉 */
  function renderLight() {
    const g = guide();
    if (!g?.routes?.length) return render();
    const stats = guideStats(g);
    els.progress.textContent = `已驗證 ${stats.tested} / ${stats.total} · 有原話 ${stats.withQuote} · 有時間點 ${stats.withTime}`;
    els.decision.disabled = !stats.tested || !!state.busy;
    els.cards.hidden = !g.decision;
    els.decisionResult.innerHTML = decisionHtml(g.decision);
    renderNav(g);
  }

  function apiKey() {
    const key = String(getApiKey?.() || els.key.value || '').trim();
    const problem = describeApiKeyProblem(key);
    if (problem) {
      els.keyRow.hidden = false;
      els.keyHint.textContent = problem;
      els.key.focus();
      return '';
    }
    return key;
  }

  function canSend() {
    if (!els.consent.checked) {
      state.status = '請先勾選同意，再把資料送到 Google Gemini。';
      els.consent.focus();
      render();
      return false;
    }
    return true;
  }

  async function generateRoutes() {
    const r = review() || {};
    const input = getDeck?.()?.input || {};
    const hasContext = !!r.consult || Object.values(input).some((x) => String(x || '').trim());
    if (!hasContext || state.busy || !canSend()) return;
    const key = apiKey();
    if (!key) return;
    state.busy = 'route';
    state.status = '正在把 P0 診斷收斂成 1–3 個可驗證場景…';
    render();
    try {
      const { parsed, usedTokens, modelUsed } = await callGeminiResilient({
        apiKey: key,
        model: getModel?.(),
        text: buildDemoGuidePrompt({ review: r, deckInput: input, courseNotes: getCourseNotes?.() || '' }),
        generationConfig: { temperature: 0.25, maxOutputTokens: 6144 },
        parse: parseDemoGuideResponse,
        onRetry: ({ status, delayMs }) => {
          state.status = `Google 回報 ${status}，${Math.round(delayMs / 1000)} 秒後重試…`;
          render();
        },
      });
      const next = normalizeDemoGuide({ ...parsed, at: Date.now(), model: modelUsed });
      saveGuide(next);
      state.routeId = next.routes[0]?.id || '';
      state.status = '路線已產生。現場每段都要留下驗證結果，最好記一則客戶原話。';
      els.consent.checked = false;
      onGeminiUsed?.(usedTokens);
    } catch (e) {
      state.status = e?.message || String(e);
    } finally {
      state.busy = '';
      render();
    }
  }

  async function matchTranscript() {
    const g = guide();
    const segs = transcript();
    if (!g || !segs || state.busy) return;
    const candidates = selectQuoteCandidates(segs, g.routes);
    if (!candidates.length) {
      state.status = '逐字稿裡沒有標成「客戶」的句子，請先到 DEMO 轉錄的「標記說話者」確認後再比對。';
      return render();
    }
    if (!canSend()) return;
    const key = apiKey();
    if (!key) return;
    state.busy = 'match';
    state.status = `本機先篩出 ${candidates.length} 句客戶發言，交給 AI 逐題判斷…`;
    render();
    try {
      const routes = g.routes.map(({ id, title, hypothesis }) => ({ id, title, hypothesis }));
      const ask = (withSchema) =>
        callGeminiResilient({
          apiKey: key,
          model: getModel?.(),
          text: buildQuoteMatchPrompt({ routes, candidates }),
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 4096,
            ...(withSchema ? { responseSchema: quoteMatchSchema(routes, candidates) } : {}),
          },
          parse: (raw) => parseQuoteMatchResponse(raw, { routes, candidates }),
          onRetry: ({ status, delayMs }) => {
            state.status = `Google 回報 ${status}，${Math.round(delayMs / 1000)} 秒後重試…`;
            render();
          },
        });
      // 部分舊模型不接受 responseSchema 的 enum，退回只靠 prompt 約束選項
      const { parsed, usedTokens } = await ask(true).catch((e) => (e?.status === 400 ? ask(false) : Promise.reject(e)));
      saveGuide(applyQuoteMatches(guide(), parsed));
      const found = Object.values(parsed).filter((ms) => ms.length).length;
      state.status = found
        ? `${found} / ${g.routes.length} 條路線找到客戶證據。請逐條確認後按「採用這句」，再自己按驗證結果。`
        : 'AI 沒在逐字稿找到能支持或推翻假設的客戶發言，這些假設下次要補問。';
      els.consent.checked = false;
      onGeminiUsed?.(usedTokens);
    } catch (e) {
      state.status = e?.message || String(e);
    } finally {
      state.busy = '';
      render();
    }
  }

  async function generateDecision() {
    const r = review();
    const g = guide();
    if (!g || state.busy || !canSend()) return;
    const key = apiKey();
    if (!key) return;
    state.busy = 'decision';
    state.status = '正在用現場證據整理阻力與兩種決策卡…';
    render();
    try {
      const { parsed, usedTokens, modelUsed } = await callGeminiResilient({
        apiKey: key,
        model: getModel?.(),
        text: buildDecisionPrompt({ review: r, guide: g, deckInput: getDeck?.()?.input || {}, courseNotes: getCourseNotes?.() || '' }),
        generationConfig: { temperature: 0.2, maxOutputTokens: 6144 },
        parse: parseDecisionResponse,
      });
      saveGuide(normalizeDemoGuide({ ...g, decision: { ...parsed, at: Date.now(), model: modelUsed } }));
      state.status = '已整理。阻力仍標示是否確認；客戶版已排除內部標籤。';
      els.consent.checked = false;
      onGeminiUsed?.(usedTokens);
    } catch (e) {
      state.status = e?.message || String(e);
    } finally {
      state.busy = '';
      render();
    }
  }

  els.generate.addEventListener('click', generateRoutes);
  els.match.addEventListener('click', matchTranscript);
  els.decision.addEventListener('click', generateDecision);
  els.cards.addEventListener('click', () => {
    const r = review();
    if (r?.demoGuide?.decision) openDemoDecisionCards(r, { showToast });
  });
  els.nav.addEventListener('click', (e) => {
    const id = e.target.closest('[data-route]')?.dataset.route;
    if (!id) return;
    state.routeId = id;
    state.pickOpen = false;
    state.pickQuery = null;
    render();
  });
  function patchRoute(patch) {
    const r = activeRoute();
    if (!r) return;
    saveGuide(patchGuideRoute(guide(), r.id, patch));
  }

  els.card.addEventListener('click', (e) => {
    const r = activeRoute();
    if (!r) return;
    const resultBtn = e.target.closest('[data-result]');
    if (resultBtn) {
      const result = resultBtn.dataset.result;
      patchRoute({ result: r.result === result ? 'pending' : result });
      return render();
    }
    const matchPlay = e.target.closest('[data-match-play]');
    if (matchPlay) {
      const m = r.matches[Number(matchPlay.dataset.matchPlay)];
      if (m) onPlayAt?.(review()?.analysis?.historyId || '', m.start);
      return;
    }
    const matchUse = e.target.closest('[data-match-use]');
    if (matchUse) {
      const m = r.matches[Number(matchUse.dataset.matchUse)];
      if (!m) return;
      patchRoute({ observedQuote: m.text, quoteAt: m.start });
      showToast?.(`已採用 ${formatClock(m.start)} 的原話；驗證結果請自己確認後再按`);
      return render();
    }
    if (e.target.closest('[data-play]')) {
      if (r.quoteAt != null) onPlayAt?.(review()?.analysis?.historyId || '', r.quoteAt);
      return;
    }
    if (e.target.closest('[data-clear-time]')) {
      patchRoute({ quoteAt: null });
      return render();
    }
    if (e.target.closest('[data-pick-toggle]')) {
      state.pickOpen = !state.pickOpen;
      state.pickQuery = null;
      return render();
    }
    const pick = e.target.closest('[data-pick-start]');
    if (pick) {
      const segs = transcript() || [];
      const seg = segs[Number(pick.dataset.pickIndex)];
      patchRoute({ observedQuote: String(seg?.text || '').trim(), quoteAt: Number(pick.dataset.pickStart) });
      state.pickOpen = false;
      state.pickQuery = null;
      showToast?.(`已帶入 ${formatClock(pick.dataset.pickStart)} 的客戶原話`);
      return render();
    }
  });
  els.card.addEventListener('input', (e) => {
    if (!e.target.matches('[data-pick-query]')) return;
    state.pickQuery = e.target.value;
    const list = els.card.querySelector('#drPickList');
    const r = activeRoute();
    if (list && r) list.innerHTML = pickListHtml(r, state.pickQuery);
  });
  els.card.addEventListener('change', (e) => {
    const key = e.target.dataset.routeField;
    if (!key || !activeRoute()) return;
    if (key === 'quoteAtClock') {
      const raw = e.target.value.trim();
      const sec = parseClock(raw);
      if (raw && sec == null) {
        showToast?.('時間格式請用 32:18 或 1:02:05');
        return;
      }
      patchRoute({ quoteAt: sec });
      return render();
    }
    patchRoute({ [key]: e.target.value });
    renderLight();
  });
  els.card.addEventListener(
    'toggle',
    (e) => {
      const key = e.target.dataset?.details;
      if (!key) return;
      if (e.target.open) state.openDetails.add(key);
      else state.openDetails.delete(key);
    },
    true
  );
  els.resistanceWords.addEventListener('change', () => {
    const g = guide();
    if (!g) return;
    saveGuide(normalizeDemoGuide({ ...g, resistanceWords: els.resistanceWords.value, decision: null }));
    render();
  });
  els.key.addEventListener('change', () => {
    const value = els.key.value.trim();
    setApiKey?.(value);
    const problem = describeApiKeyProblem(value);
    els.keyHint.textContent = problem || '已儲存，可重新執行';
    if (!problem) els.keyRow.hidden = true;
  });

  render();
  return { render };
}
