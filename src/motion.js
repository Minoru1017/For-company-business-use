// 數字滾動與比率條過渡：畫面是整段 innerHTML 重繪，所以把上一次的值記在 memo 裡，
// 重繪後先把元素設回舊值，再過渡到新值。尊重 prefers-reduced-motion。

const easeOut = (t) => 1 - (1 - t) ** 3;

export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function countUp(el, from, to, duration = 520) {
  if (!el || !Number.isFinite(from) || !Number.isFinite(to)) return;
  if (from === to || reducedMotion() || typeof requestAnimationFrame !== 'function') {
    el.textContent = String(to);
    return;
  }
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    el.textContent = String(Math.round(from + (to - from) * easeOut(p)));
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function createFunnelMotion() {
  const memo = { n: [], w: [] };
  return function animate(root) {
    if (!root) return;
    const nums = Array.from(root.querySelectorAll('.slog-step-n'));
    nums.forEach((el, i) => {
      const to = Number(el.textContent);
      const from = memo.n[i];
      if (Number.isFinite(to) && Number.isFinite(from)) countUp(el, from, to);
      memo.n[i] = Number.isFinite(to) ? to : undefined;
    });
    const bars = Array.from(root.querySelectorAll('.slog-step-bar i'));
    bars.forEach((el, i) => {
      const to = el.style.width;
      const from = memo.w[i];
      if (from != null && from !== to && !reducedMotion()) {
        el.style.transition = 'none';
        el.style.width = from;
        void el.offsetWidth;
        el.style.transition = '';
        el.style.width = to;
      }
      memo.w[i] = to;
    });
  };
}
