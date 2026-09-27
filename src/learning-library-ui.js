import { DAY_TYPES, getDayType, setDayType } from './day-type.js';
import {
  FIELD_MIN,
  addLearningEntry,
  deleteLearningEntry,
  hasLearningForDate,
  isLearningEntryComplete,
  learningStats,
  listLearningEntries,
} from './learning-library.js';
import { escapeHTML } from './utils.js';

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function initDayTypeHome(deps = {}) {
  const { showToast, onDayTypeChange } = deps;
  const toggleHost = document.getElementById('dayTypeToggle');
  const offPanel = document.getElementById('learningOffDayPanel');
  const modeCards = document.querySelector('.mode-cards');
  const modeLead = document.querySelector('.mode-chooser-lead');
  if (!toggleHost) return { refresh: () => {}, isOffDay: () => false, canEnterWorkModes: () => true };

  let type = getDayType();

  function renderToggle() {
    toggleHost.innerHTML = `
      <p class="day-type-label">今天你是</p>
      <div class="day-type-btns" role="group" aria-label="上班日或非上班日">
        ${Object.values(DAY_TYPES)
          .map(
            (t) =>
              `<button type="button" class="day-type-btn ${type === t.key ? 'active' : ''}" data-day-type="${t.key}">${t.label}</button>`
          )
          .join('')}
      </div>
      <p class="hint day-type-hint">${escapeHTML(DAY_TYPES[type].hint)}</p>`;
    toggleHost.querySelectorAll('[data-day-type]').forEach((btn) => {
      btn.addEventListener('click', () => {
        type = setDayType(btn.dataset.dayType);
        renderToggle();
        applyLayout();
        onDayTypeChange?.(type);
      });
    });
  }

  function renderOffPanel() {
    if (!offPanel) return;
    const doneToday = hasLearningForDate(todayKey());
    const stats = learningStats();
    const entries = listLearningEntries().filter(isLearningEntryComplete).slice(0, 30);

    offPanel.innerHTML = `
      <div class="learning-off card">
        <h3 class="learning-off-title">非上班日 · 學習進度庫</h3>
        <p class="hint">請自行找<strong>近期 AI 發展趨勢</strong>與<strong>銷售技巧</strong>相關影片（YouTube、課程平台等皆可），看完後填寫——這是 Terry 說的「輸入」，但要寫成<strong>你自己的話</strong>才會進步。</p>
        ${doneToday ? '<p class="learning-off-ok">今日學習紀錄已完成，以下可繼續新增或瀏覽進度庫。</p>' : '<p class="learning-off-warn">今日尚未完成學習紀錄：填完下方表單後，才會解鎖下方工作流程（或改選「上班日」）。</p>'}
        <form class="learning-form" id="learningForm">
          <label>影片連結（選填其一：連結或標題）
            <input type="url" class="field" name="videoUrl" placeholder="https://…" autocomplete="off">
          </label>
          <label>影片標題／頻道
            <input type="text" class="field" name="videoTitle" placeholder="例：某某：2025 AI Agent 趨勢" autocomplete="off">
          </label>
          <label>AI 趨勢：你學到什麼？ <span class="hint">至少 ${FIELD_MIN} 字</span>
            <textarea class="field" name="aiTakeaway" rows="3" placeholder="這支影片對「最新 AI 發展」的重點是…"></textarea>
          </label>
          <label>銷售技巧：你學到什麼？ <span class="hint">至少 ${FIELD_MIN} 字</span>
            <textarea class="field" name="salesTakeaway" rows="3" placeholder="可以怎麼用在電訪／邀約／挖需求…"></textarea>
          </label>
          <label>總結：今天這份輸入，對我下一通電話的改變是？ <span class="hint">至少 ${FIELD_MIN} 字</span>
            <textarea class="field" name="learnedSummary" rows="3" placeholder="我明天要試的一個具體動作…"></textarea>
          </label>
          <button type="submit" class="btn primary">存入學習進度庫</button>
        </form>
        <div class="learning-stats hint">進度庫：${stats.total} 筆紀錄 · ${stats.days} 個學習日</div>
        <details class="learning-lib" ${entries.length ? 'open' : ''}>
          <summary>我的學習進度庫（${entries.length}）</summary>
          <ul class="learning-list">
            ${entries.length ? entries.map(renderEntryLi).join('') : '<li class="hint">尚無紀錄</li>'}
          </ul>
        </details>
      </div>`;

    offPanel.querySelector('#learningForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        addLearningEntry({
          dateKey: todayKey(),
          videoUrl: fd.get('videoUrl'),
          videoTitle: fd.get('videoTitle'),
          aiTakeaway: fd.get('aiTakeaway'),
          salesTakeaway: fd.get('salesTakeaway'),
          learnedSummary: fd.get('learnedSummary'),
        });
        showToast?.('已存入學習進度庫');
        renderOffPanel();
        applyLayout();
        onDayTypeChange?.(getDayType());
      } catch {
        showToast?.(`請填完整：影片連結或標題、三段心得各至少 ${FIELD_MIN} 字`);
      }
    });

    offPanel.querySelectorAll('[data-del-learning]').forEach((btn) => {
      btn.addEventListener('click', () => {
        deleteLearningEntry(btn.dataset.delLearning);
        showToast?.('已刪除');
        renderOffPanel();
        applyLayout();
        onDayTypeChange?.(getDayType());
      });
    });
  }

  function renderEntryLi(e) {
    const title = e.videoTitle || e.videoUrl || '（未命名）';
    const link = e.videoUrl ? `<a href="${escapeHTML(e.videoUrl)}" target="_blank" rel="noopener noreferrer">開啟</a>` : '';
    return `<li class="learning-item">
      <div class="learning-item-head"><b>${escapeHTML(e.dateKey)}</b> ${escapeHTML(title)} ${link}
        <button type="button" class="btn slog-mini" data-del-learning="${escapeHTML(e.id)}">刪除</button></div>
      <div class="learning-item-body"><span class="tag">AI</span>${escapeHTML(e.aiTakeaway.slice(0, 120))}${e.aiTakeaway.length > 120 ? '…' : ''}</div>
      <div class="learning-item-body"><span class="tag">銷售</span>${escapeHTML(e.salesTakeaway.slice(0, 120))}${e.salesTakeaway.length > 120 ? '…' : ''}</div>
    </li>`;
  }

  function applyLayout() {
    type = getDayType();
    const off = type === 'off';
    if (offPanel) {
      offPanel.hidden = !off;
      if (off) renderOffPanel();
    }
    if (modeCards) modeCards.classList.toggle('day-type-gated', off && !hasLearningForDate(todayKey()));
    if (modeLead) {
      modeLead.innerHTML = off
        ? '非上班日：<b>先完成學習紀錄</b>（AI 趨勢＋銷售技巧影片心得），再進工具也不遲。'
        : '同一套工具，圍繞<b>做 → 聽自己 → 找問題 → 再做</b>——不是用 AI 代替你想。';
    }
  }

  function refresh() {
    renderToggle();
    applyLayout();
  }

  renderToggle();
  applyLayout();

  return {
    refresh,
    isOffDay: () => getDayType() === 'off',
    canEnterWorkModes: () => getDayType() !== 'off' || hasLearningForDate(todayKey()),
  };
}
