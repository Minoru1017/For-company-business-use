import {
  beginGoogleSignIn,
  normalizeAccount,
  refreshGoogleAccount,
  signOutGoogleAccount,
} from '../lib/google-account.js';
import { enrichPageWithLogo, resolveSlotLogo } from '../lib/logo.js';
import {
  assignOpenTarget,
  clampSplitRatio,
  closeViewerPane,
  createViewerState,
  pageFromSlot,
  ratioFromPointer,
  setViewerMode,
} from '../lib/viewer.js';
import {
  MAX_AREAS,
  WORKSPACE_KEY,
  addPageToFirstEmptySlot,
  createHomepageArea,
  createEmptySlot,
  getAreaWorkspace,
  getRoutinePlan,
  getWorkspaceGroups,
  getWorkspaceRoutines,
  moveSlot,
  normalizeHomepage,
  normalizeSlot,
  normalizeWebUrl,
  normalizeWorkspace,
  updateAreaWorkspace,
} from '../lib/workspace.js';

const elements = {
  areaTabs: document.querySelector('#area-tabs'),
  addAreaButton: document.querySelector('#add-area-button'),
  activeAreaName: document.querySelector('#active-area-name'),
  openTabList: document.querySelector('#open-tab-list'),
  openTabEmpty: document.querySelector('#open-tab-empty'),
  googleSignInButton: document.querySelector('#google-signin-button'),
  accountChip: document.querySelector('#account-chip'),
  accountAvatar: document.querySelector('#account-avatar'),
  accountName: document.querySelector('#account-name'),
  accountEmail: document.querySelector('#account-email'),
  googleSignOutButton: document.querySelector('#google-signout-button'),
  grid: document.querySelector('#slot-grid'),
  savedCount: document.querySelector('#saved-count'),
  groupFilters: document.querySelector('#group-filters'),
  routineSelect: document.querySelector('#routine-select'),
  routineButton: document.querySelector('#run-routine-button'),
  routineSummary: document.querySelector('#routine-summary'),
  slotDialog: document.querySelector('#slot-dialog'),
  slotForm: document.querySelector('#slot-form'),
  slotNumber: document.querySelector('#dialog-slot-number'),
  slotTitle: document.querySelector('#slot-title'),
  slotUrl: document.querySelector('#slot-url'),
  slotGroup: document.querySelector('#slot-group'),
  slotRoutine: document.querySelector('#slot-routine'),
  slotStep: document.querySelector('#slot-step'),
  groupOptions: document.querySelector('#group-options'),
  routineOptions: document.querySelector('#routine-options'),
  deleteButton: document.querySelector('#delete-slot-button'),
  dialogError: document.querySelector('#dialog-error'),
  helpButton: document.querySelector('#help-button'),
  helpDialog: document.querySelector('#help-dialog'),
  areaDialog: document.querySelector('#area-dialog'),
  areaForm: document.querySelector('#area-form'),
  areaName: document.querySelector('#area-name'),
  toast: document.querySelector('#toast'),
  embeddedViewer: document.querySelector('#embedded-viewer'),
  viewerStage: document.querySelector('#viewer-stage'),
  viewerHeading: document.querySelector('#viewer-heading'),
  viewerModeSingle: document.querySelector('#viewer-mode-single'),
  viewerModeSplit: document.querySelector('#viewer-mode-split'),
  viewerOpenTab: document.querySelector('#viewer-open-tab'),
  viewerClose: document.querySelector('#viewer-close'),
  viewerDivider: document.querySelector('#viewer-divider'),
  viewerLeftTitle: document.querySelector('#viewer-left-title'),
  viewerRightTitle: document.querySelector('#viewer-right-title'),
  viewerLeftFrame: document.querySelector('#viewer-left-frame'),
  viewerRightFrame: document.querySelector('#viewer-right-frame'),
  viewerLeftEmpty: document.querySelector('#viewer-left-empty'),
  viewerRightEmpty: document.querySelector('#viewer-right-empty'),
  viewerLeftBlocked: document.querySelector('#viewer-left-blocked'),
  viewerRightBlocked: document.querySelector('#viewer-right-blocked'),
  viewerLeftPane: document.querySelector('.viewer-pane[data-pane="left"]'),
  viewerRightPane: document.querySelector('.viewer-pane[data-pane="right"]'),
  viewerSlotRail: document.querySelector('#viewer-slot-rail'),
};

let homepage = normalizeHomepage();
let workspace = normalizeWorkspace();
let openTabs = [];
let selectedGroup = '';
let editingIndex = -1;
let draggedIndex = -1;
let toastTimer = null;
let googleAccount = { signedIn: false, email: '', id: '', name: '', picture: '' };
let viewerState = createViewerState();
let viewerResizeBound = null;

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add('is-visible');
  toastTimer = setTimeout(() => elements.toast.classList.remove('is-visible'), 2200);
}

async function saveWorkspace(message = '') {
  homepage = updateAreaWorkspace(homepage, homepage.activeAreaId, workspace);
  await chrome.storage.local.set({ [WORKSPACE_KEY]: homepage });
  if (message) showToast(message);
}

function makeEditIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M11.7 4.3 15.7 8.3M3.5 16.5l2.9-.6 9.9-9.9a1.4 1.4 0 0 0 0-2l-.3-.3a1.4 1.4 0 0 0-2 0l-9.9 9.9-.6 2.9Z',
  );
  svg.append(path);
  return svg;
}

function createMetaChip(text, className = '') {
  const chip = document.createElement('span');
  chip.className = `meta-chip ${className}`.trim();
  chip.textContent = text;
  return chip;
}

function currentArea() {
  return homepage.areas.find((area) => area.id === homepage.activeAreaId) ?? homepage.areas[0];
}

function pageFromTransfer(dataTransfer) {
  try {
    const custom = dataTransfer.getData('application/x-homepage-tab');
    if (custom) {
      const parsed = JSON.parse(custom);
      const url = normalizeWebUrl(parsed.url);
      if (url) return normalizeSlot({ ...parsed, url });
    }
  } catch {
    // Continue with standard URL drag formats.
  }

  const uri = dataTransfer
    .getData('text/uri-list')
    .split(/\r?\n/)
    .find((line) => line && !line.startsWith('#'));
  const plain = dataTransfer.getData('text/plain');
  const url = normalizeWebUrl(uri || plain);
  return url ? normalizeSlot({ url, title: safeHostname(url) }) : null;
}

function renderAccountPanel() {
  if (googleAccount.signedIn) {
    elements.googleSignInButton.hidden = true;
    elements.accountChip.hidden = false;
    elements.accountEmail.textContent = googleAccount.email || '已登入 Google 帳號';
    elements.accountName.textContent = googleAccount.name || 'Google 帳號';
    if (googleAccount.picture) {
      const image = document.createElement('img');
      image.src = googleAccount.picture;
      image.alt = '';
      image.width = 28;
      image.height = 28;
      elements.accountAvatar.replaceChildren(image);
    } else {
      const initial = (googleAccount.email || 'G').slice(0, 1).toUpperCase();
      elements.accountAvatar.replaceChildren(document.createTextNode(initial));
    }
    return;
  }
  elements.googleSignInButton.hidden = false;
  elements.accountChip.hidden = true;
}

async function syncGoogleAccount(options = {}) {
  googleAccount = await refreshGoogleAccount();
  renderAccountPanel();
  if (options.announce && googleAccount.signedIn) {
    showToast(`已登入：${googleAccount.email}`);
  }
  return googleAccount;
}

async function addPage(page, targetIndex = -1) {
  const normalizedPage = normalizeSlot(enrichPageWithLogo(page));
  if (!normalizedPage.url) {
    showToast('這個項目不是可加入的網頁。');
    return false;
  }

  let addedIndex = targetIndex;
  if (targetIndex >= 0 && !workspace.slots[targetIndex].url) {
    workspace.slots[targetIndex] = normalizedPage;
  } else {
    const result = addPageToFirstEmptySlot(workspace, normalizedPage);
    workspace = result.workspace;
    addedIndex = result.index;
  }
  if (addedIndex < 0) {
    showToast(`${currentArea().name}的 16 個位置都已使用。`);
    return false;
  }
  await saveWorkspace(`已加入${currentArea().name}第 ${addedIndex + 1} 格。`);
  render();
  return true;
}

function createTabFavicon(tab) {
  const icon = document.createElement('span');
  icon.className = 'tab-favicon';
  if (tab.favIconUrl && /^(?:data:image|https?:)/.test(tab.favIconUrl)) {
    const image = document.createElement('img');
    image.src = tab.favIconUrl;
    image.alt = '';
    image.width = 18;
    image.height = 18;
    image.addEventListener('error', () => {
      icon.replaceChildren(document.createTextNode(safeHostname(tab.url).slice(0, 1) || 'W'));
    });
    icon.append(image);
  } else {
    icon.textContent = safeHostname(tab.url).slice(0, 1) || 'W';
  }
  return icon;
}

function tabPage(tab) {
  return enrichPageWithLogo({
    url: tab.url,
    title: tab.title || safeHostname(tab.url),
    favicon: tab.favIconUrl || '',
  });
}

function bindTabPointerDrag(item, page) {
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let target = null;

  function clearTarget() {
    target?.classList.remove('is-external-drop-target');
    target = null;
  }

  item.addEventListener('pointerdown', (event) => {
    if (
      event.pointerType !== 'mouse' ||
      event.button !== 0 ||
      event.target.closest('button')
    ) {
      return;
    }
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    item.setPointerCapture(pointerId);
  });

  item.addEventListener('pointermove', (event) => {
    if (event.pointerId !== pointerId) return;
    const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
    if (distance < 7 && !item.classList.contains('is-dragging')) return;
    event.preventDefault();
    item.classList.add('is-dragging');
    const nextTarget = document.elementFromPoint(event.clientX, event.clientY)?.closest('.empty-slot');
    if (nextTarget === target) return;
    clearTarget();
    target = nextTarget;
    target?.classList.add('is-external-drop-target');
  });

  item.addEventListener('pointerup', async (event) => {
    if (event.pointerId !== pointerId) return;
    const droppedTarget = target;
    const wasDragging = item.classList.contains('is-dragging');
    clearTarget();
    item.classList.remove('is-dragging');
    item.releasePointerCapture(pointerId);
    pointerId = null;
    if (!wasDragging || !droppedTarget) return;
    const index = Number.parseInt(droppedTarget.dataset.index, 10);
    if (Number.isInteger(index)) await addPage(page, index);
  });

  item.addEventListener('pointercancel', () => {
    clearTarget();
    item.classList.remove('is-dragging');
    pointerId = null;
  });
}

function renderOpenTabs() {
  const fragment = document.createDocumentFragment();
  openTabs.forEach((tab) => {
    const item = document.createElement('article');
    item.className = 'open-tab-item';
    item.dataset.tabId = tab.id;
    item.setAttribute('aria-label', `拖曳 ${tab.title} 到空槽`);

    const copy = document.createElement('span');
    copy.className = 'tab-item-copy';
    const title = document.createElement('span');
    title.className = 'tab-item-title';
    title.textContent = tab.title || '未命名分頁';
    title.title = tab.title || '';
    const host = document.createElement('span');
    host.className = 'tab-item-host';
    host.textContent = safeHostname(tab.url);
    copy.append(title, host);

    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.className = 'tab-add-button';
    addButton.textContent = '+';
    addButton.setAttribute('aria-label', `將 ${tab.title} 加入${currentArea().name}`);
    addButton.addEventListener('click', () => addPage(tabPage(tab)));

    item.append(createTabFavicon(tab), copy, addButton);
    bindTabPointerDrag(item, tabPage(tab));
    fragment.append(item);
  });
  elements.openTabList.replaceChildren(fragment);
  elements.openTabEmpty.hidden = openTabs.length > 0;
}

async function refreshOpenTabs() {
  const dashboardUrl = chrome.runtime.getURL('dashboard/dashboard.html');
  const tabs = await chrome.tabs.query({ currentWindow: true });
  openTabs = tabs.filter(
    (tab) => normalizeWebUrl(tab.url) && !String(tab.url).startsWith(dashboardUrl),
  );
  renderOpenTabs();
}

function renderAreaTabs() {
  const fragment = document.createDocumentFragment();
  homepage.areas.forEach((area) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `area-tab${area.id === homepage.activeAreaId ? ' is-active' : ''}`;
    button.textContent = area.name;
    button.setAttribute('aria-pressed', String(area.id === homepage.activeAreaId));
    button.addEventListener('click', async () => {
      homepage = updateAreaWorkspace(homepage, homepage.activeAreaId, workspace);
      homepage.activeAreaId = area.id;
      workspace = getAreaWorkspace(homepage, area.id);
      selectedGroup = '';
      await chrome.storage.local.set({ [WORKSPACE_KEY]: homepage });
      render();
    });
    fragment.append(button);
  });
  elements.areaTabs.replaceChildren(fragment);
  elements.addAreaButton.disabled = homepage.areas.length >= MAX_AREAS;
  elements.activeAreaName.textContent = currentArea().name;
}

async function reorderSlot(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= workspace.slots.length || fromIndex === toIndex) return;
  workspace = moveSlot(workspace, fromIndex, toIndex);
  await saveWorkspace('首頁位置已更新。');
  render();
}

function createReorderControls(index) {
  const controls = document.createElement('div');
  controls.className = 'slot-reorder-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', `調整第 ${index + 1} 槽位置`);

  const previousButton = document.createElement('button');
  previousButton.type = 'button';
  previousButton.className = 'reorder-button';
  previousButton.textContent = '←';
  previousButton.disabled = index === 0;
  previousButton.title = '向前移一格';
  previousButton.setAttribute('aria-label', `將第 ${index + 1} 槽向前移一格`);
  previousButton.addEventListener('click', () => reorderSlot(index, index - 1));

  const nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.className = 'reorder-button';
  nextButton.textContent = '→';
  nextButton.disabled = index === workspace.slots.length - 1;
  nextButton.title = '向後移一格';
  nextButton.setAttribute('aria-label', `將第 ${index + 1} 槽向後移一格`);
  nextButton.addEventListener('click', () => reorderSlot(index, index + 1));

  controls.append(previousButton, nextButton);
  return controls;
}

async function ensureEmbedAllow() {
  try {
    await chrome.runtime.sendMessage({ type: 'ensureEmbedAllow' });
  } catch {
    /* background may be restarting; rules reinstall on startup */
  }
}

function setPaneBlocked(blockedEl, isBlocked) {
  if (!blockedEl) return;
  blockedEl.hidden = !isBlocked;
}

function probeFrameBlocked(frame) {
  try {
    const href = String(frame.contentWindow?.location?.href ?? '');
    if (!href || href === 'about:blank') return true;
    if (href.startsWith('chrome-error://') || href.startsWith('chrome://')) return true;
    const text = String(frame.contentDocument?.body?.innerText ?? '');
    if (/拒絕連線|refused to connect|ERR_BLOCKED_BY_RESPONSE|拒絕連接/i.test(text)) {
      return true;
    }
    return false;
  } catch {
    // Cross-origin access denied usually means the remote page loaded.
    return false;
  }
}

function watchFrameLoad(frame, blockedEl) {
  const token = String(Date.now());
  frame.dataset.loadToken = token;
  setPaneBlocked(blockedEl, false);

  const finish = () => {
    if (frame.dataset.loadToken !== token) return;
    setPaneBlocked(blockedEl, probeFrameBlocked(frame));
  };

  frame.addEventListener('load', finish, { once: true });
  window.setTimeout(finish, 2800);
}

function syncPaneFrame(frame, empty, blockedEl, page) {
  if (!page) {
    frame.hidden = true;
    frame.removeAttribute('src');
    delete frame.dataset.url;
    delete frame.dataset.loadToken;
    empty.hidden = false;
    setPaneBlocked(blockedEl, false);
    return;
  }
  empty.hidden = true;
  frame.hidden = false;
  if (frame.dataset.url !== page.url) {
    frame.dataset.url = page.url;
    watchFrameLoad(frame, blockedEl);
    frame.src = page.url;
  }
}

function renderViewerRail() {
  const fragment = document.createDocumentFragment();
  workspace.slots.forEach((slot, index) => {
    if (!slot.url) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'viewer-slot-chip';
    const openHere =
      viewerState.left?.url === slot.url || viewerState.right?.url === slot.url;
    if (openHere) button.classList.add('is-open');
    button.title = slot.url;
    button.dataset.openSlotIndex = String(index);
    const mark = document.createElement('strong');
    mark.textContent = String(index + 1).padStart(2, '0');
    const label = document.createElement('span');
    label.textContent = slot.title;
    button.append(mark, label);
    fragment.append(button);
  });
  elements.viewerSlotRail.replaceChildren(fragment);
}

function renderViewer() {
  const open = Boolean(viewerState.open && viewerState.left);
  elements.embeddedViewer.hidden = !open;
  elements.embeddedViewer.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (!open) {
    syncPaneFrame(elements.viewerLeftFrame, elements.viewerLeftEmpty, elements.viewerLeftBlocked, null);
    syncPaneFrame(
      elements.viewerRightFrame,
      elements.viewerRightEmpty,
      elements.viewerRightBlocked,
      null,
    );
    elements.viewerSlotRail.replaceChildren();
    return;
  }

  const split = viewerState.mode === 'split';
  elements.viewerStage.dataset.mode = split ? 'split' : 'single';
  elements.viewerStage.style.setProperty(
    '--split-left',
    `${Math.round(clampSplitRatio(viewerState.splitRatio) * 1000) / 10}%`,
  );
  elements.viewerModeSingle.classList.toggle('is-active', !split);
  elements.viewerModeSplit.classList.toggle('is-active', split);
  elements.viewerDivider.hidden = !split;
  elements.viewerRightPane.hidden = !split;

  elements.viewerLeftTitle.textContent = viewerState.left?.title || '左側';
  elements.viewerRightTitle.textContent = viewerState.right?.title || '右側待命';
  elements.viewerHeading.textContent = split
    ? `${viewerState.left?.title || '左側'} ／ ${viewerState.right?.title || '右側'}`
    : viewerState.left?.title || '內嵌瀏覽';

  elements.viewerLeftPane.classList.toggle('is-active', viewerState.activePane === 'left');
  elements.viewerRightPane.classList.toggle('is-active', viewerState.activePane === 'right');

  syncPaneFrame(
    elements.viewerLeftFrame,
    elements.viewerLeftEmpty,
    elements.viewerLeftBlocked,
    viewerState.left,
  );
  syncPaneFrame(
    elements.viewerRightFrame,
    elements.viewerRightEmpty,
    elements.viewerRightBlocked,
    split ? viewerState.right : null,
  );
  renderViewerRail();
}

async function openSlot(index, preferredPane = '') {
  const page = pageFromSlot(workspace.slots[index]);
  if (!page) return;
  await ensureEmbedAllow();
  const wasSplit = viewerState.mode === 'split' && Boolean(viewerState.right);
  viewerState = assignOpenTarget(viewerState, page, preferredPane);
  renderViewer();
  if (!wasSplit && viewerState.mode === 'split' && viewerState.right) {
    showToast('已左右分屏；拖曳中間分隔線可縮放。');
  }
}

function closeEmbeddedViewer() {
  viewerState = createViewerState();
  renderViewer();
}

function openPaneInTab(pane = viewerState.activePane) {
  const page = pane === 'right' ? viewerState.right : viewerState.left;
  if (!page?.url) return;
  chrome.tabs.create({ url: page.url });
}

function beginViewerResize(event) {
  if (viewerState.mode !== 'split') return;
  event.preventDefault();
  viewerResizeBound = elements.viewerStage.getBoundingClientRect();
  document.body.classList.add('is-resizing-viewer');
  elements.viewerStage.classList.add('is-resizing');
  if (typeof event.pointerId === 'number' && elements.viewerDivider.setPointerCapture) {
    try {
      elements.viewerDivider.setPointerCapture(event.pointerId);
    } catch {
      /* ignore capture failures in unsupported environments */
    }
  }
}

function moveViewerResize(event) {
  if (!viewerResizeBound) return;
  event.preventDefault?.();
  const clientX = event.touches?.[0]?.clientX ?? event.clientX;
  viewerState = {
    ...viewerState,
    splitRatio: ratioFromPointer(clientX, viewerResizeBound),
  };
  elements.viewerStage.style.setProperty(
    '--split-left',
    `${Math.round(clampSplitRatio(viewerState.splitRatio) * 1000) / 10}%`,
  );
}

function endViewerResize() {
  if (!viewerResizeBound) return;
  viewerResizeBound = null;
  document.body.classList.remove('is-resizing-viewer');
  elements.viewerStage.classList.remove('is-resizing');
  renderViewer();
}

function createFilledCard(slot, index) {
  const card = document.createElement('article');
  card.className = 'slot-card';
  card.draggable = true;
  card.dataset.index = index;
  card.dataset.group = slot.group;

  const preview = document.createElement('button');
  preview.type = 'button';
  preview.className = 'slot-preview';
  preview.setAttribute('aria-label', `開啟 ${slot.title}`);
  preview.addEventListener('click', () => openSlot(index));

  const logoUrl = resolveSlotLogo(slot);
  const fallback = document.createElement('span');
  fallback.className = 'preview-fallback';
  if (slot.thumbnail) {
    const backdrop = document.createElement('img');
    backdrop.className = 'preview-backdrop';
    backdrop.src = slot.thumbnail;
    backdrop.alt = '';
    backdrop.width = 320;
    backdrop.height = 180;
    fallback.append(backdrop);
  }
  const logoFrame = document.createElement('span');
  logoFrame.className = 'logo-frame';
  const initial = document.createElement('span');
  initial.className = 'logo-initial';
  initial.textContent = safeHostname(slot.url).slice(0, 1).toUpperCase() || 'W';
  if (logoUrl) {
    const logo = document.createElement('img');
    logo.className = 'slot-logo';
    logo.src = logoUrl;
    logo.alt = `${slot.title} logo`;
    logo.width = 112;
    logo.height = 112;
    logo.loading = 'lazy';
    logo.addEventListener('error', () => logoFrame.replaceChildren(initial));
    logoFrame.append(logo);
  } else {
    logoFrame.append(initial);
  }
  fallback.append(logoFrame);
  preview.append(fallback);

  const position = document.createElement('span');
  position.className = 'slot-position';
  position.textContent = String(index + 1).padStart(2, '0');
  preview.append(position);

  const content = document.createElement('div');
  content.className = 'slot-content';
  const titleRow = document.createElement('div');
  titleRow.className = 'slot-title-row';
  const title = document.createElement('h3');
  title.className = 'slot-title';
  title.textContent = slot.title;
  title.title = slot.title;
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'edit-button';
  editButton.setAttribute('aria-label', `編輯 ${slot.title}`);
  editButton.append(makeEditIcon());
  editButton.addEventListener('click', () => openEditor(index));
  titleRow.append(title, editButton);

  const host = document.createElement('span');
  host.className = 'slot-host';
  host.textContent = safeHostname(slot.url);

  const meta = document.createElement('div');
  meta.className = 'slot-meta';
  if (slot.group) meta.append(createMetaChip(slot.group));
  if (slot.routine) meta.append(createMetaChip(slot.routine, 'routine-chip'));
  if (slot.step) {
    const step = document.createElement('span');
    step.className = 'step-chip';
    step.textContent = `STEP ${String(slot.step).padStart(2, '0')}`;
    meta.append(step);
  }
  if (!meta.childElementCount) meta.append(createMetaChip('尚未分類'));

  content.append(titleRow, host, meta);
  card.append(preview, content, createReorderControls(index));
  bindDragEvents(card, index);
  return card;
}

function createEmptyCard(index) {
  const card = document.createElement('article');
  card.className = 'slot-card empty-slot';
  card.draggable = true;
  card.dataset.index = index;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'empty-slot-button';
  const plus = document.createElement('span');
  plus.textContent = '+';
  const label = document.createElement('strong');
  label.textContent = `空槽 ${String(index + 1).padStart(2, '0')}`;
  const hint = document.createElement('small');
  hint.textContent = '拖入分頁，或點此手動新增';
  button.append(plus, label, hint);
  button.addEventListener('click', () => openEditor(index));
  card.append(button);
  card.addEventListener('dragover', (event) => {
    if (draggedIndex >= 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    card.classList.add('is-external-drop-target');
  });
  card.addEventListener('dragleave', (event) => {
    if (!card.contains(event.relatedTarget)) card.classList.remove('is-external-drop-target');
  });
  card.addEventListener('drop', async (event) => {
    if (draggedIndex >= 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    card.classList.remove('is-external-drop-target');
    const page = pageFromTransfer(event.dataTransfer);
    if (page) await addPage(page, index);
  });
  bindDragEvents(card, index);
  return card;
}

function bindDragEvents(card, index) {
  card.addEventListener('dragstart', (event) => {
    draggedIndex = index;
    card.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  });
  card.addEventListener('dragend', () => {
    draggedIndex = -1;
    card.classList.remove('is-dragging');
    document.querySelectorAll('.is-drop-target').forEach((item) => {
      item.classList.remove('is-drop-target');
    });
  });
  card.addEventListener('dragover', (event) => {
    event.preventDefault();
    if (draggedIndex !== index) card.classList.add('is-drop-target');
  });
  card.addEventListener('dragleave', () => card.classList.remove('is-drop-target'));
  card.addEventListener('drop', async (event) => {
    event.preventDefault();
    card.classList.remove('is-drop-target');
    const sourceIndex = Number.parseInt(event.dataTransfer.getData('text/plain'), 10);
    if (!Number.isInteger(sourceIndex) || sourceIndex === index) return;
    workspace = moveSlot(workspace, sourceIndex, index);
    await saveWorkspace('首頁位置已更新。');
    render();
  });
}

function renderGrid() {
  const fragment = document.createDocumentFragment();
  workspace.slots.forEach((slot, index) => {
    const card = slot.url ? createFilledCard(slot, index) : createEmptyCard(index);
    if (selectedGroup && slot.group !== selectedGroup) card.classList.add('is-filtered');
    fragment.append(card);
  });
  elements.grid.replaceChildren(fragment);
}

function renderDatalist(element, values) {
  const fragment = document.createDocumentFragment();
  values.forEach((value) => {
    const option = document.createElement('option');
    option.value = value;
    fragment.append(option);
  });
  element.replaceChildren(fragment);
}

function renderGroupFilters() {
  const groups = getWorkspaceGroups(workspace);
  if (selectedGroup && !groups.includes(selectedGroup)) selectedGroup = '';
  const fragment = document.createDocumentFragment();
  [{ label: '全部', value: '' }, ...groups.map((group) => ({ label: group, value: group }))].forEach(
    (item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `filter-button${selectedGroup === item.value ? ' is-active' : ''}`;
      button.textContent = item.label;
      button.addEventListener('click', () => {
        selectedGroup = item.value;
        renderGroupFilters();
        renderGrid();
      });
      fragment.append(button);
    },
  );
  elements.groupFilters.replaceChildren(fragment);
  renderDatalist(elements.groupOptions, groups);
}

function updateRoutineSummary() {
  const routine = elements.routineSelect.value;
  const { slots, summary } = getRoutinePlan(workspace, routine);
  elements.routineButton.disabled = slots.length === 0;
  elements.routineSummary.textContent = summary;
}

function renderRoutines() {
  const routines = getWorkspaceRoutines(workspace);
  const previous = elements.routineSelect.value;
  const fragment = document.createDocumentFragment();
  if (!routines.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '尚未建立流程';
    fragment.append(option);
  } else {
    routines.forEach((routine) => {
      const option = document.createElement('option');
      option.value = routine;
      option.textContent = routine;
      fragment.append(option);
    });
  }
  elements.routineSelect.replaceChildren(fragment);
  if (routines.includes(previous)) elements.routineSelect.value = previous;
  renderDatalist(elements.routineOptions, routines);
  updateRoutineSummary();
}

function render() {
  homepage = normalizeHomepage(homepage);
  workspace = normalizeWorkspace(workspace);
  const count = workspace.slots.filter((slot) => slot.url).length;
  elements.savedCount.textContent = `${currentArea().name}：${count} / 16 已使用`;
  renderAreaTabs();
  renderOpenTabs();
  renderGroupFilters();
  renderRoutines();
  renderGrid();
}

function openEditor(index) {
  editingIndex = index;
  const slot = workspace.slots[index];
  elements.slotNumber.textContent = String(index + 1).padStart(2, '0');
  elements.slotTitle.value = slot.title;
  elements.slotUrl.value = slot.url;
  elements.slotGroup.value = slot.group;
  elements.slotRoutine.value = slot.routine;
  elements.slotStep.value = slot.step || '';
  elements.deleteButton.hidden = !slot.url;
  elements.dialogError.textContent = '';
  elements.slotDialog.showModal();
  elements.slotTitle.focus();
}

function closeSlotDialog() {
  elements.slotDialog.close();
  editingIndex = -1;
}

elements.slotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const url = normalizeWebUrl(elements.slotUrl.value);
  if (!url) {
    elements.dialogError.textContent = '請輸入有效的 http 或 https 網址。';
    elements.slotUrl.focus();
    return;
  }
  const current = workspace.slots[editingIndex];
  workspace.slots[editingIndex] = normalizeSlot({
    ...current,
    title: elements.slotTitle.value,
    url,
    group: elements.slotGroup.value,
    routine: elements.slotRoutine.value,
    step: elements.slotStep.value,
  });
  await saveWorkspace('網站設定已儲存。');
  closeSlotDialog();
  render();
});

elements.deleteButton.addEventListener('click', async () => {
  if (editingIndex < 0) return;
  workspace.slots[editingIndex] = createEmptySlot();
  await saveWorkspace('此槽已清空。');
  closeSlotDialog();
  render();
});

document.querySelectorAll('[data-close-dialog]').forEach((button) => {
  button.addEventListener('click', closeSlotDialog);
});

elements.helpButton.addEventListener('click', () => elements.helpDialog.showModal());
document.querySelectorAll('[data-close-help]').forEach((button) => {
  button.addEventListener('click', () => elements.helpDialog.close());
});

elements.addAreaButton.addEventListener('click', () => {
  elements.areaName.value = '';
  elements.areaDialog.showModal();
  elements.areaName.focus();
});
document.querySelectorAll('[data-close-area]').forEach((button) => {
  button.addEventListener('click', () => elements.areaDialog.close());
});
elements.areaForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  homepage = updateAreaWorkspace(homepage, homepage.activeAreaId, workspace);
  const previousCount = homepage.areas.length;
  homepage = createHomepageArea(homepage, elements.areaName.value);
  if (homepage.areas.length === previousCount) {
    showToast('請輸入不同的領域名稱，或已達 8 個領域上限。');
    return;
  }
  workspace = getAreaWorkspace(homepage, homepage.activeAreaId);
  selectedGroup = '';
  await chrome.storage.local.set({ [WORKSPACE_KEY]: homepage });
  elements.areaDialog.close();
  render();
  showToast(`已建立「${currentArea().name}」領域。`);
});

elements.routineSelect.addEventListener('change', updateRoutineSummary);
elements.routineButton.addEventListener('click', async () => {
  const { slots } = getRoutinePlan(workspace, elements.routineSelect.value);
  for (const slot of slots) {
    await chrome.tabs.create({ url: slot.url, active: false });
  }
  showToast(`已依順位開啟 ${slots.length} 個網站。`);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[WORKSPACE_KEY]) return;
  homepage = normalizeHomepage(changes[WORKSPACE_KEY].newValue);
  workspace = getAreaWorkspace(homepage, homepage.activeAreaId);
  render();
});

chrome.tabs.onCreated.addListener(refreshOpenTabs);
chrome.tabs.onRemoved.addListener(refreshOpenTabs);
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url || changeInfo.title) refreshOpenTabs();
});

elements.googleSignInButton.addEventListener('click', async () => {
  elements.googleSignInButton.disabled = true;
  elements.googleSignInButton.textContent = '登入中…';
  try {
    const result = await beginGoogleSignIn();
    googleAccount = result.account;
    renderAccountPanel();
    if (result.openedSignInPage) {
      showToast('已開啟 Google 登入頁。登入後請回到此首頁再按一次。');
    } else if (googleAccount.signedIn) {
      showToast(`已登入：${googleAccount.email}`);
    } else {
      showToast('尚未偵測到 Google 帳號，請先在瀏覽器登入。');
    }
  } catch (error) {
    showToast(error.message || '無法登入 Google 帳號。');
  } finally {
    elements.googleSignInButton.disabled = false;
    elements.googleSignInButton.innerHTML =
      '<span class="google-g" aria-hidden="true">G</span>登入 Google 帳號';
  }
});

elements.googleSignOutButton.addEventListener('click', async () => {
  googleAccount = await signOutGoogleAccount();
  renderAccountPanel();
  showToast('已登出 Google 帳號顯示。');
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.googleAccount) {
    googleAccount = normalizeAccount(changes.googleAccount.newValue);
    renderAccountPanel();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncGoogleAccount();
});

elements.viewerClose.addEventListener('click', closeEmbeddedViewer);
elements.viewerOpenTab.addEventListener('click', () => openPaneInTab());
elements.viewerModeSingle.addEventListener('click', () => {
  viewerState = setViewerMode(viewerState, 'single');
  renderViewer();
});
elements.viewerModeSplit.addEventListener('click', () => {
  viewerState = setViewerMode(viewerState, 'split');
  renderViewer();
  showToast('左右分屏已開啟；再點一個槽位可放到右側。');
});

elements.embeddedViewer.addEventListener('click', (event) => {
  const railIndex = event.target.closest('[data-open-slot-index]')?.dataset.openSlotIndex;
  if (railIndex !== undefined) {
    const preferred =
      viewerState.mode === 'split'
        ? viewerState.activePane
        : viewerState.left
          ? 'right'
          : 'left';
    openSlot(Number(railIndex), preferred);
    return;
  }
  const focusPane = event.target.closest('[data-focus-pane]')?.dataset.focusPane;
  if (focusPane) {
    viewerState = { ...viewerState, activePane: focusPane };
    renderViewer();
    return;
  }
  const openTabPane = event.target.closest('[data-open-tab-pane]')?.dataset.openTabPane;
  if (openTabPane) {
    openPaneInTab(openTabPane);
    return;
  }
  const closePane = event.target.closest('[data-close-pane]')?.dataset.closePane;
  if (closePane) {
    viewerState = closeViewerPane(viewerState, closePane);
    renderViewer();
  }
});

elements.viewerDivider.addEventListener('pointerdown', beginViewerResize);
window.addEventListener('pointermove', moveViewerResize);
window.addEventListener('pointerup', endViewerResize);
window.addEventListener('pointercancel', endViewerResize);

elements.viewerDivider.addEventListener('keydown', (event) => {
  if (viewerState.mode !== 'split') return;
  const step = event.shiftKey ? 0.08 : 0.03;
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    viewerState = {
      ...viewerState,
      splitRatio: clampSplitRatio(viewerState.splitRatio - step),
    };
    renderViewer();
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    viewerState = {
      ...viewerState,
      splitRatio: clampSplitRatio(viewerState.splitRatio + step),
    };
    renderViewer();
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && viewerState.open) {
    event.preventDefault();
    closeEmbeddedViewer();
  }
});

async function initialize() {
  const [stored] = await Promise.all([
    chrome.storage.local.get(WORKSPACE_KEY),
    refreshOpenTabs(),
    syncGoogleAccount(),
  ]);
  homepage = normalizeHomepage(stored[WORKSPACE_KEY]);
  workspace = getAreaWorkspace(homepage, homepage.activeAreaId);
  if (stored[WORKSPACE_KEY]?.version !== 2) {
    await chrome.storage.local.set({ [WORKSPACE_KEY]: homepage });
  }
  render();
}

initialize();
