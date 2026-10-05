/**
 * 「有邀約開發 → DEMO 簡報」工作區：左側簡報清單、客戶資料表單、簡報編輯器（縮圖／投影片／講者備註）、
 * 全螢幕簡報模式與 PPTX 下載。
 */
import { callGeminiResilient, describeApiKeyProblem } from './gemini.js';
import { listJournalDays } from './reflection-journal.js';
import {
  DECK_STYLES,
  INPUT_FIELDS,
  SLIDE_TYPE_LABELS,
  buildDeckPrompt,
  deckFileName,
  hasCustomerInput,
  imageIdsInDecks,
  invitedReflectionEntries,
  loadCourseNotes,
  loadDecks,
  moveSlide,
  newDeckRecord,
  normalizeSlide,
  parseDeckResponse,
  saveCourseNotes,
  saveDecks,
  setByPath,
  templateDeck,
} from './demo-deck.js';
import { renderDeckSlides } from './demo-deck-slides.js';
import { formatBarHtml, mountDeckFormatBar } from './demo-deck-format-ui.js';
import { deleteDeckImages, loadAllDeckImages } from './demo-deck-images.js';
import { escapeHTML } from './utils.js';

const isTyping = (el) => !!el?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');

export function initDemoDeck(container, { getApiKey, setApiKey, getModel, onGeminiUsed, showToast } = {}) {
  if (!container) return { activate() {}, syncApiKey() {} };
  const toast = (m) => showToast?.(m);
  const state = { decks: loadDecks(), currentId: null, idx: 0, busy: false, saveT: null, present: null, images: new Map() };
  let fmtBar = null;

  container.innerHTML = `
    <div class="dk-app">
      <aside class="card dk-sidebar">
        <div class="dk-side-head"><b>DEMO 簡報</b><button type="button" class="btn slog-mini" id="dkNew">＋ 新簡報</button></div>
        <ul class="dk-deck-list" id="dkList"></ul>
        <p class="hint dk-side-hint">簡報只存在這台電腦。</p>
      </aside>
      <div class="dk-workspace">
        <section class="card dk-input">
          <div class="dk-input-head">
            <h3>客戶資料 <small>有邀約的開發紀錄——簡報每一頁都要回應他喜歡或想知道的事</small></h3>
            <label class="dk-import">從「有邀約」自寫複盤帶入 <select class="field" id="dkImport"></select></label>
          </div>
          <div class="dk-fields" id="dkFields"></div>
          <details class="dk-course">
            <summary>課程／方案重點 <small>所有簡報共用；貼公司實際教的內容，AI 才不會亂編課程細節</small></summary>
            <textarea class="field" id="dkCourse" rows="5" placeholder="例：初階計畫 12 週、每週直播＋作業回饋；第 1 個月工具基礎與第一個作品…"></textarea>
          </details>
          <label class="dk-consent"><input type="checkbox" id="dkConsent"> 我確認把上面的客戶資料送到 Google Gemini 產生簡報（建議隱去全名、電話）</label>
          <div class="row dk-actions">
            <button type="button" class="primary" id="dkGenAI">AI 產生簡報</button>
            <button type="button" id="dkGenTpl" title="不經 AI，照資深同事的骨架放入你填的欄位，缺的標【待補】">用範本產生</button>
            <span class="hint" id="dkStatus"></span>
          </div>
          <div class="row dk-key-row" id="dkKeyRow" hidden>
            <input type="password" class="field" id="dkApiKey" placeholder="貼上 Gemini API Key（與其他模式共用）" autocomplete="off">
            <span class="hint" id="dkKeyHint"></span>
          </div>
        </section>
        <section class="card dk-viewer" id="dkViewer" tabindex="-1" hidden>
          <div class="dk-toolbar">
            <b class="dk-deck-title" id="dkDeckTitle"></b>
            <span class="dk-toolbar-actions">
              <label class="dk-style-pick" title="整份簡報的版型風格">樣式
                <select class="field" id="dkStyle">${DECK_STYLES.map((x) => `<option value="${x.key}">${escapeHTML(x.label)}</option>`).join('')}</select>
              </label>
              <button type="button" class="btn slog-mini" data-dk="up" title="上移這頁">↑</button>
              <button type="button" class="btn slog-mini" data-dk="down" title="下移這頁">↓</button>
              <button type="button" class="btn slog-mini" data-dk="dup">複製此頁</button>
              <button type="button" class="btn slog-mini" data-dk="del">刪除此頁</button>
              <button type="button" class="btn slog-mini" data-dk="pptx">下載 PPTX</button>
              <button type="button" class="primary" data-dk="present">▶ 簡報模式</button>
            </span>
          </div>
          ${formatBarHtml()}
          <div class="dk-viewer-body">
            <ol class="dk-thumbs" id="dkThumbs"></ol>
            <div class="dk-stage-wrap"><div class="dk-stage" id="dkStage"></div><p class="dk-stage-meta" id="dkStageMeta"></p></div>
            <aside class="dk-notes">
              <div class="dk-why"><span class="dk-notes-label">這頁回應客戶的</span><p id="dkWhy"></p></div>
              <label class="dk-notes-label" for="dkNotesText">講者備註 <small>只有你看得到；PPTX 也會帶</small></label>
              <textarea class="field" id="dkNotesText" rows="5"></textarea>
              <p class="hint">投影片上的字可直接點進去改；不在輸入框時按 ← → 換頁。</p>
            </aside>
          </div>
        </section>
      </div>
    </div>`;

  const q = (sel) => container.querySelector(sel);
  const els = {
    list: q('#dkList'),
    fields: q('#dkFields'),
    importSel: q('#dkImport'),
    course: q('#dkCourse'),
    consent: q('#dkConsent'),
    genAI: q('#dkGenAI'),
    genTpl: q('#dkGenTpl'),
    status: q('#dkStatus'),
    keyRow: q('#dkKeyRow'),
    apiKey: q('#dkApiKey'),
    keyHint: q('#dkKeyHint'),
    viewer: q('#dkViewer'),
    title: q('#dkDeckTitle'),
    style: q('#dkStyle'),
    thumbs: q('#dkThumbs'),
    stage: q('#dkStage'),
    stageMeta: q('#dkStageMeta'),
    why: q('#dkWhy'),
    notes: q('#dkNotesText'),
  };

  els.fields.innerHTML = INPUT_FIELDS.map(
    (f) => `<label class="dk-field${f.short ? ' short' : ''}${f.rows ? ' wide' : ''}"><span>${escapeHTML(f.label)}</span>${
      f.short
        ? `<input type="text" class="field" data-input="${f.key}" placeholder="${escapeHTML(f.placeholder)}">`
        : `<textarea class="field" data-input="${f.key}" rows="${f.rows || 2}" placeholder="${escapeHTML(f.placeholder)}"></textarea>`
    }</label>`
  ).join('');
  els.course.value = loadCourseNotes();

  const current = () => state.decks.find((d) => d.id === state.currentId) || null;

  function persistNow() {
    clearTimeout(state.saveT);
    state.saveT = null;
    try {
      saveDecks(state.decks);
    } catch (e) {
      toast(`簡報儲存失敗：${e?.message || e}`);
    }
  }

  function persist() {
    const rec = current();
    if (rec) rec.updatedAt = Date.now();
    clearTimeout(state.saveT);
    state.saveT = setTimeout(persistNow, 400);
  }

  function recLabel(rec) {
    return rec.input.name.trim() || rec.deck?.customer || '未命名客戶';
  }

  function renderList() {
    els.list.innerHTML = state.decks
      .map((rec) => {
        const on = rec.id === state.currentId;
        const meta = [rec.input.demoAt.trim(), rec.deck ? `${rec.deck.slides.length} 頁${rec.source === 'template' ? '・範本' : ''}` : '尚未產生'].filter(Boolean).join(' · ');
        return `<li><button type="button" class="dk-deck-item${on ? ' active' : ''}" data-deck="${escapeHTML(rec.id)}">
          <b>${escapeHTML(recLabel(rec))}</b><small>${escapeHTML(meta)}</small></button>
          <button type="button" class="dk-deck-del" data-del-deck="${escapeHTML(rec.id)}" title="刪除這份簡報" aria-label="刪除">×</button></li>`;
      })
      .join('');
  }

  function renderImport() {
    const items = invitedReflectionEntries(listJournalDays());
    els.importSel.innerHTML = `<option value="">${items.length ? `選擇一通（${items.length}）` : '還沒有標「有邀約」的複盤'}</option>${items
      .map((it) => `<option value="${escapeHTML(it.key)}">${escapeHTML(it.label)}</option>`)
      .join('')}`;
    els.importSel.disabled = !items.length;
    els.importSel._items = items;
  }

  function renderInput() {
    const rec = current();
    els.fields.querySelectorAll('[data-input]').forEach((el) => {
      el.value = rec?.input[el.dataset.input] || '';
    });
  }

  function slideHtmlList(editable) {
    const rec = current();
    return rec?.deck ? renderDeckSlides(rec.deck, { editable, resolveImage: (id) => state.images.get(id) }) : [];
  }

  function renderThumbs() {
    const rec = current();
    const html = slideHtmlList(false);
    els.thumbs.innerHTML = html
      .map(
        (h, i) => `<li><button type="button" class="dk-thumb${i === state.idx ? ' active' : ''}" data-slide="${i}" title="${escapeHTML(SLIDE_TYPE_LABELS[rec.deck.slides[i].type])}"><span class="dk-thumb-n">${i + 1}</span>${h}</button></li>`
      )
      .join('');
  }

  function updateThumb(i) {
    const btn = els.thumbs.querySelector(`[data-slide="${i}"]`);
    const html = slideHtmlList(false)[i];
    if (btn && html) btn.innerHTML = `<span class="dk-thumb-n">${i + 1}</span>${html}`;
  }

  function renderStage() {
    const rec = current();
    const slide = rec?.deck?.slides[state.idx];
    if (!slide) {
      els.stage.innerHTML = '';
      return;
    }
    els.stage.innerHTML = slideHtmlList(true)[state.idx];
    els.stageMeta.textContent = `第 ${state.idx + 1} / ${rec.deck.slides.length} 頁 · ${SLIDE_TYPE_LABELS[slide.type]}`;
    els.why.textContent = slide.why || '（沒有標註依據——想一想這頁是回應他的哪句話？）';
    els.why.classList.toggle('empty', !slide.why);
    els.notes.value = slide.notes || '';
    fmtBar?.afterRender();
  }

  function renderViewer() {
    const rec = current();
    els.viewer.hidden = !rec?.deck;
    if (!rec?.deck) return;
    state.idx = Math.min(Math.max(0, state.idx), rec.deck.slides.length - 1);
    els.title.textContent = rec.deck.title;
    els.style.value = rec.deck.theme?.style || 'classic';
    renderThumbs();
    renderStage();
  }

  function render() {
    renderList();
    renderInput();
    renderViewer();
  }

  function select(id) {
    if (state.saveT) persistNow();
    state.currentId = id;
    state.idx = 0;
    fmtBar?.clear();
    els.status.textContent = '';
    render();
  }

  function createDeck() {
    const rec = newDeckRecord();
    state.decks.unshift(rec);
    persistNow();
    select(rec.id);
    els.fields.querySelector('[data-input="name"]')?.focus();
  }

  function goto(i) {
    const rec = current();
    if (!rec?.deck) return;
    const n = rec.deck.slides.length;
    const next = Math.min(Math.max(0, i), n - 1);
    if (next !== state.idx) fmtBar?.clear();
    state.idx = next;
    els.thumbs.querySelectorAll('.dk-thumb').forEach((b) => b.classList.toggle('active', Number(b.dataset.slide) === state.idx));
    els.thumbs.querySelector('.dk-thumb.active')?.scrollIntoView?.({ block: 'nearest' });
    renderStage();
    if (state.present) renderPresent();
  }

  function confirmOverwrite(rec) {
    return !rec.deck || window.confirm('這份簡報已經產生過，重新產生會蓋掉你改過的內容。要繼續嗎？');
  }

  function applyDeck(rec, deck, source) {
    if (rec.deck?.theme) deck.theme = { ...deck.theme, ...rec.deck.theme };
    rec.deck = deck;
    rec.source = source;
    state.idx = 0;
    persist();
    persistNow();
    render();
    els.viewer.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  function generateTemplate() {
    const rec = current();
    if (!rec) return;
    if (!hasCustomerInput(rec.input)) return toast('先填一些客戶資料（至少學習目標或開發紀錄）');
    if (!confirmOverwrite(rec)) return;
    applyDeck(rec, templateDeck(rec.input), 'template');
    els.status.textContent = '已用範本產生，標【待補】的地方請換成這位客戶的內容。';
  }

  async function generateAI() {
    const rec = current();
    if (!rec || state.busy) return;
    if (!hasCustomerInput(rec.input)) return toast('先填客戶資料或貼上開發紀錄');
    if (!els.consent.checked) {
      els.status.textContent = '請先勾選同意把客戶資料送到 Google Gemini。';
      els.consent.focus();
      return;
    }
    const key = (getApiKey?.() || '').trim();
    const problem = describeApiKeyProblem(key);
    if (problem) {
      els.keyRow.hidden = false;
      els.keyHint.textContent = problem;
      els.apiKey.focus();
      return;
    }
    if (!confirmOverwrite(rec)) return;
    state.busy = true;
    els.genAI.disabled = true;
    els.status.textContent = 'AI 正在依客戶資料編排簡報（約 20–60 秒）…';
    try {
      const { parsed, usedTokens } = await callGeminiResilient({
        apiKey: key,
        model: getModel?.(),
        text: buildDeckPrompt(rec.input, { courseNotes: els.course.value }),
        generationConfig: { temperature: 0.6, maxOutputTokens: 16384 },
        parse: (raw) => parseDeckResponse(raw),
        onRetry: ({ attempt, maxAttempts, delayMs, status }) => {
          els.status.textContent = `Google 回報 ${status}，${Math.round(delayMs / 1000)} 秒後重試（${attempt}/${maxAttempts}）…`;
        },
      });
      onGeminiUsed?.(usedTokens || 0);
      if (state.currentId !== rec.id) select(rec.id);
      applyDeck(rec, parsed, 'ai');
      els.status.textContent = `完成：${parsed.slides.length} 頁。逐頁看右側「這頁回應客戶的」，沒依據的頁可以刪掉。`;
      toast('DEMO 簡報已產生');
    } catch (e) {
      els.status.textContent = `AI 失敗：${e?.message || e}`;
      if (e?.status === 400 || e?.status === 401 || e?.status === 403) els.keyRow.hidden = false;
    } finally {
      state.busy = false;
      els.genAI.disabled = false;
    }
  }

  async function downloadPptx(btn) {
    const rec = current();
    if (!rec?.deck) return;
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = '產生中…';
    try {
      const { exportDeckPptx } = await import('./demo-deck-pptx.js');
      await exportDeckPptx(rec.deck, deckFileName(rec), { images: state.images });
      toast('已下載 PPTX');
    } catch (e) {
      toast(`PPTX 產生失敗：${e?.message || e}`);
    } finally {
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  /* ---- 全螢幕簡報模式（掛在 body，避免卡片的 backdrop-filter 困住 position:fixed） ---- */
  function renderPresent() {
    const rec = current();
    const p = state.present;
    if (!p || !rec?.deck) return;
    const slide = rec.deck.slides[state.idx];
    p.stage.innerHTML = slideHtmlList(false)[state.idx] || '';
    p.notes.textContent = [slide?.notes, slide?.why && `【這頁回應】${slide.why}`].filter(Boolean).join('\n\n') || '（這頁沒有備註）';
  }

  function onPresentKey(e) {
    const rec = current();
    if (!state.present || !rec?.deck) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'PageDown' || k === ' ' || k === 'Enter') goto(state.idx + 1);
    else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') goto(state.idx - 1);
    else if (k === 'Home') goto(0);
    else if (k === 'End') goto(rec.deck.slides.length - 1);
    else if (k === 'n' || k === 'N') state.present.notes.hidden = !state.present.notes.hidden;
    else if (k === 'Escape') closePresent();
    else return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onFullscreenChange() {
    if (state.present && !document.fullscreenElement && state.present.wasFullscreen) closePresent();
  }

  function openPresent() {
    if (!current()?.deck || state.present) return;
    const root = document.createElement('div');
    root.className = 'dk-present';
    root.innerHTML = `<div class="dk-present-stage"></div><pre class="dk-present-notes" hidden></pre>
      <div class="dk-present-bar"><button type="button" data-pv="prev">←</button><button type="button" data-pv="next">→</button><button type="button" data-pv="notes">備註 N</button><button type="button" data-pv="exit">離開 Esc</button></div>`;
    document.body.appendChild(root);
    document.body.classList.add('dk-presenting');
    state.present = { root, stage: root.querySelector('.dk-present-stage'), notes: root.querySelector('.dk-present-notes'), wasFullscreen: false };
    root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pv]');
      if (!b) {
        if (e.target.closest('.dk-present-stage')) goto(state.idx + 1);
        return;
      }
      if (b.dataset.pv === 'prev') goto(state.idx - 1);
      else if (b.dataset.pv === 'next') goto(state.idx + 1);
      else if (b.dataset.pv === 'notes') state.present.notes.hidden = !state.present.notes.hidden;
      else closePresent();
    });
    window.addEventListener('keydown', onPresentKey, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    root.requestFullscreen?.().then(
      () => {
        if (state.present) state.present.wasFullscreen = true;
      },
      () => {}
    );
    renderPresent();
  }

  function closePresent() {
    const p = state.present;
    if (!p) return;
    state.present = null;
    window.removeEventListener('keydown', onPresentKey, true);
    document.removeEventListener('fullscreenchange', onFullscreenChange);
    if (document.fullscreenElement) document.exitFullscreen?.().catch?.(() => {});
    p.root.remove();
    document.body.classList.remove('dk-presenting');
    els.viewer.focus({ preventScroll: true });
  }

  /** 刪掉沒有任何簡報引用的圖片（複製頁會共用同一張圖，所以不在移除當下刪） */
  function gcImages() {
    const used = imageIdsInDecks(state.decks);
    const unused = [...state.images.keys()].filter((id) => !used.has(id));
    unused.forEach((id) => state.images.delete(id));
    deleteDeckImages(unused).catch(() => {});
  }

  fmtBar = mountDeckFormatBar(q('#dkFmt'), els.stage, {
    getDeck: () => current()?.deck || null,
    getIndex: () => state.idx,
    images: state.images,
    toast,
    keyTarget: els.viewer,
    onChange: () => {
      persist();
      renderThumbs();
      renderStage();
    },
  });

  /* ---- 事件 ---- */
  q('#dkNew').addEventListener('click', createDeck);

  els.list.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del-deck]');
    if (del) {
      const rec = state.decks.find((d) => d.id === del.dataset.delDeck);
      if (!rec || !window.confirm(`刪除「${recLabel(rec)}」的簡報？`)) return;
      state.decks = state.decks.filter((d) => d.id !== rec.id);
      persistNow();
      gcImages();
      if (!state.decks.length) createDeck();
      else if (state.currentId === rec.id) select(state.decks[0].id);
      else renderList();
      return;
    }
    const item = e.target.closest('[data-deck]');
    if (item && item.dataset.deck !== state.currentId) select(item.dataset.deck);
  });

  els.fields.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    const rec = current();
    if (!el || !rec) return;
    rec.input[el.dataset.input] = el.value;
    persist();
    if (el.dataset.input === 'name' || el.dataset.input === 'demoAt') renderList();
  });

  els.importSel.addEventListener('change', () => {
    const it = (els.importSel._items || []).find((x) => x.key === els.importSel.value);
    const rec = current();
    els.importSel.value = '';
    if (!it || !rec) return;
    rec.input.raw = [rec.input.raw.trim(), it.text].filter(Boolean).join('\n\n');
    persist();
    renderInput();
    toast(`已帶入：${it.label}`);
  });

  els.course.addEventListener('input', () => saveCourseNotes(els.course.value));
  els.genTpl.addEventListener('click', generateTemplate);
  els.genAI.addEventListener('click', generateAI);
  els.apiKey.addEventListener('change', () => {
    const v = els.apiKey.value.trim();
    setApiKey?.(v);
    els.keyHint.textContent = describeApiKeyProblem(v) || '已儲存，再按一次「AI 產生簡報」';
  });

  els.thumbs.addEventListener('click', (e) => {
    const b = e.target.closest('[data-slide]');
    if (b) {
      goto(Number(b.dataset.slide));
      els.viewer.focus({ preventScroll: true });
    }
  });

  els.stage.addEventListener('input', (e) => {
    const el = e.target.closest('[data-path]');
    const rec = current();
    if (!el || !rec?.deck) return;
    const value = el.innerText.replace(/\n{3,}/g, '\n\n').trim();
    if (setByPath(rec.deck, el.dataset.path, value)) {
      if (el.dataset.path === `slides.${state.idx}.title` && state.idx === 0) {
        rec.deck.title = value || rec.deck.title;
        els.title.textContent = rec.deck.title;
      }
      persist();
      clearTimeout(els.stage._thumbT);
      const i = state.idx;
      els.stage._thumbT = setTimeout(() => updateThumb(i), 250);
    }
  });
  els.stage.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.closest('[data-path]')) {
      e.target.blur();
      els.viewer.focus({ preventScroll: true });
    }
  });

  els.notes.addEventListener('input', () => {
    const slide = current()?.deck?.slides[state.idx];
    if (!slide) return;
    slide.notes = els.notes.value;
    persist();
  });

  els.viewer.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') goto(state.idx + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') goto(state.idx - 1);
    else return;
    e.preventDefault();
  });

  els.style.addEventListener('change', () => {
    const deck = current()?.deck;
    if (!deck) return;
    deck.theme = { ...(deck.theme || {}), style: els.style.value };
    persist();
    renderViewer();
    if (state.present) renderPresent();
  });

  q('.dk-toolbar-actions').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dk]');
    const rec = current();
    if (!b || !rec?.deck) return;
    const act = b.dataset.dk;
    if (act === 'present') return openPresent();
    if (act === 'pptx') return downloadPptx(b);
    const slides = rec.deck.slides;
    if (act === 'up' || act === 'down') state.idx = moveSlide(rec.deck, state.idx, act === 'up' ? -1 : 1);
    else if (act === 'dup') {
      slides.splice(state.idx + 1, 0, normalizeSlide({ ...JSON.parse(JSON.stringify(slides[state.idx])), id: '' }));
      state.idx += 1;
    } else if (act === 'del') {
      if (slides.length <= 1) return toast('至少要留一頁');
      if (!window.confirm(`刪除第 ${state.idx + 1} 頁「${slides[state.idx].title || SLIDE_TYPE_LABELS[slides[state.idx].type]}」？`)) return;
      slides.splice(state.idx, 1);
    }
    persist();
    renderViewer();
    renderList();
  });

  window.addEventListener('beforeunload', () => {
    if (state.saveT) persistNow();
  });

  if (!state.decks.length) state.decks.unshift(newDeckRecord());
  state.currentId = state.decks[0].id;
  render();
  renderImport();
  loadAllDeckImages()
    .then((map) => {
      map.forEach((v, k) => state.images.set(k, v));
      gcImages();
      renderViewer();
      if (state.present) renderPresent();
    })
    .catch((e) => console.warn('deck images unavailable', e));

  return {
    activate() {
      renderImport();
      renderViewer();
    },
    syncApiKey(v) {
      els.apiKey.value = v || '';
    },
  };
}
