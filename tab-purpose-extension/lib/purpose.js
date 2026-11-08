export const PURPOSE_COLORS = Object.freeze({
  ocean: { label: '藍', value: '#2563eb', tint: '#eff6ff' },
  amber: { label: '黃', value: '#b45309', tint: '#fffbeb' },
  teal: { label: '綠', value: '#0f766e', tint: '#f0fdfa' },
  coral: { label: '紅', value: '#be123c', tint: '#fff1f2' },
  slate: { label: '灰', value: '#475569', tint: '#f1f5f9' },
});

export const PURPOSE_PRESETS = Object.freeze([
  { label: '待處理', color: 'amber' },
  { label: '要核對', color: 'ocean' },
  { label: '待回覆', color: 'coral' },
  { label: '參考資料', color: 'teal' },
  { label: '已完成', color: 'slate' },
]);

export function normalizePurpose(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 20);
}

export function normalizeColor(value) {
  return Object.hasOwn(PURPOSE_COLORS, value) ? value : 'ocean';
}

export function stripPurposePrefix(title, purpose = '') {
  const value = String(title ?? '');
  const normalizedPurpose = normalizePurpose(purpose);
  const prefix = normalizedPurpose ? `【${normalizedPurpose}】 ` : '';
  return prefix && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function stripPurposePrefixes(title, purposes = []) {
  const knownPurposes = new Set(
    purposes.map(normalizePurpose).filter(Boolean),
  );
  let cleanTitle = String(title ?? '');
  let changed = true;

  while (changed) {
    changed = false;
    for (const purpose of knownPurposes) {
      const strippedTitle = stripPurposePrefix(cleanTitle, purpose);
      if (strippedTitle !== cleanTitle) {
        cleanTitle = strippedTitle;
        changed = true;
        break;
      }
    }
  }

  return cleanTitle;
}

export function formatPurposeTitle(purpose, title, previousPurpose = purpose) {
  const cleanPurpose = normalizePurpose(purpose);
  const cleanTitle = stripPurposePrefixes(title, [cleanPurpose, previousPurpose]);
  return cleanPurpose ? `【${cleanPurpose}】 ${cleanTitle}` : cleanTitle;
}

export function getBadgeText(purpose) {
  return Array.from(normalizePurpose(purpose)).slice(0, 2).join('');
}

export function matchesTabSearch(tab, query) {
  const normalizedQuery = String(query ?? '').trim().toLocaleLowerCase('zh-Hant');
  if (!normalizedQuery) return true;

  return [tab.title, tab.url, tab.purpose]
    .filter(Boolean)
    .some((value) => String(value).toLocaleLowerCase('zh-Hant').includes(normalizedQuery));
}
