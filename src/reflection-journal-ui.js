/**
 * 每日三通自寫複盤 UI（開發 · 電訪模式）
 */
import {
  FIELD_MIN_LEN,
  JOURNAL_FIELD_LABELS,
  REQUIRED_CALLS_PER_DAY,
  countCompleteEntries,
  entryHasContent,
  getDayJournal,
  isAiAnalysisUnlocked,
  isEntryComplete,
  journalTrajectoryStats,
  listJournalDays,
  saveDayJournal,
  unlockStatusMessage,
} from './reflection-journal.js';
import { escapeHTML } from './utils.js';

export function initReflectionJournal(deps = {}) {
  const { onChange, getLinkedSource, showToast } = deps;
  const panel = document.getElementById('reflectionJournalPanel');
  const modal = document.getElementById('reflectionJournalModal');
  const trajectoryModal = document.getElementById('reflectionTrajectoryModal');
  if (!panel || !modal) return { refresh: () => {}, openModal: () => {} };

  const summaryEl = panel.querySelector('#rjSummary');
  const openBtn = panel.querySelector('#rjOpen');
  const formHost = modal.querySelector('#rjFormHost');
  const saveBtn = modal.querySelector('#rjSave');
  const closeBtn = modal.querySelector('#rjClose');
  const trajectoryOpenBtn = panel.querySelector('#rjTrajectoryOpen');
  const trajectoryCloseBtn = trajectoryModal?.querySelector('#rjtClose');
  const trajectoryStatsEl = trajectoryModal?.querySelector('#rjtStats');
  const trajectoryTimelineEl = trajectoryModal?.querySelector('#rjtTimeline');

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
    const trajectory = journalTrajectoryStats();
    if (summaryEl) {
      summaryEl.innerHTML = st.unlocked
        ? `<span class="rj-ok">今日 ${st.complete}/${st.required} 通自寫複盤已完成</span> — AI 單通分析已解鎖`
        : `<span class="rj-lock">今日 ${st.complete}/${st.required} 通</span> — 完成三通自寫複盤後，才會解鎖「AI 深度分析／AI 精修開發重點／一鍵開發重點」`;
      if (trajectory.days) {
        summaryEl.innerHTML += ` <span class="rj-archive-summary">· 已累積 ${trajectory.days} 天／${trajectory.writtenEntries} 通</span>`;
      }
    }
  }

  function fmtDate(dateKey) {
    const m = String(dateKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return dateKey;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `${Number(m[2])}/${Number(m[3])}（${weekday}）`;
  }

  function renderTrajectory() {
    if (!trajectoryStatsEl || !trajectoryTimelineEl) return;
    const days = listJournalDays();
    const stats = journalTrajectoryStats(days);
    trajectoryStatsEl.innerHTML = [
      ['累積複盤', `${stats.days} 天`],
      ['寫下', `${stats.writtenEntries} 通`],
      ['完整複盤', `${stats.completeEntries} 通`],
      ['最近連續', `${stats.recentStreak} 天`],
    ]
      .map(([label, value]) => `<div class="rjt-stat"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`)
      .join('');

    if (!days.length) {
      trajectoryTimelineEl.innerHTML = `
        <div class="rjt-empty">
          <strong>還沒有複盤紀錄</strong>
          <p class="hint">先完成今天的一通複盤；之後每一天都會留在這裡，形成自己的學習軌跡。</p>
        </div>`;
      return;
    }

    trajectoryTimelineEl.innerHTML = days
      .map((day, dayIndex) => {
        const written = day.entries.filter(entryHasContent);
        const complete = written.filter(isEntryComplete).length;
        const entries = written
          .map(
            (entry, i) => `<article class="rjt-entry ${isEntryComplete(entry) ? 'complete' : 'incomplete'}">
              <div class="rjt-entry-head">
                <span class="rjt-entry-num">CALL ${String(i + 1).padStart(2, '0')}</span>
                <strong>${escapeHTML(entry.callTitle || entry.linkedSource || '未命名通話')}</strong>
                <span class="rjt-entry-state">${isEntryComplete(entry) ? '完整' : '未完成'}</span>
              </div>
              <dl class="rjt-entry-fields">
                <div><dt>我做了什麼</dt><dd>${escapeHTML(entry.iDid || '—')}</dd></div>
                <div><dt>客戶怎麼回</dt><dd>${escapeHTML(entry.customerSaid || '—')}</dd></div>
                <div><dt>我的語氣／講法</dt><dd>${escapeHTML(entry.toneEffect || '—')}</dd></div>
                <div><dt>客戶可能在想</dt><dd>${escapeHTML(entry.customerMind || '—')}</dd></div>
              </dl>
            </article>`
          )
          .join('');
        return `<details class="rjt-day" ${dayIndex === 0 ? 'open' : ''}>
          <summary>
            <span class="rjt-date">${escapeHTML(fmtDate(day.dateKey))}</span>
            <span class="rjt-date-full">${escapeHTML(day.dateKey)}</span>
            <span class="rjt-day-count">${complete}/${written.length} 通完整</span>
            <span class="rjt-chevron" aria-hidden="true">⌄</span>
          </summary>
          <div class="rjt-day-entries">${entries}</div>
        </details>`;
      })
      .join('');
  }

  function openTrajectory() {
    renderTrajectory();
    if (trajectoryModal) trajectoryModal.hidden = false;
  }

  function closeTrajectory() {
    if (trajectoryModal) trajectoryModal.hidden = true;
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
  trajectoryOpenBtn?.addEventListener('click', openTrajectory);
  closeBtn?.addEventListener('click', closeModal);
  trajectoryCloseBtn?.addEventListener('click', closeTrajectory);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
  });
  trajectoryModal?.addEventListener('click', (e) => {
    if (e.target === trajectoryModal) closeTrajectory();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && trajectoryModal && !trajectoryModal.hidden) closeTrajectory();
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

  return {
    refresh: refreshSummary,
    openModal,
    openTrajectory,
    isUnlocked: () => isAiAnalysisUnlocked(),
  };
}
