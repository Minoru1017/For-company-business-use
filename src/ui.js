import { $, fmt, renderReportList } from './utils.js';
import { RULES } from './rules.js';

const PANES = ['good', 'bad', 'sug'];
let toastTimer = null;

export function showToast(msg) {
  $('toastMsg').textContent = msg;
  $('toast').classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2200);
}

export function switchPane(name) {
  document.querySelectorAll('.rtab').forEach((t) => t.classList.toggle('active', t.dataset.pane === name));
  document.querySelectorAll('.rpager .pnum').forEach((t) => t.classList.toggle('active', t.dataset.pane === name));
  document.querySelectorAll('.rpane').forEach((t) => t.classList.toggle('active', t.dataset.pane === name));
}

export function paneStep(dir) {
  const cur = document.querySelector('.rpane.active')?.dataset.pane || 'good';
  switchPane(PANES[(PANES.indexOf(cur) + dir + PANES.length) % PANES.length]);
}

export function updateReportCounts() {
  $('cntGood').textContent = $('goodList').children.length;
  $('cntBad').textContent = $('badList').children.length;
  $('cntSug').textContent = $('sugList').children.length;
  document.querySelectorAll('ul.report li').forEach((li) => {
    if (li.querySelector('.ev')) li.classList.add('has-ev');
  });
}

export function renderAnalysisUI(result) {
  const { stats, stepHit, layerHits, convergeHint, good, bad, sug } = result;
  const ratioColor = stats.custRatio >= 0.45 ? 'var(--ok)' : stats.custRatio >= 0.3 ? 'var(--warn)' : 'var(--bad)';

  $('stats').innerHTML = `<div class="stat"><div class="num">${fmt(stats.totalDur)}</div><div class="lbl">通話長度</div></div>
    <div class="stat"><div class="num" style="color:${ratioColor}">${Math.round(stats.custRatio * 100)}%</div><div class="lbl">客戶說話比例</div></div>
    <div class="stat"><div class="num">${stats.sQuestions}</div><div class="lbl">業務提問數</div></div>
    <div class="stat"><div class="num">${stats.sCount}／${stats.cCount}</div><div class="lbl">業務／客戶句數</div></div>
    <div class="stat"><div class="num">${stats.avgCustChars.toFixed(1)}</div><div class="lbl">客戶平均每句字數</div></div>`;

  $('stepBoxes').innerHTML = RULES.steps
    .map((st) => {
      const hit = stepHit[st.key];
      return `<div class="step ${hit ? 'on' : 'off'}"><div class="nm">${st.name}</div>
      <div>${hit ? '<span class="mk on">●</span>已偵測' : '<span class="mk off">○</span>未偵測'}</div>
      <div style="color:var(--muted);font-size:.75rem">建議 ${st.time}</div></div>`;
    })
    .join('');

  $('layerBoxes').innerHTML = layerHits
    .map((L) => `<div class="layer ${L.hit ? 'hit' : 'miss'}">${L.name}<br>${L.hit ? '<span class="mk on">●</span>' : '<span class="mk off">○</span>'}</div>`)
    .join('');

  $('convergeHint').innerHTML = convergeHint;
  renderReportList('goodList', good, '這通電話尚未偵測到亮點——先從把五層挖掘做完整開始');
  renderReportList('badList', bad, '沒有明顯缺失，維持水準');
  renderReportList('sugList', sug, '流程完整，下一通維持同樣結構即可');

  updateReportCounts();
  switchPane('good');
  animateStats();
}

export function animateStats() {
  document.querySelectorAll('.stat .num').forEach((el) => {
    const m = el.textContent.match(/^(\d+)(%?)$/);
    if (!m) return;
    const target = +m[1];
    const suffix = m[2];
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 600);
      el.textContent = Math.round(target * (1 - (1 - p) ** 3)) + suffix;
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

export function showQuotaModal(title, body) {
  $('qmTitle').textContent = title;
  $('qmBody').innerHTML = body;
  $('quotaModal').style.display = 'flex';
}

export function bindUI() {
  document.querySelectorAll('.rtab,.rpager .pnum').forEach((el) => (el.onclick = () => switchPane(el.dataset.pane)));
  $('rPrev').onclick = () => paneStep(-1);
  $('rNext').onclick = () => paneStep(1);
  document.addEventListener('keydown', (e) => {
    if ($('result').hidden || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowLeft') paneStep(-1);
    if (e.key === 'ArrowRight') paneStep(1);
  });
  document.addEventListener('click', (e) => {
    const li = e.target.closest('ul.report li.has-ev');
    if (li) li.classList.toggle('open');
  });
  document.querySelectorAll('.faq li').forEach((li) => (li.onclick = () => li.classList.toggle('done')));
  $('quotaModal').querySelectorAll('[data-open]').forEach((btn) => {
    btn.onclick = () => window.open(btn.dataset.open, '_blank');
  });
  $('quotaModalClose').onclick = () => ($('quotaModal').style.display = 'none');
}
