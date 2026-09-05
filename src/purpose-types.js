import { buildDeepReasoning } from './purpose-reasoning.js';
import { isQuestion } from './speaker.js';

/** 五種「學 AI 目的分級」— 先判斷分級 → 依分級往下挖五層 → 用他想聽的話強化與對接（勿硬導向其他分級） */

/** 各分級專屬五層挖掘路徑（不是通用現況→問題→影響） */
export const TYPE_DISCOVERY_LAYERS = {
  want: [
    { n: 1, name: '要什麼', question: '你現在最缺的是什麼？', re: /缺|需要|想要|不夠|沒有.{0,6}(工具|能力|方法)/ },
    { n: 2, name: '缺了會怎樣', question: '沒有它，明天會怎樣？', re: /沒有.{0,12}就(會|得)|缺.{0,8}(就|會)|卡(在|住)|來不及/ },
    { n: 3, name: '怎麼補', question: '若有對的方法，你想先補哪一塊？', re: /補(上|齊)|學(會|到)|用(起來|上)|解決|處理/ },
    { n: 4, name: '補上的意義', question: '補上之後，對你工作最大的改變是什麼？', re: /改變|省(時間|力)|效率|輕鬆|順(了|利)|不用.{0,6}重工/ },
    { n: 5, name: '真的補齊', question: '你怎樣可以變成不再缺這塊的人？', re: /變成|不再|掌握|熟練|能(自己|獨立)|真的(會|能)/ },
  ],
  fear: [
    { n: 1, name: '怕什麼', question: '你最擔心的是什麼？', re: /擔心|害怕|怕|焦慮|風險/ },
    { n: 2, name: '發生代價', question: '如果真的發生，代價是什麼？', re: /代價|失去|落後|被淘汰|影響|後果/ },
    { n: 3, name: '怎麼避', question: '你現在為這件事做了什麼防範？', re: /防範|避免|先|準備|努力|學(習|會)/ },
    { n: 4, name: '恐懼的意義', question: '這個擔心對你來說代表什麼？', re: /代表|意味|重要|不能|受不了|壓力/ },
    { n: 5, name: '真正安心', question: '你怎樣可以不再被這件事卡住？', re: /安心|放心|不再|解決|擺脫|踏實/ },
  ],
  think: [
    { n: 1, name: '想什麼', question: '你想加入的是哪個圈子？', re: /圈子|同行|趨勢|跟上|想成為/ },
    { n: 2, name: '在內在外', question: '現在你覺得自己在裡面還是外面？', re: /裡面|外面|落單|被排除|跟不上|觀望/ },
    { n: 3, name: '如何跟上', question: '你想怎麼跟這群人站在一起？', re: /跟(上|著)|一起|學(習|會)|交流|參與/ },
    { n: 4, name: '歸屬意義', question: '進到這個圈子，對你代表什麼？', re: /代表|意義|歸屬|認同|不孤單|專業(感|人士)/ },
    { n: 5, name: '真正融入', question: '你怎樣可以覺得自己真的跟上了？', re: /真的|融入|跟上|不(再|會)落後|成為.{0,6}一員/ },
  ],
  love: [
    { n: 1, name: '愛什麼', question: '你希望別人怎麼看你？', re: /被(看見|肯定|稱讚|尊重)|形象|專業|地位/ },
    { n: 2, name: '怎樣被看', question: '什麼樣的評價對你最重要？', re: /評價|看法|認為|尊重|懂.{0,4}的|專業/ },
    { n: 3, name: '如何被看', question: '你做什麼會讓別人這樣看你？', re: /做(到|出)|展現|證明|讓別人|表現/ },
    { n: 4, name: '被看重意義', question: '這種看法對你來說有多重要？', re: /重要|在意|在乎|不能|受不了|面子/ },
    { n: 5, name: '真正被認可', question: '你怎樣可以真的被當成那種人？', re: /真的|被當|認可|稱讚|專業人士|不是跟風/ },
  ],
  enjoy: [
    { n: 1, name: '爽什麼', question: '對你來說，什麼事會讓你覺得真的很爽、很值得？', re: /爽|成就|意義|影響|自我證明|證明自己|驕傲|幫(助|到)/ },
    { n: 2, name: '你怎樣爽', question: '你怎樣會覺得爽？', re: /怎樣|感覺|覺得|開心|有面子|被(稱讚|肯定)/ },
    { n: 3, name: '如何爽', question: '要做到什麼，你才會真的爽？', re: /做到|達成|完成|用(起來|上)|帶著|影響/ },
    { n: 4, name: '爽的意義', question: '這個爽對你的意義是什麼？', re: /意義|值得|想變成|理想|成為.{0,8}人|價值/ },
    { n: 5, name: '真的爽歪歪', question: '你怎樣可以變得真的爽歪歪？', re: /爽歪歪|真的|徹底|完全|夢想|想成為|帶著團隊/ },
  ],
};

/** 業務問句若命中其他分級的探針，視為「問錯方向」 */
const WRONG_PROBE_PATTERNS = {
  want: [
    { toward: '怕什麼', re: /最(深|大)的?恐懼|擔心(什麼|的是)|害怕(什麼|的是)|怕(什麼|被)/ },
    { toward: '爽什麼', re: /爽(什麼|歪歪)|成就感|意義(是什麼|在哪)/ },
  ],
  fear: [
    { toward: '要什麼', re: /最缺(什麼|的是)|缺(什麼|哪)/ },
    { toward: '爽什麼', re: /爽(什麼|歪歪)|想成為什麼樣的人/ },
  ],
  think: [
    { toward: '怕什麼', re: /最(深|大)的?恐懼|擔心(什麼|的是)|害怕(什麼|的是)/ },
    { toward: '要什麼', re: /最缺(什麼|的是)|缺(什麼|哪)/ },
  ],
  love: [
    { toward: '怕什麼', re: /最(深|大)的?恐懼|擔心(什麼|的是)|害怕(什麼|的是)/ },
    { toward: '要什麼', re: /最缺(什麼|的是)|缺(什麼|哪)/ },
  ],
  enjoy: [
    { toward: '怕什麼', re: /最(深|大)的?恐懼|擔心(什麼|的是)|害怕(什麼|的是)|怕(什麼|被)|會失去什麼/ },
    { toward: '要什麼', re: /最缺(什麼|的是)|缺(什麼|哪)|沒有它會怎樣/ },
  ],
};

export function getTypeDiscoveryLayers(typeKey) {
  return TYPE_DISCOVERY_LAYERS[typeKey] || [];
}

export function buildTypeLayerHits(segs, typeKey) {
  const layers = getTypeDiscoveryLayers(typeKey);
  if (!layers.length) return [];
  const S = segs.filter((s) => s.spk === 'S');
  const C = segs.filter((s) => s.spk === 'C');
  return layers.map((L) => {
    const salesQ = S.find((s) => isQuestion(s.text) && L.re.test(s.text));
    const customer = C.find((s) => L.re.test(s.text));
    return {
      ...L,
      hit: !!(salesQ || customer),
      salesHit: salesQ || null,
      customerHit: customer || null,
    };
  });
}

export function detectWrongProbes(segs, dominant) {
  if (!dominant?.key) return [];
  const patterns = WRONG_PROBE_PATTERNS[dominant.key] || [];
  const S = segs.filter((s) => s.spk === 'S' && isQuestion(s.text));
  const wrong = [];
  for (const seg of S) {
    for (const p of patterns) {
      if (p.re.test(seg.text)) {
        wrong.push({
          seg,
          toward: p.toward,
          dominant: dominant.label,
          message: `客戶主導分級是「${dominant.label}」，但業務問了「${p.toward}」方向的問題——勿硬導向其他分級`,
        });
        break;
      }
    }
  }
  return wrong;
}

export const PURPOSE_TYPES = [
  {
    key: 'want',
    label: '要什麼',
    tierLabel: '分級：要什麼',
    purpose: '補缺口、解決當下缺什麼',
    aiPurpose: '學 AI 是為了補上現在缺的能力或工具，讓工作能繼續運轉',
    dontForceTo: ['怕什麼', '爽什麼'],
    antiPattern: '學員是要什麼時，勿硬問「最深恐懼」或往爽什麼導——就在「缺什麼」這條線往下挖',
    re: /想要|需要|希望(可以|能)|想用|想做|缺|不夠|沒有.{0,6}(工具|能力|方法)/,
    probe: '你現在最缺的是什麼？沒有它，明天會怎樣？',
    amplify: '強調「有了之後，缺口被補上」— 用客戶自己說的缺什麼來講不改變的代價',
    amplifyExample: '沒有把＿＿這段補起來，每週就會繼續在＿＿上多花時間重工',
    pitch: '這套就是直接幫你把＿＿補起來，學完馬上能用在日常工作上',
    amplifyRe: /沒有.{0,15}就(會|沒|不)|缺.{0,8}(就|會|讓)|補(上|齊)|沒.{0,6}就(會|得)/,
    pitchRe: /直接(幫|處理|解決)|補(上|齊)|馬上(能|可以)|用在.{0,8}(工作|日常)/,
  },
  {
    key: 'fear',
    label: '怕什麼',
    tierLabel: '分級：怕什麼',
    purpose: '避開風險與損失',
    aiPurpose: '學 AI 是為了不要失去現有位置、收入或競爭力',
    dontForceTo: ['爽什麼', '要什麼'],
    antiPattern: '學員是怕什麼時，就在「擔心什麼」往下挖，勿硬轉成自我實現或補缺口',
    re: /擔心|害怕|怕(被|跟不上|來不及)?|焦慮|被淘汰|風險|壓力|失去|落後/,
    probe: '你最擔心的是什麼？如果真的發生，代價是什麼？',
    amplify: '強調「不改變會失去什麼」— 只能放大客戶自己說過的擔憂，不可自創恐懼',
    amplifyExample: '如果一直不動，你擔心的＿＿真的會發生，而且代價是＿＿',
    pitch: '你擔心的不是會不會用 AI，而是會不會被甩在後面——這裡就是幫你補上那段',
    amplifyRe: /沒有.{0,15}就(會|沒|不)|一直.{0,10}(就|會).{0,10}(失去|落後|影響|代價)|擔心.{0,10}(就|會)/,
    pitchRe: /擔心|風險|落後|甩在後面|補上.{0,8}段/,
  },
  {
    key: 'think',
    label: '想什麼',
    tierLabel: '分級：想什麼',
    purpose: '進入某個圈子、跟上趨勢',
    aiPurpose: '學 AI 是為了跟對人、跟得上業界，不想被排除在外',
    dontForceTo: ['怕什麼', '要什麼'],
    antiPattern: '學員是想什麼時，就在「圈子／歸屬」往下挖，勿硬問恐懼或缺什麼',
    re: /想成為|目標|想做到|想轉(職|行)|未來想|下個階段|跟上|趨勢|圈子|同行|不落後/,
    probe: '你想加入的是哪個圈子？現在你覺得自己在裡面還是外面？',
    amplify: '強調「不跟上會被排除在哪個圈子之外」— 用客戶說過的歸屬感來講',
    amplifyExample: '如果一直觀望，你可能會持續覺得自己還在圈子外，看著別人先動',
    pitch: '你會跟一群已經在用的同行一起學，不會自己摸索、也不會落單',
    amplifyRe: /跟(不上|得上)|圈子|同行|趨勢|觀望|落單|被排除|外面/,
    pitchRe: /同行|一起學|圈子|跟(得上|上)|不落後/,
  },
  {
    key: 'love',
    label: '愛什麼',
    tierLabel: '分級：愛什麼',
    purpose: '被怎樣看待、專業形象',
    aiPurpose: '學 AI 是為了被當專業人士、被尊重、被肯定',
    dontForceTo: ['怕什麼', '要什麼'],
    antiPattern: '學員是愛什麼時，就在「別人怎麼看你」往下挖，勿硬問恐懼或缺什麼',
    re: /喜歡|有興趣|感興趣|覺得不錯|蠻喜歡|熱情|專業|被(看見|肯定|稱讚|尊重)|形象|地位/,
    probe: '你希望別人怎麼看你？什麼樣的評價對你最重要？',
    amplify: '強調「別人會怎麼看你」— 連結客戶在意的尊嚴與專業感',
    amplifyExample: '如果一直不動，別人可能還是把你當「跟風的」而不是「懂 AI 的專業人士」',
    pitch: '學完別人會覺得你是懂 AI 的那個人，不是跟風湊熱鬧的',
    amplifyRe: /被(看見|當|認為)|專業|形象|跟風|懂.{0,4}的(人|那個)/,
    pitchRe: /專業|被(看見|肯定|稱讚)|懂.{0,4}的(人|那個)|不是跟風/,
  },
  {
    key: 'enjoy',
    label: '爽什麼',
    tierLabel: '分級：爽什麼',
    purpose: '意義、影響力、自我證明',
    aiPurpose: '學 AI 是為了自我證明、成為想成為的人、留下影響——不是因為恐懼或缺什麼',
    dontForceTo: ['要什麼', '怕什麼'],
    antiPattern: '學員是爽什麼（如自我證明）時，勿硬問「最深恐懼」——對方可能根本沒有，就在「爽」這條線往下挖五層',
    re: /成就感|很爽|開心|有面子|被(稱讚|肯定|認可)|驕傲|幫(助|到)|影響|意義|想變成|理想|自我證明|證明自己|爽歪歪/,
    probe: '對你來說，什麼事會讓你覺得真的很爽、很值得？',
    amplify: '強調「做到之後會成為什麼樣的人」— 用客戶說過的願景來講',
    amplifyExample: '如果能真正把 AI 用起來，你就能＿＿，這才是你真正想要的',
    pitch: '你學會之後可以帶著團隊一起升級，這才是你真正想達成的影響力',
    amplifyRe: /(如果|要是)能.{0,20}就(能|可以|會)|成為.{0,8}(人|樣)|值得|影響/,
    pitchRe: /(如果|要是)能|成為|影響|幫(助|到)|帶著/,
  },
];

export function detectPurposeSignals(segs) {
  const C = segs.filter((s) => s.spk === 'C');
  return PURPOSE_TYPES.map((t) => {
    const hits = C.filter((s) => t.re.test(s.text));
    return {
      ...t,
      hits,
      score: hits.reduce((a, s) => a + s.chars, 0),
      evidence: hits[0] || null,
    };
  })
    .filter((t) => t.hits.length > 0)
    .sort((a, b) => b.score - a.score);
}

export function buildPurposeProfile(segs) {
  const S = segs.filter((s) => s.spk === 'S');
  const signals = detectPurposeSignals(segs);
  const dominant = signals[0] || null;
  const secondary = signals[1] || null;

  const matchedAmplify = dominant ? S.find((s) => dominant.amplifyRe.test(s.text)) : null;
  const matchedPitch = dominant ? S.find((s) => dominant.pitchRe.test(s.text)) : null;
  const typeLayerHits = dominant ? buildTypeLayerHits(segs, dominant.key) : [];
  const typeDeepest = typeLayerHits.filter((L) => L.hit).length
    ? Math.max(...typeLayerHits.filter((L) => L.hit).map((L) => L.n))
    : 0;
  const wrongProbes = detectWrongProbes(segs, dominant);

  const recommendations = [];
  const deepReasoning = buildDeepReasoning(segs, { signals, dominant, secondary });

  if (!signals.length) {
    recommendations.push({
      type: 'probe',
      text: '尚未判斷客戶學 AI 的目的分級。先從客戶原話判斷是「要／怕／想／愛／爽」哪一型，再依該分級往下挖五層。',
    });
  } else {
    if (dominant) {
      recommendations.push({
        type: 'tier',
        label: dominant.tierLabel,
        text: dominant.antiPattern,
      });
      const nextLayer = typeLayerHits.find((L) => !L.hit);
      if (nextLayer) {
        recommendations.push({
          type: 'dig',
          label: `${dominant.label} L${nextLayer.n}：${nextLayer.name}`,
          text: `依分級往下挖：<span class="q">「${nextLayer.question}」</span>`,
        });
      }
    }
    signals.forEach((t, i) => {
      const role = i === 0 ? '主導' : '次要';
      recommendations.push({
        type: 'classify',
        label: `${role}：${t.label}`,
        purpose: t.purpose,
        text: `學 AI 背後目的 — ${t.aiPurpose}`,
      });
      recommendations.push({
        type: 'amplify',
        label: `${t.label} → 強化`,
        text: `${t.amplify} 例：<span class="q">「${t.amplifyExample}」</span>`,
      });
      recommendations.push({
        type: 'pitch',
        label: `${t.label} → 對接`,
        text: `用客戶想聽的話：<span class="q">「${t.pitch}」</span>`,
      });
    });
    wrongProbes.forEach((w) => {
      recommendations.push({
        type: 'wrongProbe',
        label: `問錯方向 → ${w.toward}`,
        text: w.message,
      });
    });
  }

  return {
    signals,
    dominant,
    secondary,
    matchedAmplify,
    matchedPitch,
    classified: signals.length > 0,
    amplifyMatched: !!matchedAmplify,
    pitchMatched: !!matchedPitch,
    typeLayerHits,
    typeDeepest,
    wrongProbes,
    deepReasoning,
    recommendations,
  };
}

/** Backward-compatible motto list for other modules */
export function purposeMottoRules() {
  return PURPOSE_TYPES.map((t) => ({ key: t.label, re: t.re }));
}
