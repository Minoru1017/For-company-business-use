import { RULES } from './rules.js';

const STOP_WORDS = new Set([
  '如果',
  '就是',
  '可以',
  '我們',
  '這個',
  '什麼',
  '沒有',
  '因為',
  '所以',
  '一下',
  '了解',
  '想要',
  '需要',
  '目前',
  '真的',
  '請問',
  '方便',
  '然後',
  '其實',
  '應該',
  '覺得',
  '自己',
  '怎麼',
  '還是',
]);

export function findLayerHit(segs, layer) {
  const sales = segs.find((s) => s.spk === 'S' && layer.re.test(s.text));
  const customer = segs.find((s) => s.spk === 'C' && (layer.customerRe || layer.re).test(s.text));
  return sales || customer || null;
}

export function buildLayerHits(segs) {
  return RULES.layers.map((L) => ({ ...L, hit: findLayerHit(segs, L) }));
}

function chineseTokens(text) {
  const chars = String(text).match(/[\u4e00-\u9fff]/g) || [];
  const tokens = new Set();
  for (let i = 0; i < chars.length - 1; i++) {
    const bi = chars[i] + chars[i + 1];
    if (!STOP_WORDS.has(bi)) tokens.add(bi);
    if (i < chars.length - 2) {
      const tri = bi + chars[i + 2];
      if (!STOP_WORDS.has(tri)) tokens.add(tri);
    }
  }
  return [...tokens];
}

export function sharesDiscoveryTerms(customerTexts, salesText) {
  const pool = new Set(customerTexts.flatMap((t) => chineseTokens(t)));
  const salesTokens = chineseTokens(salesText);
  return salesTokens.some((t) => pool.has(t));
}

function verdictStatus(allPass, partialPass) {
  if (allPass) return 'pass';
  if (partialPass) return 'partial';
  return 'fail';
}

function statusLabel(status) {
  if (status === 'pass') return '通過';
  if (status === 'partial') return '部分達標';
  return '未達標';
}

export function evaluateManualRules(segs, { layerHits, convergeSeg, sQuestions }) {
  const S = segs.filter((s) => s.spk === 'S');
  const C = segs.filter((s) => s.spk === 'C');
  const deepest = layerHits.filter((L) => L.hit).length ? Math.max(...layerHits.filter((L) => L.hit).map((L) => L.n)) : 0;
  const layersComplete = layerHits.every((L) => L.hit);

  const discoveryCriteria = layerHits.map((L) => ({
    key: `l${L.n}`,
    label: `${L.name}（${L.manualName || L.name}）`,
    pass: !!L.hit,
    hint: L.hit ? null : L.sug,
  }));
  discoveryCriteria.push({
    key: 'converge',
    label: '收斂驗證（理解對嗎）',
    pass: !!convergeSeg,
    hint: '業務需複述：「所以你真正想解決的是＿＿，因為＿＿；你真正需要的是＿＿，我理解對嗎？」',
  });
  discoveryCriteria.push({
    key: 'questions',
    label: '開放式提問（業務 ≥3 句）',
    pass: sQuestions.length >= 3,
    hint: `目前業務提問 ${sQuestions.length} 句，需持續用開放式問題挖掘`,
  });

  const discoveryPass = layersComplete && convergeSeg && sQuestions.length >= 3;
  const discoveryPartial = deepest >= 3 || convergeSeg || sQuestions.length >= 2;
  const discoveryStatus = verdictStatus(discoveryPass, discoveryPartial);

  const painUse = S.find((s) => RULES.painPattern.test(s.text));
  const gainUse = S.find((s) => RULES.gainPattern.test(s.text));
  const fearSegs = S.filter((s) => RULES.fearWords.test(s.text));
  const deepCustomerTexts = C.filter(
    (s) =>
      RULES.layers[2].re.test(s.text) ||
      RULES.layers[2].customerRe?.test(s.text) ||
      RULES.layers[3].re.test(s.text) ||
      RULES.layers[3].customerRe?.test(s.text) ||
      RULES.layers[4].re.test(s.text) ||
      RULES.layers[4].customerRe?.test(s.text) ||
      RULES.motto.some((m) => m.re.test(s.text))
  ).map((s) => s.text);
  const ampSegs = S.filter(
    (s) => RULES.steps[2].re.test(s.text) || RULES.painPattern.test(s.text) || RULES.gainPattern.test(s.text)
  );
  const linkedToDiscovery =
    deepCustomerTexts.length > 0 && ampSegs.some((s) => sharesDiscoveryTerms(deepCustomerTexts, s.text));

  const amplificationCriteria = [
    {
      key: 'pattern',
      label: '使用強化句型（沒有…就會／如果能…就能）',
      pass: !!(painUse || gainUse),
      hint: '強化階段需用痛苦型或卓越型句型，幫客戶面對不改變的代價',
    },
    {
      key: 'link',
      label: '強化內容連結挖掘（L3–L5 客戶原話）',
      pass: linkedToDiscovery,
      hint: '強化時須引用客戶在影響／意義／終局層說過的話，不可自創恐懼',
    },
    {
      key: 'nofear',
      label: '未製造恐懼（手冊底線）',
      pass: fearSegs.length === 0,
      hint: fearSegs.length ? `偵測到 ${fearSegs.length} 句恐嚇式用語` : null,
    },
  ];

  const ampPassCount = amplificationCriteria.filter((c) => c.pass).length;
  const amplificationPass = ampPassCount === 3;
  const amplificationPartial = ampPassCount >= 1 && fearSegs.length === 0;
  const amplificationStatus = verdictStatus(amplificationPass, amplificationPartial);

  return {
    discovery: {
      title: '挖掘 Discovery',
      subtitle: '五層資訊須由客戶話語呈現，並完成收斂驗證後才能進入強化',
      status: discoveryStatus,
      statusLabel: statusLabel(discoveryStatus),
      deepest,
      layersComplete,
      criteria: discoveryCriteria,
      summary:
        discoveryStatus === 'pass'
          ? '五層挖掘完整，且已完成收斂驗證，符合手冊標準。'
          : discoveryStatus === 'partial'
            ? `已挖到第 ${deepest} 層，但尚未完全符合手冊（需五層＋收斂驗證）。`
            : '挖掘深度不足，資訊不足以做適配判斷。',
    },
    amplification: {
      title: '強化 Amplification',
      subtitle: '說明「不改變的代價」，內容須來自挖掘階段客戶原話，不可製造恐懼',
      status: amplificationStatus,
      statusLabel: statusLabel(amplificationStatus),
      criteria: amplificationCriteria,
      painUse,
      gainUse,
      fearCount: fearSegs.length,
      summary:
        amplificationStatus === 'pass'
          ? '強化句型到位，且連結客戶原話，未製造恐懼。'
          : amplificationStatus === 'partial'
            ? '有部分強化跡象，但句型、連結挖掘或底線檢核尚未全部達標。'
            : '未偵測到有效強化，或違反「不可製造恐懼」底線。',
    },
  };
}
