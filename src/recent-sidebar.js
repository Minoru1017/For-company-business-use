/**
 * 主工作區左側欄：最近逐字稿／分析（本機 localStorage，類 Vibe「最近項目」）
 */
import { clearHistory, deleteHistory, historyItemSubtitle, listHistory } from './history.js';
import { escapeHTML } from './utils.js';

export function initRecentSidebar({
  onOpen,
  onGoHome,
  onNewUpload,
  getCurrentId,
  onAfterDelete,
  showToast,
}) {
  const sidebar = document.getElementById('appSidebar');
  const listEl = document.getElementById('sidebarRecentList');
  const searchEl = document.getElementById('sidebarSearch');
  const emptyEl = document.getElementById('sidebarRecentEmpty');
  if (!sidebar || !listEl) return { refresh: () => {} };

  let filter = '';

  function render() {
    const q = filter.trim().toLowerCase();
    const items = listHistory().filter((h) => !q || (h.source || '').toLowerCase().includes(q));
    const currentId = getCurrentId?.() || null;
    if (emptyEl) emptyEl.hidden = items.length > 0;
    listEl.innerHTML = items
      .map((h) => {
        const title = (h.source || 'transcript').replace(/^.*[/\\]/, '');
        const sub = historyItemSubtitle(h);
        return `<li>
          <button type="button" class="app-sidebar-item ${h.id === currentId ? 'current' : ''}" data-id="${escapeHTML(h.id)}" title="${escapeHTML(h.source || '')}">
            <span class="app-sidebar-item-title">${escapeHTML(title)}</span>
            <span class="app-sidebar-item-sub">${escapeHTML(sub)}</span>
          </button>
        </li>`;
      })
      .join('');
  }

  function setDrawer(open) {
    document.body.classList.toggle('sidebar-open', open);
    const scrim = document.getElementById('sidebarScrim');
    if (scrim) scrim.hidden = !open;
    document.getElementById('sidebarMenu')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    setDrawer(false);
    onOpen?.(btn.dataset.id);
  });

  listEl.addEventListener('keydown', (e) => {
    const btn = e.target.closest('[data-id]');
    if (!btn || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    if (e.target.tagName === 'INPUT') return;
    e.preventDefault();
    deleteHistory(btn.dataset.id);
    onAfterDelete?.(btn.dataset.id);
    render();
    showToast?.('已刪除這筆紀錄');
  });

  searchEl?.addEventListener('input', () => {
    filter = searchEl.value;
    render();
  });

  document.getElementById('sidebarHome')?.addEventListener('click', () => {
    setDrawer(false);
    onGoHome?.();
  });
  const newUpload = () => {
    setDrawer(false);
    onNewUpload?.();
  };
  document.getElementById('sidebarNew')?.addEventListener('click', newUpload);
  document.getElementById('topbarNew')?.addEventListener('click', newUpload);
  document.getElementById('sidebarMenu')?.addEventListener('click', () => {
    setDrawer(!document.body.classList.contains('sidebar-open'));
  });
  document.getElementById('sidebarScrim')?.addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.body.classList.contains('sidebar-open')) setDrawer(false);
  });
  document.getElementById('sidebarClear')?.addEventListener('click', () => {
    if (!listHistory().length) return;
    if (!confirm('清空所有最近項目？（只影響這台電腦的瀏覽器）')) return;
    clearHistory();
    onAfterDelete?.(null);
    render();
    showToast?.('已清空最近項目');
  });

  document.getElementById('sidebarCollapse')?.addEventListener('click', () => {
    if (document.body.classList.contains('sidebar-open')) {
      setDrawer(false);
      return;
    }
    document.body.classList.toggle('sidebar-collapsed');
    try {
      localStorage.setItem('callCoachSidebarCollapsed', document.body.classList.contains('sidebar-collapsed') ? '1' : '0');
    } catch {
      /* ignore */
    }
  });

  try {
    if (localStorage.getItem('callCoachSidebarCollapsed') === '1') document.body.classList.add('sidebar-collapsed');
  } catch {
    /* ignore */
  }

  render();
  return { refresh: render };
}
