/**
 * 顧問式 DEMO P1 UI：路線規劃 → 現場驗證 → 阻力診斷 → 兩種決策卡。
 * 掛在 DEMO 複盤裡，但自己的 DOM 與事件都封裝在本模組。
 */
import {
  buildDecisionPrompt,
  buildDemoGuidePrompt,
  guideStats,
  normalizeDemoGuide,
  parseDecisionResponse,
  parseDemoGuideResponse,
  patchGuideRoute,
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
  } = {}
) {
  if (!container) return { render() {} };
  const toast = (m) => showToast?.(m);
  const state = { routeId: '', busy: '', status: '' };

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
      <label class="dr-consult-consent"><input type="checkbox" id="drGuideConsent"> 我確認將 P0 診斷、客戶資料與現場驗證筆記送到 Google Gemini（建議隱去全名、電話）</label>
      <div class="dr-consult-key" id="drGuideKeyRow" hidden>
        <input type="password" class="field" id="drGuideKey" placeholder="貼上 Gemini API Key" autocomplete="off">
        <span class="hint" id="drGuideKeyHint"></span>
      </div>
      <div class="dr-guide-actions">
        <button type="button" class="btn primary" id="drGuideGenerate">規劃驗證路線</button>
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

  function routeCardHtml(r) {
    const resultButtons = Object.entries(RESULT_LABELS)
      .map(
        ([key, label]) =>
          `<button type="button" class="dr-result-btn ${r.result === key ? 'on' : ''} ${key}" data-result="${key}" aria-pressed="${r.result === key}">${label}</button>`
      )
      .join('');
    return `
      <header class="dr-route-title">
        <span>待驗證假設</span>
        <h4>${escapeHTML(r.title)}</h4>
        <p>${escapeHTML(r.hypothesis)}</p>
        <blockquote>依據：${escapeHTML(r.customerQuote || '目前無直接原話')}</blockquote>
      </header>
      <div class="dr-route-flow">
        <section><span>BEFORE</span><b>展示前先問</b><p>${escapeHTML(r.beforeQuestion)}</p></section>
        <section class="demo"><span>DEMO</span><b>只展示這個場景</b><p>${escapeHTML(r.demo)}</p></section>
        <section><span>VERIFY</span><b>展示後驗收</b><p>${escapeHTML(r.afterQuestion)}</p></section>
      </div>
      <div class="dr-route-guard">
        <div><b>觀察訊號</b><ul>${(r.signals || []).map((x) => `<li>${escapeHTML(x)}</li>`).join('') || '<li>尚未設定</li>'}</ul></div>
        <div><b>停損條件</b><p>${escapeHTML(r.stopCondition || '尚未設定')}</p></div>
        <div><b>這段不要講</b><p>${escapeHTML(r.avoid || '尚未設定')}</p></div>
      </div>
      <div class="dr-field-evidence">
        <div class="dr-result-pick" role="group" aria-label="驗證結果">${resultButtons}</div>
        <label>客戶反應
          <select class="field" data-route-field="reaction">${REACTION_OPTIONS.map(([key, label]) => `<option value="${key}" ${r.reaction === key ? 'selected' : ''}>${label}</option>`).join('')}</select>
        </label>
        <label class="wide">客戶現場原話
          <textarea class="field" rows="2" data-route-field="observedQuote" placeholder="只記客戶真的說過的話，不替他下結論">${escapeHTML(r.observedQuote)}</textarea>
        </label>
        <label class="wide">現場備註
          <textarea class="field" rows="2" data-route-field="note" placeholder="資料限制、誰是決策人、哪個假設需要改…">${escapeHTML(r.note)}</textarea>
        </label>
      </div>`;
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
    const hasP0 = !!r?.consult;
    const hasGuide = !!g?.routes?.length;
    const stats = guideStats(g);
    els.gate.hidden = hasGuide;
    els.workspace.hidden = !hasGuide;
    els.gate.innerHTML = hasGuide
      ? ''
      : hasP0
        ? '<b>用 P0 診斷規劃這場 DEMO</b><span>AI 只安排 1–3 個需要驗證的場景，不會把整套功能塞進來。</span>'
        : '<b>先完成 P0 顧問診斷</b><span>P1 必須從可追溯的診斷開始，否則只是換一種方式介紹產品。</span>';
    els.generate.disabled = !hasP0 || !!state.busy;
    els.generate.textContent = state.busy === 'route' ? '規劃中…' : hasGuide ? '重新規劃路線' : '規劃驗證路線';
    els.decision.hidden = !hasGuide;
    els.decision.disabled = !stats.tested || !!state.busy;
    els.decision.textContent = state.busy === 'decision' ? '整理中…' : g?.decision ? '重新整理阻力與決策卡' : '整理阻力與決策卡';
    els.cards.hidden = !g?.decision;
    els.progress.textContent = hasGuide ? `已驗證 ${stats.tested} / ${stats.total} · 有原話 ${stats.withQuote}` : '尚未規劃';
    els.status.textContent = state.status;
    if (!hasGuide) return;

    if (!state.routeId || !g.routes.some((x) => x.id === state.routeId)) state.routeId = g.routes[0].id;
    els.nav.innerHTML = g.routes
      .map(
        (x, i) =>
          `<button type="button" class="dr-route-tab ${x.id === state.routeId ? 'on' : ''} ${x.result}" data-route="${escapeHTML(x.id)}">
            <span>${String(i + 1).padStart(2, '0')}</span><b>${escapeHTML(x.title)}</b><small>${RESULT_LABELS[x.result]}</small>
          </button>`
      )
      .join('');
    const route = activeRoute();
    els.card.innerHTML = route ? routeCardHtml(route) : '';
    els.resistanceWords.value = g.resistanceWords || '';
    els.decisionResult.innerHTML = decisionHtml(g.decision);
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
    const r = review();
    if (!r?.consult || state.busy || !canSend()) return;
    const key = apiKey();
    if (!key) return;
    state.busy = 'route';
    state.status = '正在把 P0 診斷收斂成 1–3 個可驗證場景…';
    render();
    try {
      const { parsed, usedTokens, modelUsed } = await callGeminiResilient({
        apiKey: key,
        model: getModel?.(),
        text: buildDemoGuidePrompt({ review: r, deckInput: getDeck?.()?.input || {}, courseNotes: getCourseNotes?.() || '' }),
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
  els.decision.addEventListener('click', generateDecision);
  els.cards.addEventListener('click', () => {
    const r = review();
    if (r?.demoGuide?.decision) openDemoDecisionCards(r, { showToast });
  });
  els.nav.addEventListener('click', (e) => {
    const id = e.target.closest('[data-route]')?.dataset.route;
    if (!id) return;
    state.routeId = id;
    render();
  });
  els.card.addEventListener('click', (e) => {
    const result = e.target.closest('[data-result]')?.dataset.result;
    const r = activeRoute();
    if (!result || !r) return;
    saveGuide(patchGuideRoute(guide(), r.id, { result }));
    render();
  });
  els.card.addEventListener('change', (e) => {
    const key = e.target.dataset.routeField;
    const r = activeRoute();
    if (!key || !r) return;
    saveGuide(patchGuideRoute(guide(), r.id, { [key]: e.target.value }));
    render();
  });
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
