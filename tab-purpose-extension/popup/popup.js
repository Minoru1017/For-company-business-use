import {
  PURPOSE_COLORS,
  PURPOSE_PRESETS,
  matchesTabSearch,
  normalizeColor,
  normalizePurpose,
  stripPurposePrefix,
} from '../lib/purpose.js';

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

async function initialize() {
  renderColorOptions();
  renderPresets();
  try {
    await reloadTabs();
  } catch (error) {
    showStatus(error.message, true);
  }
}

initialize();
