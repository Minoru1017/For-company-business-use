(() => {
if (globalThis.__tabPurposeExtensionLoaded) return;
globalThis.__tabPurposeExtensionLoaded = true;

const SESSION_KEY = 'tabPurposeExtensionEntry';
const OWNER_ATTRIBUTE = 'data-tab-purpose-owner';
const ownerToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let currentEntry = null;
let lastAppliedTitle = '';
let titleObserver = null;
const knownPurposes = new Set();

function normalizePurpose(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
}

function stripKnownPrefix(title, purpose) {
  const value = String(title ?? '');
  const prefix = purpose ? `【${purpose}】 ` : '';
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function rememberPurposes(entry) {
  [entry?.purpose, entry?.previousPurpose, ...(entry?.knownPurposes ?? [])]
    .map(normalizePurpose)
    .filter(Boolean)
    .forEach((purpose) => knownPurposes.add(purpose));
}

function stripKnownPrefixes(title) {
  let cleanTitle = String(title ?? '');
  let changed = true;
  while (changed) {
    changed = false;
    for (const purpose of knownPurposes) {
      const strippedTitle = stripKnownPrefix(cleanTitle, purpose);
      if (strippedTitle !== cleanTitle) {
        cleanTitle = strippedTitle;
        changed = true;
        break;
      }
    }
  }
  return cleanTitle;
}

function claimTitleOwnership() {
  document.documentElement?.setAttribute(OWNER_ATTRIBUTE, ownerToken);
}

function ownsTitle() {
  return document.documentElement?.getAttribute(OWNER_ATTRIBUTE) === ownerToken;
}

function readLocalEntry() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function writeLocalEntry(entry) {
  if (entry?.purpose) {
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ ...entry, knownPurposes: [...knownPurposes] }),
    );
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

function applyTitle() {
  if ((!document.title && !document.head) || !ownsTitle()) return;
  const purpose = normalizePurpose(currentEntry?.purpose);
  const cleanTitle = stripKnownPrefixes(document.title);
  const nextTitle = purpose ? `【${purpose}】 ${cleanTitle}` : cleanTitle;

  if (document.title !== nextTitle) document.title = nextTitle;
  lastAppliedTitle = nextTitle;
}

function observeTitle() {
  if (titleObserver || !document.documentElement) return;
  titleObserver = new MutationObserver(() => {
    if (!ownsTitle()) {
      titleObserver.disconnect();
      titleObserver = null;
      return;
    }
    const differs = document.title !== lastAppliedTitle;
    if (differs) applyTitle();
  });
  titleObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function applyEntry(entry) {
  const previousPurpose = normalizePurpose(currentEntry?.purpose);
  rememberPurposes(currentEntry);
  rememberPurposes(entry);
  currentEntry = normalizePurpose(entry?.purpose)
    ? { ...entry, previousPurpose }
    : { previousPurpose };
  rememberPurposes(currentEntry);
  writeLocalEntry(currentEntry);
  applyTitle();
  if (currentEntry) delete currentEntry.previousPurpose;
  observeTitle();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'applyPurpose') applyEntry(message.entry);
});

async function initialize() {
  const localEntry = readLocalEntry();
  rememberPurposes(localEntry);
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'hydratePurpose',
      localEntry,
    });
    applyEntry(response?.data ?? localEntry);
  } catch {
    applyEntry(localEntry);
  }
}

claimTitleOwnership();
initialize();
})();
