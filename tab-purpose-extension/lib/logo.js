export function getHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function buildLogoUrl(url, size = 128) {
  const hostname = getHostname(url);
  if (!hostname) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=${size}`;
}

export function resolveSlotLogo(slot = {}) {
  const favicon = String(slot.favicon ?? '');
  if (/^(?:data:image\/|https?:\/\/)/.test(favicon)) return favicon;
  return buildLogoUrl(slot.url, 128);
}

export function enrichPageWithLogo(page = {}) {
  const url = String(page.url ?? '');
  const favicon = String(page.favicon ?? '');
  return {
    ...page,
    favicon: /^(?:data:image\/|https?:\/\/)/.test(favicon) ? favicon : buildLogoUrl(url, 128),
  };
}
