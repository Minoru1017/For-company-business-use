/**
 * 工作區右側章節導覽：從目前可見的 .sec-head 產生，捲動時標示所在章節。
 * 只在寬螢幕顯示（CSS 控制）；模式切換或分析結果顯示時重建。
 */
export function initWorkspaceToc({ root = document.getElementById('mainApp'), nav = document.getElementById('wsToc') } = {}) {
  if (!root || !nav) return { refresh() {} };

  let observer = null;
  let items = [];

  function visibleHeads() {
    return [...root.querySelectorAll('.sec-head')].filter((h) => {
      if (h.closest('[hidden]')) return false;
      const sec = h.closest('.sec') || h.parentElement;
      return sec && sec.offsetParent !== null && h.querySelector('h2');
    });
  }

  function setActive(id) {
    nav.querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.target === id));
  }

  function build() {
    observer?.disconnect();
    const heads = visibleHeads();
    items = heads.map((h, i) => {
      const sec = h.closest('.sec') || h.parentElement;
      if (!sec.id) sec.id = `ws-sec-${i + 1}`;
      const num = h.querySelector('.num')?.textContent.trim() || String(i + 1).padStart(2, '0');
      const label = h.querySelector('h2')?.textContent.trim() || '';
      return { id: sec.id, num, label, el: sec };
    });
    if (items.length < 3) {
      nav.hidden = true;
      nav.innerHTML = '';
      return;
    }
    nav.hidden = false;
    nav.innerHTML = `<p class="ws-toc-title">本頁</p><ol>${items
      .map(
        (it) =>
          `<li><a href="#${it.id}" data-target="${it.id}"><span class="ws-toc-num">${it.num.replace(/\D/g, '') || it.num}</span><span class="ws-toc-label">${it.label}</span></a></li>`
      )
      .join('')}</ol>`;

    observer = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (hit) setActive(hit.target.id);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
    );
    items.forEach((it) => observer.observe(it.el));
    setActive(items[0].id);
  }

  nav.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-target]');
    if (!a) return;
    e.preventDefault();
    document.getElementById(a.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(a.dataset.target);
  });

  // 結果區／模式區塊顯示狀態改變時重建
  const mo = new MutationObserver(() => {
    clearTimeout(mo._t);
    mo._t = setTimeout(build, 80);
  });
  mo.observe(root, { attributes: true, attributeFilter: ['hidden'], subtree: true });

  build();
  return { refresh: build };
}
