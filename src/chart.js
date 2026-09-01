import { $, fmt } from './utils.js';

let chart = null;

export function drawChart(segs) {
  const vals = segs.map((s) => s.chars);
  const colors = segs.map((s) => (s.spk === 'S' ? 'rgba(237,237,237,.9)' : 'rgba(255,90,60,.9)'));
  if (chart) chart.destroy();
  chart = new Chart($('chart'), {
    type: 'bar',
    data: {
      labels: segs.map((s) => fmt(s.start)),
      datasets: [{ label: '每句字數（白=業務 紅=客戶）', data: vals, backgroundColor: colors, borderRadius: 3 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (e, els) => {
        if (els.length) {
          const s = segs[els[0].index];
          $('clicked').textContent = `[${fmt(s.start)}] ${s.spk === 'S' ? '業務' : '客戶'}（${s.chars}字）：${s.text}`;
        }
      },
      plugins: {
        legend: { labels: { color: '#8a8a8a', font: { family: 'JetBrains Mono' } } },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const s = segs[items[0].dataIndex];
              return `${s.spk === 'S' ? '業務：' : '客戶：'}${s.text.length > 50 ? `${s.text.slice(0, 50)}…` : s.text}`;
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
}
