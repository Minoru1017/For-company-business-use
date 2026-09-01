export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function getUsage(storage = localStorage) {
  const u = JSON.parse(storage.getItem('gemini_usage') || '{}');
  return u.date === todayKey() ? u : { date: todayKey(), count: 0, tokens: 0 };
}

export function saveUsage(u, storage = localStorage) {
  storage.setItem('gemini_usage', JSON.stringify(u));
}

export function bumpUsage(tokens, storage = localStorage) {
  const u = getUsage(storage);
  u.count += 1;
  u.tokens += tokens || 0;
  saveUsage(u, storage);
  return u;
}

export function getLimit(value, storage = localStorage) {
  const n = Math.max(10, +(value ?? storage.getItem('gemini_limit')) || 250);
  return n;
}

export function quotaPercent(count, limit) {
  return Math.min(100, Math.round((count / limit) * 100));
}

export function checkQuotaBefore(count, limit) {
  const pct = (count / limit) * 100;
  if (count >= limit) return { ok: false, level: 'blocked', pct };
  if (pct >= 95) return { ok: true, level: 'critical', pct };
  if (pct >= 80) return { ok: true, level: 'warn', pct };
  return { ok: true, level: 'ok', pct };
}
