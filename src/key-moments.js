import { RULES } from './rules.js';
import { isQuestion } from './speaker.js';

const EXTENDED_PROBES = [
  { layer: 1, re: /為什麼想.{0,10}(增加|提高|賺|多).{0,4}收入|收入.{0,6}(目標|期望)/ },
  { layer: 2, re: /現在.{0,10}(收入|狀況|情況).{0,10}(什麼|發生).{0,6}問題|收入.{0,6}發生什麼/ },
  { layer: 4, re: /為什麼是現在|為什麼這時候|為什麼.{0,6}現在/ },
  { layer: 5, re: /真正想要.{0,10}(生活|人生|日子|未來)|想要的生活|理想.{0,6}生活/ },
  { layer: 4, re: /為什麼一直沒有行動|為什麼沒有行動|一直沒有.{0,6}行動/ },
];

const MOMENT_COLORS = {
  l1: 'rgba(90, 160, 120, 0.18)',
  l2: 'rgba(90, 160, 120, 0.22)',
  l3: 'rgba(100, 175, 130, 0.26)',
  l4: 'rgba(110, 185, 140, 0.30)',
  l5: 'rgba(120, 195, 150, 0.34)',
  converge: 'rgba(80, 150, 220, 0.28)',
  amplify: 'rgba(255, 170, 60, 0.28)',
  discovery: 'rgba(90, 160, 120, 0.20)',
};

function substantialThreshold(segs) {
  const custChars = segs.filter((s) => s.spk === 'C').map((s) => s.chars);
  if (!custChars.length) return 8;
  const avg = custChars.reduce((a, b) => a + b, 0) / custChars.length;
  const sorted = [...custChars].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return Math.max(8, Math.min(avg * 0.55, median * 0.85));
}

function classifyLayer(salesText, customerText) {
  for (const layer of RULES.layers) {
    if (layer.re.test(salesText)) return layer;
  }
  for (const probe of EXTENDED_PROBES) {
    if (probe.re.test(salesText)) return RULES.layers[probe.layer - 1];
  }
  for (const layer of RULES.layers) {
    if ((layer.customerRe || layer.re).test(customerText)) return layer;
  }
  return null;
}

function isAmplification(text) {
  return (
    RULES.steps[2].re.test(text) || RULES.painPattern.test(text) || RULES.gainPattern.test(text)
  );
}

export function detectKeyMoments(segs) {
  if (!segs.length) return [];
  const minChars = substantialThreshold(segs);
  const moments = [];
  const used = new Set();

  for (let i = 0; i < segs.length - 1; i++) {
    const sales = segs[i];
    const customer = segs[i + 1];
    if (sales.spk !== 'S' || customer.spk !== 'C') continue;

    const isConvergeQ = RULES.converge.test(sales.text);
    const isAmpQ = isAmplification(sales.text);
    const requiredChars = isConvergeQ || isAmpQ ? 2 : minChars;
    if (customer.chars < requiredChars) continue;

    let type;
    let label;
    let detail;

    if (isConvergeQ) {
      type = 'converge';
      label = '收斂驗證';
      detail = '業務複述理解，等待客戶確認';
    } else if (isAmpQ) {
      type = 'amplify';
      label = '強化';
      detail = '說明不改變的代價（須連結挖掘內容）';
    } else {
      const layer = classifyLayer(sales.text, customer.text);
      if (layer) {
        type = `l${layer.n}`;
        label = `${layer.name} ${layer.manualName || ''}`.trim();
        detail = layer.sug;
      } else if (isQuestion(sales.text)) {
        type = 'discovery';
        label = '挖掘';
        detail = '業務提問後客戶深入回應';
      } else {
        continue;
      }
    }

    const key = `${type}-${i}`;
    if (used.has(key)) continue;
    used.add(key);

    moments.push({
      type,
      label,
      detail,
      color: MOMENT_COLORS[type] || MOMENT_COLORS.discovery,
      startIdx: i,
      endIdx: i + 1,
      start: sales.start,
      end: customer.end,
      salesText: sales.text,
      customerText: customer.text,
      customerChars: customer.chars,
    });
  }

  return moments;
}

export function momentBarHighlight(segs, moments) {
  const highlighted = new Set();
  moments.forEach((m) => {
    highlighted.add(m.startIdx);
    highlighted.add(m.endIdx);
  });
  return segs.map((_, i) => (highlighted.has(i) ? 'rgba(255, 210, 80, 0.95)' : 'transparent'));
}
