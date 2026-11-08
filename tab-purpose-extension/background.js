import {
  PURPOSE_COLORS,
  getBadgeText,
  normalizeColor,
  normalizePurpose,
} from './lib/purpose.js';

const STORAGE_KEY = 'tabPurposes';

async function readPurposes() {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  return stored[STORAGE_KEY] ?? {};
}

async function writePurposes(purposes) {
  await chrome.storage.session.set({ [STORAGE_KEY]: purposes });
}

async function updateBadge(tabId, entry) {
  const purpose = normalizePurpose(entry?.purpose);
  await chrome.action.setBadgeText({ tabId, text: getBadgeText(purpose) });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: purpose ? PURPOSE_COLORS[normalizeColor(entry?.color)].value : '#64748b',
  });
  await chrome.action.setTitle({
    tabId,
    title: purpose ? `用途：${purpose}` : '標記這個分頁',
  });
}

async function notifyTab(tabId, entry) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    });
    await chrome.tabs.sendMessage(tabId, { type: 'applyPurpose', entry });
  } catch {
    // Browser settings and internal pages do not allow content scripts.
  }
}

async function setPurpose(tabId, rawEntry) {
  const purposes = await readPurposes();
  const purpose = normalizePurpose(rawEntry?.purpose);

  if (!purpose) {
    delete purposes[tabId];
    await writePurposes(purposes);
    await updateBadge(tabId, null);
    await notifyTab(tabId, null);
    return null;
  }

  const entry = {
    purpose,
    color: normalizeColor(rawEntry?.color),
    updatedAt: Date.now(),
  };
  purposes[tabId] = entry;
  await writePurposes(purposes);
  await updateBadge(tabId, entry);
  await notifyTab(tabId, entry);
  return entry;
}

async function hydratePurpose(tabId, localEntry) {
  const purposes = await readPurposes();
  let entry = purposes[tabId] ?? null;

  if (!entry && normalizePurpose(localEntry?.purpose)) {
    entry = await setPurpose(tabId, localEntry);
  } else {
    await updateBadge(tabId, entry);
  }
  return entry;
}

async function getTabList() {
  const [tabs, purposes] = await Promise.all([
    chrome.tabs.query({ currentWindow: true }),
    readPurposes(),
  ]);

  return tabs.map((tab) => ({
    id: tab.id,
    active: tab.active,
    title: tab.title || '未命名分頁',
    url: tab.url || '',
    purpose: purposes[tab.id]?.purpose ?? '',
    color: normalizeColor(purposes[tab.id]?.color),
  }));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId ?? sender.tab?.id;
  const respond = async () => {
    switch (message.type) {
      case 'hydratePurpose':
        return tabId ? hydratePurpose(tabId, message.localEntry) : null;
      case 'setPurpose':
        return tabId ? setPurpose(tabId, message.entry) : null;
      case 'getTabList':
        return getTabList();
      default:
        return null;
    }
  };

  respond().then(
    (data) => sendResponse({ ok: true, data }),
    (error) => sendResponse({ ok: false, error: error.message }),
  );
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const purposes = await readPurposes();
  if (!purposes[tabId]) return;
  delete purposes[tabId];
  await writePurposes(purposes);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.status !== 'complete') return;
  const purposes = await readPurposes();
  if (purposes[tabId]) await notifyTab(tabId, purposes[tabId]);
});

chrome.runtime.onStartup.addListener(async () => {
  const purposes = await readPurposes();
  await Promise.all(
    Object.entries(purposes).map(([tabId, entry]) => updateBadge(Number(tabId), entry)),
  );
});
