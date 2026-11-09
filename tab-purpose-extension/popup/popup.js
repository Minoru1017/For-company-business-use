import {
  PURPOSE_COLORS,
  PURPOSE_PRESETS,
  matchesTabSearch,
  normalizeColor,
  normalizePurpose,
  stripPurposePrefix,
} from '../lib/purpose.js';
import {
  SLOT_COUNT,
  WORKSPACE_KEY,
  addPageToFirstEmptySlot,
  getAreaWorkspace,
  normalizeHomepage,
  normalizeWebUrl,
  updateAreaWorkspace,
} from '../lib/workspace.js';

const elements = {
  form: document.querySelector('#purpose-form'),
  input: document.querySelector('#purpose-input'),
  currentTitle: document.querySelector('#current-title'),
  savedIndicator: document.querySelector('#saved-indicator'),
  clearButton: document.querySelector('#clear-button'),
  presetList: document.querySelector('#preset-list'),
  colorList: document.querySelector('#color-list'),
  tabList: document.querySelector('#tab-list'),
  tabCount: document.querySelector('#tab-count'),
  searchInput: document.querySelector('#search-input'),
  emptyState: document.querySelector('#empty-state'),
  status: document.querySelector('#status'),
  openHomeButton: document.querySelector('#open-home-button'),
  saveHomeButton: document.querySelector('#save-home-button'),
  homeSlotStatus: document.querySelector('#home-slot-status'),
};

let tabs = [];
let activeTab = null;
let selectedColor = 'ocean';
let statusTimer = null;

async function sendMessage(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || '無法更新分頁標記');
  return response.data;
}

function showStatus(message, isError = false) {
  clearTimeout(statusTimer);
  elements.status.textContent = message;
  elements.status.style.color = isError ? 'var(--danger)' : 'var(--primary)';
  statusTimer = setTimeout(() => {
    elements.status.textContent = '';
  }, 1800);
}

function getSelectedColor() {
  return document.querySelector('input[name="purpose-color"]:checked')?.value ?? selectedColor;
}

function setSelectedColor(color) {
  selectedColor = normalizeColor(color);
  const input = document.querySelector(
    `input[name="purpose-color"][value="${selectedColor}"]`,
  );
  if (input) input.checked = true;
}

function renderColorOptions() {
  const fragment = document.createDocumentFragment();
  Object.entries(PURPOSE_COLORS).forEach(([key, color], index) => {
    const label = document.createElement('label');
    label.className = 'color-option';
    label.title = `${color.label}色標記`;

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'purpose-color';
    input.value = key;
    input.checked = index === 0;
    input.setAttribute('aria-label', `${color.label}色標記`);

    const dot = document.createElement('span');
    dot.className = 'color-dot';
    dot.style.setProperty('--dot-color', color.value);

    label.append(input, dot);
    fragment.append(label);
  });
  elements.colorList.append(fragment);
}

function renderPresets() {
  const fragment = document.createDocumentFragment();
  PURPOSE_PRESETS.forEach((preset) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset-button';
    button.textContent = preset.label;
    button.addEventListener('click', async () => {
      elements.input.value = preset.label;
      setSelectedColor(preset.color);
      await savePurpose(preset.label, preset.color);
    });
    fragment.append(button);
  });
  elements.presetList.append(fragment);
}

function safeHostname(url) {
  try {
    return new URL(url).hostname || new URL(url).protocol.replace(':', '');
  } catch {
    return '瀏覽器頁面';
  }
}

function renderTabs() {
  const query = elements.searchInput.value;
  const visibleTabs = tabs.filter((tab) => matchesTabSearch(tab, query));
  const fragment = document.createDocumentFragment();

  visibleTabs.forEach((tab) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'tab-row';
    row.dataset.tabId = tab.id;
    row.setAttribute('aria-current', String(tab.active));
    row.setAttribute('aria-label', `切換至 ${stripPurposePrefix(tab.title, tab.purpose)}`);

    const glyph = document.createElement('span');
    glyph.className = 'tab-glyph';
    glyph.textContent = safeHostname(tab.url).slice(0, 1) || '頁';

    const copy = document.createElement('span');
    copy.className = 'tab-copy';
    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = stripPurposePrefix(tab.title, tab.purpose);
    const url = document.createElement('span');
    url.className = 'tab-url';
    url.textContent = safeHostname(tab.url);
    copy.append(title, url);

    const chip = document.createElement('span');
    chip.className = `purpose-chip${tab.purpose ? '' : ' is-empty'}`;
    chip.textContent = tab.purpose || '未標記';
    if (tab.purpose) {
      const color = PURPOSE_COLORS[normalizeColor(tab.color)];
      chip.style.setProperty('--chip-color', color.value);
      chip.style.setProperty('--chip-tint', color.tint);
    }

    row.append(glyph, copy, chip);
    row.addEventListener('click', () => chrome.tabs.update(tab.id, { active: true }));
    fragment.append(row);
  });

  elements.tabList.replaceChildren(fragment);
  elements.emptyState.hidden = visibleTabs.length > 0;
  elements.tabCount.textContent = `(${tabs.length})`;
}

function syncCurrentTab() {
  activeTab = tabs.find((tab) => tab.active) ?? tabs[0] ?? null;
  if (!activeTab) {
    elements.currentTitle.textContent = '沒有可用的分頁';
    elements.form.hidden = true;
    return;
  }

  elements.currentTitle.textContent = stripPurposePrefix(activeTab.title, activeTab.purpose);
  elements.input.value = activeTab.purpose;
  setSelectedColor(activeTab.color);
  elements.savedIndicator.hidden = !activeTab.purpose;
  elements.clearButton.hidden = !activeTab.purpose;
}

async function reloadTabs() {
  tabs = await sendMessage({ type: 'getTabList' });
  syncCurrentTab();
  renderTabs();
}

async function readHomepage() {
  const stored = await chrome.storage.local.get(WORKSPACE_KEY);
  return normalizeHomepage(stored[WORKSPACE_KEY]);
}

async function updateHomeSlotStatus() {
  const homepage = await readHomepage();
  const savedWorkspace = getAreaWorkspace(homepage, homepage.activeAreaId);
  const used = savedWorkspace.slots.filter((slot) => slot.url).length;
  const area = homepage.areas.find((item) => item.id === homepage.activeAreaId);
  elements.homeSlotStatus.textContent = `${area?.name ?? '目前領域'}：${used} / ${SLOT_COUNT} 已使用`;
  elements.saveHomeButton.disabled = used >= SLOT_COUNT;
}

async function captureThumbnail() {
  try {
    const source = await chrome.tabs.captureVisibleTab(undefined, {
      format: 'jpeg',
      quality: 45,
    });
    const image = new Image();
    image.src = source;
    await image.decode();

    const width = 320;
    const height = 180;
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const sourceWidth = width / scale;
    const sourceHeight = height / scale;
    const sourceX = (image.naturalWidth - sourceWidth) / 2;
    const sourceY = 0;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    context.drawImage(
      image,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      width,
      height,
    );
    return canvas.toDataURL('image/jpeg', 0.55);
  } catch {
    return '';
  }
}

async function saveCurrentPageToHome() {
  if (!activeTab || !normalizeWebUrl(activeTab.url)) {
    showStatus('這個瀏覽器頁面無法存到工作首頁。', true);
    return;
  }

  elements.saveHomeButton.disabled = true;
  elements.saveHomeButton.textContent = '擷取中…';
  try {
    const [homepage, thumbnail] = await Promise.all([
      readHomepage(),
      captureThumbnail(),
    ]);
    const savedWorkspace = getAreaWorkspace(homepage, homepage.activeAreaId);
    const result = addPageToFirstEmptySlot(savedWorkspace, {
      url: activeTab.url,
      title: stripPurposePrefix(activeTab.title, activeTab.purpose),
      thumbnail,
    });
    if (result.index < 0) {
      showStatus('16 個位置都已使用，請先到工作首頁清空一格。', true);
      return;
    }
    await chrome.storage.local.set({
      [WORKSPACE_KEY]: updateAreaWorkspace(homepage, homepage.activeAreaId, result.workspace),
    });
    await updateHomeSlotStatus();
    showStatus(`已存到工作首頁第 ${result.index + 1} 格。`);
  } catch (error) {
    showStatus(error.message || '無法儲存目前分頁。', true);
  } finally {
    elements.saveHomeButton.textContent = '存到首頁';
    const currentHomepage = await readHomepage();
    const currentWorkspace = getAreaWorkspace(currentHomepage, currentHomepage.activeAreaId);
    elements.saveHomeButton.disabled =
      currentWorkspace.slots.filter((slot) => slot.url).length >= SLOT_COUNT;
  }
}

async function savePurpose(rawPurpose, color = getSelectedColor()) {
  if (!activeTab) return;
  const purpose = normalizePurpose(rawPurpose);
  if (!purpose) {
    showStatus('請先輸入用途。', true);
    elements.input.focus();
    return;
  }

  try {
    await sendMessage({
      type: 'setPurpose',
      tabId: activeTab.id,
      entry: { purpose, color },
    });
    await reloadTabs();
    showStatus('已套用，標題與徽章會同步更新。');
  } catch (error) {
    showStatus(error.message, true);
  }
}

elements.form.addEventListener('submit', (event) => {
  event.preventDefault();
  savePurpose(elements.input.value);
});

elements.clearButton.addEventListener('click', async () => {
  if (!activeTab) return;
  try {
    await sendMessage({ type: 'setPurpose', tabId: activeTab.id, entry: null });
    await reloadTabs();
    showStatus('已移除標記。');
  } catch (error) {
    showStatus(error.message, true);
  }
});

elements.searchInput.addEventListener('input', renderTabs);
elements.openHomeButton.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
});
elements.saveHomeButton.addEventListener('click', saveCurrentPageToHome);

async function initialize() {
  renderColorOptions();
  renderPresets();
  try {
    await Promise.all([reloadTabs(), updateHomeSlotStatus()]);
  } catch (error) {
    showStatus(error.message, true);
  }
}

initialize();
