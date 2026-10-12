import { $, escapeHTML, fmt, renderReportList } from './utils.js';
import { PURPOSE_TYPES } from './purpose-types.js';
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

/** 五字口訣卡：堆疊成一列可點的積木，只展開被點到那一張的細節，避免五張全文一起壓上來。 */
const purposeDetailHtml = (t, hit, role) => {
  const roleTag = role ? `<small class="purpose-pill-role">${role}</small>` : '';
  const dontForce = t.dontForceTo?.length ? `<p class="purpose-ev muted">勿硬導向：${t.dontForceTo.join('、')}</p>` : '';
  const ev = hit
    ? `<p class="purpose-ev"><span class="purpose-ev-k">客戶原話</span>${escapeHTML(hit.evidence.text.slice(0, 120))}${hit.evidence.text.length > 120 ? '…' : ''}</p>`
    : `<p class="purpose-ev muted"><span class="purpose-ev-k">未偵測到</span>可問：${escapeHTML(t.probe)}</p>`;
  return `<span class="blk-pill">${t.label}${roleTag}</span><p class="purpose-desc">${t.purpose}</p>${ev}${dontForce}`;
};

function bindPurposeStack(el) {
  if (el.dataset.stackBound) return;
  el.dataset.stackBound = '1';
  el.addEventListener('click', (e) => {
    const tab = e.target.closest('.purpose-tab');
    if (!tab || !el.contains(tab)) return;
    const panel = el.querySelector('.purpose-detail');
    const html = tab.dataset.detail;
    if (!panel || html == null) return;
    el.querySelectorAll('.purpose-tab').forEach((b) => {
      const on = b === tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    panel.classList.remove('is-swapping');
    void panel.offsetWidth;
    panel.innerHTML = html;
    panel.classList.add('is-swapping');
  });
}

export function renderPurposeProfile(profile) {
  const el = $('purposeTypes');
  if (!el) return;

  const defaultKey = profile.dominant?.key || profile.signals[0]?.key || PURPOSE_TYPES[0].key;
  let defaultDetail = '';
  const tabs = PURPOSE_TYPES.map((t) => {
    const hit = profile.signals.find((s) => s.key === t.key);
    const isDom = profile.dominant?.key === t.key;
    const isSec = profile.secondary?.key === t.key;
    const role = isDom ? '主導' : isSec ? '次要' : '';
    const badge = isDom ? '<span class="purpose-badge dom">主導</span>' : isSec ? '<span class="purpose-badge sec">次要</span>' : '';
    const detail = purposeDetailHtml(t, hit, role);
    const on = t.key === defaultKey;
    if (on) defaultDetail = detail;
    return `<button type="button" class="purpose-tab ${hit ? 'hit' : 'miss'}${isDom ? ' dominant' : ''}${on ? ' on' : ''}" role="tab" aria-selected="${on}" data-key="${t.key}" data-detail="${escapeHTML(detail)}">
      <span class="purpose-tab-l">${t.label}</span>${badge}<i class="purpose-dot" aria-hidden="true" title="${hit ? '有偵測到' : '未偵測到'}"></i>
    </button>`;
  }).join('');
  const typeCards = `<div class="purpose-stack" role="tablist" aria-label="五字口訣分級">${tabs}</div><div class="purpose-detail blk blk-tl" role="tabpanel">${defaultDetail}</div>`;
  bindPurposeStack(el);

  let tierLayers = '';
  if (profile.dominant && profile.typeLayerHits?.length) {
    const d = profile.dominant;
    const layerBoxes = profile.typeLayerHits
      .map(
        (L) =>
          `<div class="layer ${L.hit ? 'hit' : 'miss'}" title="${escapeHTML(L.question)}">L${L.n} ${escapeHTML(L.name)}<br>${L.hit ? '<span class="mk on">●</span>' : '<span class="mk off">○</span>'}</div>`
      )
      .join('');
    tierLayers = `<div class="purpose-playbook"><h4>「${escapeHTML(d.label)}」分級五層挖掘</h4>
      <p class="reason-summary">${escapeHTML(d.antiPattern)}</p>
      <div class="layers tier-layers">${layerBoxes}</div>
      <p class="purpose-status">最深到 L${profile.typeDeepest || 0}／5${profile.wrongProbes?.length ? ` · <span style="color:var(--bad)">偵測到 ${profile.wrongProbes.length} 句問錯方向</span>` : ''}</p>
    </div>`;
  }

  let playbook = tierLayers;
  const dr = profile.deepReasoning;
  if (dr?.ready && dr.chains.length) {
    const chainHtml = dr.chains
      .map((chain) => {
        const steps = chain.steps
          .map((st) => {
            const quote = st.quote ? `<div class="reason-quote">「${escapeHTML(st.quote)}」</div>` : '';
            const ex = st.example ? `<div class="reason-example">例：${escapeHTML(st.example)}</div>` : '';
            return `<div class="reason-step"><span class="reason-title">${st.title}</span>${quote}<div class="reason-insight">${escapeHTML(st.insight)}</div>${ex}</div>`;
          })
          .join('');
        return `<div class="reason-chain"><h5>${escapeHTML(chain.role)} · ${escapeHTML(chain.label)}${chain.confidence === 'low' ? ' <span class="purpose-badge sec">信心偏低</span>' : ''}</h5>${steps}</div>`;
      })
      .join('');
    playbook += `<div class="purpose-playbook"><h4>深層推理鏈</h4><p class="reason-summary">${escapeHTML(dr.summary)}</p>${chainHtml}</div>`;
  } else if (profile.dominant) {
    const d = profile.dominant;
    playbook += `<div class="purpose-playbook">
      <h4>主導分級「${escapeHTML(d.label)}」→ 分別強化 → 對接</h4>
      <p><b>學 AI 目的：</b>${escapeHTML(d.aiPurpose)}</p>
      <p><b>強化：</b>${escapeHTML(d.amplify)}</p>
      <p class="q-line">「${escapeHTML(d.amplifyExample)}」</p>
      <p><b>對接（客戶想聽的話）：</b></p>
      <p class="q-line">「${escapeHTML(d.pitch)}」</p>
      <p class="purpose-status">${profile.amplifyMatched ? '● 已偵測到符合類型的強化' : '○ 尚未用此類型語言強化'}
        ／ ${profile.pitchMatched ? '● 已偵測到符合類型的對接' : '○ 尚未用此類型語言對接'}</p>
    </div>`;
  } else {
    playbook = '<div class="purpose-playbook muted">尚未判斷目的分級。從客戶原話辨識是「要／怕／想／愛／爽」哪一型，再依該分級往下挖五層、分別強化與對接。</div>';
  }

  el.innerHTML = `${typeCards}${playbook}`;
}

export function renderAnalysisUI(result) {
  const { stats, stepHit, layerHits, convergeHint, manualChecks, purposeProfile, good, bad, sug } = result;
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
    .map((L) => {
      const sub = L.manualName ? `<div style="font-size:.68rem;color:var(--muted)">${L.manualName}</div>` : '';
      return `<div class="layer ${L.hit ? 'hit' : 'miss'}">${L.name}${sub}<br>${L.hit ? '<span class="mk on">●</span>' : '<span class="mk off">○</span>'}</div>`;
    })
    .join('');

  $('manualChecks').innerHTML = ['discovery', 'amplification', 'trust']
    .filter((key) => manualChecks[key])
    .map((key) => {
      const block = manualChecks[key];
      const criteria = block.criteria
        .map(
          (c) =>
            `<li><span class="mk ${c.pass ? 'on' : 'off'}">${c.pass ? '●' : '○'}</span><span>${c.label}${c.hint && !c.pass ? `<div style="color:var(--muted);font-size:.72rem;margin-top:2px">${c.hint}</div>` : ''}</span></li>`
        )
        .join('');
      return `<article class="rule-card ${block.status}">
        <div class="rule-card-head">
          <div><h3>${block.title}</h3><p>${block.subtitle}</p></div>
          <span class="rule-verdict ${block.status}">${block.statusLabel}</span>
        </div>
        <ul class="rule-criteria">${criteria}</ul>
        <div class="rule-summary">${block.summary}</div>
      </article>`;
    })
    .join('');

  renderPurposeProfile(purposeProfile);

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
