/** 首頁：每位客戶一條進度條（建客戶 → 簡報 → DEMO → 錄影分析 → 複盤），點一下回到那位客戶。 */
import { dueFollowUps, loadCustomerProgress } from './customer-progress.js';
import { escapeHTML } from './utils.js';

const COLLAPSED_COUNT = 6;
const FOLLOW_TEXT = { overdue: '跟進已過期', today: '今天跟進', nodate: '未填跟進日', upcoming: '' };

const DUE_LIMIT = 5;

function dueLabel(c) {
  if (c.followUp === 'today') return '今天';
  if (c.followUp === 'overdue') return `過期 ${c.overdueDays} 天`;
  return '未填日期';
}

/**
 * @param {HTMLElement} container  客戶進度條
 * @param {{ onOpen?: (item:object)=>void, dueContainer?: HTMLElement }} [opts]
 *   dueContainer：首頁上方的「今天該跟進」清單（不給就不顯示）
 */
export function mountCustomerProgress(container, { onOpen, dueContainer } = {}) {
  if (!container) return { refresh() {} };
  let expanded = false;
  let items = [];

  function itemHtml(c) {
    const follow = FOLLOW_TEXT[c.followUp];
    const meta = [
      c.outcomeLabel && `<span class="cp-badge ${c.outcome === 'closed' ? 'ok' : c.outcome === 'declined' || c.outcome === 'notfit' ? 'muted' : ''}">${escapeHTML(c.outcomeLabel)}</span>`,
      follow && `<span class="cp-badge warn">${follow}</span>`,
      c.followUp === 'upcoming' && c.followUpDate && `<span class="cp-badge">${escapeHTML(c.followUpDate)} 跟進</span>`,
    ]
      .filter(Boolean)
      .join('');
    return `<li>
      <button type="button" class="cp-item${c.done === c.stages.length ? ' complete' : ''}" data-cp="${escapeHTML(c.key)}" aria-label="${escapeHTML(`${c.name}，進度 ${c.percent}%`)}">
        <span class="cp-top"><b class="cp-name">${escapeHTML(c.name)}</b>${meta}<span class="cp-pct">${c.percent}%</span></span>
        <span class="cp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${c.percent}">
          ${c.stages.map((s) => `<i class="${s.done ? 'on' : ''}"></i>`).join('')}
        </span>
        <span class="cp-stages">${c.stages.map((s) => `<span class="${s.done ? 'on' : ''}">${escapeHTML(s.label)}</span>`).join('')}</span>
        ${c.next ? `<span class="cp-next">下一步：${escapeHTML(c.next)}</span>` : '<span class="cp-next ok">這位客戶的流程都走完了</span>'}
      </button>
    </li>`;
  }

  function renderDue() {
    if (!dueContainer) return;
    const due = dueFollowUps(items);
    dueContainer.hidden = !due.length;
    if (!due.length) {
      dueContainer.innerHTML = '';
      return;
    }
    const rows = due
      .slice(0, DUE_LIMIT)
      .map(
        (c) => `<li><button type="button" class="cp-due-item" data-cp-due="${escapeHTML(c.key)}">
          <span class="cp-due-when ${c.followUp}">${dueLabel(c)}</span>
          <b>${escapeHTML(c.name)}</b>
          <span class="cp-due-step">${c.nextStep ? escapeHTML(c.nextStep) : '還沒寫下一步'}</span>
          <span class="cp-due-date">${c.followUpDate ? escapeHTML(c.followUpDate) : '補上跟進日期 →'}</span>
        </button></li>`
      )
      .join('');
    dueContainer.innerHTML = `
      <div class="cp-head"><h3>今天該跟進 <small>${due.length} 位${due.length > DUE_LIMIT ? `（顯示前 ${DUE_LIMIT} 位）` : ''}</small></h3></div>
      <ul class="cp-due-list">${rows}</ul>`;
  }

  function render() {
    items = loadCustomerProgress();
    renderDue();
    container.hidden = !items.length;
    if (!items.length) {
      container.innerHTML = '';
      return;
    }
    const due = items.filter((c) => ['overdue', 'today', 'nodate'].includes(c.followUp)).length;
    const shown = expanded ? items : items.slice(0, COLLAPSED_COUNT);
    container.innerHTML = `
      <div class="cp-head">
        <h3>客戶進度 <small>${items.length} 位${due ? `・<em>${due} 位該跟進</em>` : ''}</small></h3>
      </div>
      <ul class="cp-list">${shown.map(itemHtml).join('')}</ul>
      ${items.length > COLLAPSED_COUNT ? `<button type="button" class="cp-more" data-cp-more>${expanded ? '收合' : `顯示全部 ${items.length} 位`}</button>` : ''}`;
  }

  container.addEventListener('click', (e) => {
    if (e.target.closest('[data-cp-more]')) {
      expanded = !expanded;
      render();
      return;
    }
    const btn = e.target.closest('[data-cp]');
    const item = btn && items.find((c) => c.key === btn.dataset.cp);
    if (item) onOpen?.(item);
  });

  dueContainer?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cp-due]');
    const item = btn && items.find((c) => c.key === btn.dataset.cpDue);
    if (item) onOpen?.(item);
  });

  render();
  return { refresh: render };
}
