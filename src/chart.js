import { momentBarHighlight } from './key-moments.js';
import { $, escapeHTML, fmt } from './utils.js';

let chart = null;

function keyMomentPlugin(moments) {
  return {
    id: 'keyMoments',
    beforeDatasetsDraw(ch) {
      const { ctx, chartArea, scales } = ch;
      if (!moments.length) return;
      const half = scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0);
      const pad = Number.isFinite(half) ? Math.abs(half) / 2 : 8;
      moments.forEach((m) => {
        const x1 = scales.x.getPixelForValue(m.startIdx) - pad;
        const x2 = scales.x.getPixelForValue(m.endIdx) + pad;
        ctx.save();
        ctx.fillStyle = m.color;
        ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
        ctx.strokeStyle = 'rgba(255, 210, 80, 0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
        ctx.restore();
      });
    },
  };
}

export function renderKeyMomentsLegend(moments) {
  const el = $('keyMomentsLegend');
  if (!el) return;
  if (!moments.length) {
    el.innerHTML = '<span class="key-empty">尚未偵測到關鍵話點——當業務提問後客戶回應夠深入時會標記</span>';
    return;
  }
  el.innerHTML = moments
    .map(
      (m) =>
        `<button type="button" class="key-moment" data-start="${m.startIdx}" title="${escapeHTML(m.detail || '')}">
          <span class="key-time">${fmt(m.start)}</span>
          <span class="key-label">${escapeHTML(m.label)}</span>
          <span class="key-meta">客戶 ${m.customerChars} 字</span>
        </button>`
    )
    .join('');
  el.querySelectorAll('.key-moment').forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.dataset.start);
      const m = moments.find((x) => x.startIdx === idx);
      if (!m) return;
      $('clicked').innerHTML = `<b>關鍵話點 · ${escapeHTML(m.label)}</b> [${fmt(m.start)}]<br>
        業務：${escapeHTML(m.salesText)}<br>
        客戶（${m.customerChars}字）：${escapeHTML(m.customerText)}`;
      btn.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
  });
}

export function drawChart(segs, moments = []) {
  const vals = segs.map((s) => s.chars);
  const colors = segs.map((s) => (s.spk === 'S' ? 'rgba(237,237,237,.9)' : 'rgba(255,90,60,.9)'));
  const borders = momentBarHighlight(segs, moments);
  if (chart) chart.destroy();
  chart = new Chart($('chart'), {
    type: 'bar',
    data: {
      labels: segs.map((s) => fmt(s.start)),
      datasets: [
        {
          label: '每句字數（白=業務 紅=客戶）',
          data: vals,
          backgroundColor: colors,
          borderColor: borders,
          borderWidth: borders.map((b) => (b === 'transparent' ? 0 : 2)),
          borderRadius: 3,
        },
      ],
    },
    plugins: [keyMomentPlugin(moments)],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (e, els) => {
        if (els.length) {
          const s = segs[els[0].index];
          const hit = moments.find((m) => m.startIdx === els[0].index || m.endIdx === els[0].index);
          const tag = hit ? ` · 關鍵話點：${hit.label}` : '';
          $('clicked').textContent = `[${fmt(s.start)}] ${s.spk === 'S' ? '業務' : '客戶'}（${s.chars}字）${tag}：${s.text}`;
        }
      },
      plugins: {
        legend: { labels: { color: '#8a8a8a', font: { family: 'JetBrains Mono' } } },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items[0].dataIndex;
              const s = segs[idx];
              const hit = moments.find((m) => m.startIdx === idx || m.endIdx === idx);
              const lines = [`${s.spk === 'S' ? '業務：' : '客戶：'}${s.text.length > 50 ? `${s.text.slice(0, 50)}…` : s.text}`];
              if (hit) lines.unshift(`★ 關鍵話點：${hit.label}`);
              return lines;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#5a5a5a', maxTicksLimit: 18, font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' } },
        y: { ticks: { color: '#5a5a5a', font: { family: 'JetBrains Mono', size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' } },
      },
    },
  });
  renderKeyMomentsLegend(moments);
}
