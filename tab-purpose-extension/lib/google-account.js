export const ACCOUNT_STORAGE_KEY = 'googleAccount';

export function normalizeAccount(raw = {}) {
  const email = String(raw.email ?? '').trim();
  const id = String(raw.id ?? '').trim();
  const name = String(raw.name ?? '').trim();
  const picture = String(raw.picture ?? '').trim();
  if (!email && !id) {
    return { signedIn: false, email: '', id: '', name: '', picture: '', source: '' };
  }
  return {
    signedIn: true,
    email,
    id,
    name,
    picture: /^https?:\/\//.test(picture) ? picture : '',
    source: String(raw.source ?? 'chrome-profile'),
  };
}

export async function readStoredAccount() {
  const stored = await chrome.storage.local.get(ACCOUNT_STORAGE_KEY);
  return normalizeAccount(stored[ACCOUNT_STORAGE_KEY]);
}

export async function writeStoredAccount(account) {
  const normalized = normalizeAccount(account);
  if (!normalized.signedIn) {
    await chrome.storage.local.remove(ACCOUNT_STORAGE_KEY);
    return normalized;
  }
  await chrome.storage.local.set({ [ACCOUNT_STORAGE_KEY]: normalized });
  return normalized;
}

export async function readChromeProfileAccount() {
  if (!chrome.identity?.getProfileUserInfo) {
    return normalizeAccount();
  }
  const info = await chrome.identity.getProfileUserInfo({ accountStatus: 'ANY' });
  return normalizeAccount({
    email: info?.email,
    id: info?.id,
    source: 'chrome-profile',
  });
}

export async function refreshGoogleAccount() {
  const profile = await readChromeProfileAccount();
  if (profile.signedIn) {
    return writeStoredAccount(profile);
  }
  await writeStoredAccount(normalizeAccount());
  return profile;
}

export async function beginGoogleSignIn() {
  const current = await refreshGoogleAccount();
  if (current.signedIn) return { account: current, openedSignInPage: false };

  // Unpacked extensions usually have no OAuth client ID. Opening Google's
  // sign-in page lets the user sign into Chrome; the homepage then reads the profile.
  await chrome.tabs.create({
    url: 'https://accounts.google.com/signin/v2/identifier?hl=zh-TW',
    active: true,
  });
  return { account: current, openedSignInPage: true };
}

export async function signOutGoogleAccount() {
  return writeStoredAccount(normalizeAccount());
}
