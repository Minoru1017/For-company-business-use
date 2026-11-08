import {
  WORKSPACE_KEY,
  createEmptySlot,
  getRoutinePlan,
  getWorkspaceGroups,
  getWorkspaceRoutines,
  moveSlot,
  normalizeSlot,
  normalizeWebUrl,
  normalizeWorkspace,
} from '../lib/workspace.js';

const elements = {
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
  toast: document.querySelector('#toast'),
};

let workspace = normalizeWorkspace();
let selectedGroup = '';
let editingIndex = -1;
let draggedIndex = -1;
let toastTimer = null;

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
  await chrome.storage.local.set({ [WORKSPACE_KEY]: workspace });
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

function openSlot(index) {
  const slot = workspace.slots[index];
  if (slot.url) chrome.tabs.create({ url: slot.url });
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

  if (slot.thumbnail) {
    const image = document.createElement('img');
    image.src = slot.thumbnail;
    image.alt = '';
    image.width = 320;
    image.height = 180;
    preview.append(image);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'preview-fallback';
    const initial = document.createElement('span');
    initial.textContent = safeHostname(slot.url).slice(0, 1) || 'W';
    fallback.append(initial);
    preview.append(fallback);
  }

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
  hint.textContent = '點此手動新增網站';
  button.append(plus, label, hint);
  button.addEventListener('click', () => openEditor(index));
  card.append(button);
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
  workspace = normalizeWorkspace(workspace);
  const count = workspace.slots.filter((slot) => slot.url).length;
  elements.savedCount.textContent = `${count} / 16 已使用`;
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
  workspace = normalizeWorkspace(changes[WORKSPACE_KEY].newValue);
  render();
});

async function initialize() {
  const stored = await chrome.storage.local.get(WORKSPACE_KEY);
  workspace = normalizeWorkspace(stored[WORKSPACE_KEY]);
  render();
}

initialize();
