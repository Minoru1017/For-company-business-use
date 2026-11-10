export const SEARCH_PAGE_PREF_KEY = 'defaultSearchPagePref';

export const SEARCH_PAGE_MODES = Object.freeze({
  ASK: 'ask',
  STAY: 'stay',
  REDIRECT: 'redirect',
});

export function normalizeSearchPagePref(raw = {}) {
  const mode = String(raw.mode ?? SEARCH_PAGE_MODES.ASK);
  return {
    mode: Object.values(SEARCH_PAGE_MODES).includes(mode) ? mode : SEARCH_PAGE_MODES.ASK,
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

export function shouldShowSearchPagePrompt(pref) {
  return normalizeSearchPagePref(pref).mode === SEARCH_PAGE_MODES.ASK;
}

export function shouldRedirectToSearchPage(pref) {
  return normalizeSearchPagePref(pref).mode === SEARCH_PAGE_MODES.REDIRECT;
}

export function getDefaultSearchPageCandidates(userAgent = '') {
  const ua = String(userAgent);
  if (/Edg\//i.test(ua)) {
    return ['edge://new-tab-page/', 'https://www.bing.com/'];
  }
  return ['chrome://new-tab-page/', 'https://www.google.com/'];
}

export async function readSearchPagePref(api = globalThis.chrome) {
  const stored = await api.storage.local.get(SEARCH_PAGE_PREF_KEY);
  return normalizeSearchPagePref(stored[SEARCH_PAGE_PREF_KEY]);
}

export async function writeSearchPagePref(mode, api = globalThis.chrome) {
  const pref = normalizeSearchPagePref({
    mode,
    updatedAt: Date.now(),
  });
  await api.storage.local.set({ [SEARCH_PAGE_PREF_KEY]: pref });
  return pref;
}

export async function openDefaultSearchPage(api = globalThis.chrome, env = globalThis) {
  const candidates = getDefaultSearchPageCandidates(env.navigator?.userAgent);
  let lastError = null;

  for (const url of candidates) {
    try {
      if (api?.tabs?.update) {
        await api.tabs.update({ url });
        return { ok: true, url };
      }
      env.location.assign(url);
      return { ok: true, url };
    } catch (error) {
      lastError = error;
    }
  }

  if (api?.search?.query) {
    try {
      await api.search.query({ text: ' ', disposition: 'CURRENT_TAB' });
      return { ok: true, url: 'search-api' };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('無法開啟預設搜尋頁');
}
