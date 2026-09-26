/**
 * 每日三通自寫複盤 UI（開發 · 電訪模式）
 */
import {
  FIELD_MIN_LEN,
  JOURNAL_FIELD_LABELS,
  REQUIRED_CALLS_PER_DAY,
  countCompleteEntries,
  getDayJournal,
  isAiAnalysisUnlocked,
  saveDayJournal,
  unlockStatusMessage,
} from './reflection-journal.js';
import { escapeHTML } from './utils.js';

export function initReflectionJournal(deps = {}) {
  const { onChange, getLinkedSource, showToast } = deps;
  const panel = document.getElementById('reflectionJournalPanel');
  const modal = document.getElementById('reflectionJournalModal');
  if (!panel || !modal) return { refresh: () => {}, openModal: () => {} };

  const summaryEl = panel.querySelector('#rjSummary');
  const openBtn = panel.querySelector('#rjOpen');
  const formHost = modal.querySelector('#rjFormHost');
  const saveBtn = modal.querySelector('#rjSave');
  const closeBtn = modal.querySelector('#rjClose');

  let editing = getDayJournal();

  function renderForm() {
    editing = getDayJournal();
    const n = countCompleteEntries(editing);
    formHost.innerHTML = editing.entries
      .map(
        (e, i) => `
      <fieldset class="rj-entry" data-slot="${i}" data-linked-source="${escapeHTML(e.linkedSource || '')}">
        <legend>第 ${i + 1} 通 ${e.callTitle ? `· ${escapeHTML(e.callTitle)}` : ''}</legend>
        <label class="rj-field">通話名稱（選填，例：黃烱桐）
          <input type="text" class="field rj-callTitle" value="${escapeHTML(e.callTitle)}" autocomplete="off">
        </label>
        <label class="rj-field">${escapeHTML(JOURNAL_FIELD_LABELS.iDid)} <span class="hint">至少 ${FIELD_MIN_LEN} 字</span>
          <textarea class="field rj-iDid" rows="3">${escapeHTML(e.iDid)}</textarea>
        </label>
        <label class="rj-field">${escapeHTML(JOURNAL_FIELD_LABELS.customerSaid)}
          <textarea class="field rj-customerSaid" rows="3">${escapeHTML(e.customerSaid)}</textarea>
        </label>
        <label class="rj-field">${escapeHTML(JOURNAL_FIELD_LABELS.toneEffect)}
          <textarea class="field rj-toneEffect" rows="2">${escapeHTML(e.toneEffect)}</textarea>
        </label>
        <label class="rj-field">${escapeHTML(JOURNAL_FIELD_LABELS.customerMind)}
          <textarea class="field rj-customerMind" rows="2">${escapeHTML(e.customerMind)}</textarea>
        </label>
        <button type="button" class="btn rj-bind" data-slot="${i}">綁定目前這通逐字稿</button>
        ${e.linkedSource ? `<p class="hint rj-linked">已綁定：${escapeHTML(e.linkedSource)}</p>` : ''}
      </fieldset>`
      )
      .join('');
    formHost.querySelectorAll('.rj-bind').forEach((btn) => {
      btn.addEventListener('click', () => {
        const src = getLinkedSource?.();
        if (!src) {
          showToast?.('請先在上方載入逐字稿，再綁定');
          return;
        }
        const slot = Number(btn.dataset.slot);
        const fs = formHost.querySelector(`fieldset[data-slot="${slot}"]`);
        const title = fs?.querySelector('.rj-callTitle');
        if (title && !title.value.trim()) title.value = src.replace(/\.[^.]+$/, '').slice(0, 40);
        if (fs) fs.dataset.linkedSource = src;
        showToast?.('已綁定檔名（儲存後生效）');
      });
    });
  }

  function readForm() {
    return editing.entries.map((base, i) => {
      const fs = formHost.querySelector(`fieldset[data-slot="${i}"]`);
      if (!fs) return base;
      const bindBtn = fs.querySelector('.rj-bind');
      return {
        ...base,
        callTitle: fs.querySelector('.rj-callTitle')?.value || '',
        linkedSource: fs.dataset.linkedSource || base.linkedSource || '',
        iDid: fs.querySelector('.rj-iDid')?.value || '',
        customerSaid: fs.querySelector('.rj-customerSaid')?.value || '',
        toneEffect: fs.querySelector('.rj-toneEffect')?.value || '',
        customerMind: fs.querySelector('.rj-customerMind')?.value || '',
      };
    });
  }

  function refreshSummary() {
    const st = unlockStatusMessage();
    if (summaryEl) {
      summaryEl.innerHTML = st.unlocked
        ? `<span class="rj-ok">今日 ${st.complete}/${st.required} 通自寫複盤已完成</span> — AI 單通分析已解鎖`
        : `<span class="rj-lock">今日 ${st.complete}/${st.required} 通</span> — 完成三通自寫複盤後，才會解鎖「AI 深度分析／AI 精修開發重點／一鍵開發重點」`;
    }
    onChange?.(st);
  }

  function openModal() {
    renderForm();
    modal.hidden = false;
  }

  function closeModal() {
    modal.hidden = true;
    refreshSummary();
  }

  openBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  saveBtn?.addEventListener('click', () => {
    const entries = readForm();
    saveDayJournal(editing.dateKey, entries);
    showToast?.(
      isAiAnalysisUnlocked()
        ? `已儲存 — 今日 ${REQUIRED_CALLS_PER_DAY} 通複盤完成，AI 分析已解鎖`
        : `已儲存 — 完成 ${REQUIRED_CALLS_PER_DAY} 通後解鎖 AI（目前 ${countCompleteEntries(getDayJournal())}/${REQUIRED_CALLS_PER_DAY}）`
    );
    refreshSummary();
    onChange?.(unlockStatusMessage());
  });

  refreshSummary();

  return { refresh: refreshSummary, openModal, isUnlocked: () => isAiAnalysisUnlocked() };
}
