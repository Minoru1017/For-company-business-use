import { buildDeepReasoning } from './purpose-reasoning.js';

/** 五種「學 AI 背後的目的類型」— 先分類 → 深層推理 → 分別強化 → 用客戶想聽的話對接 */

export const PURPOSE_TYPES = [
  {
    key: 'want',
    label: '要什麼',
    purpose: '補缺口、解決當下缺什麼',
    aiPurpose: '學 AI 是為了補上現在缺的能力或工具，讓工作能繼續運轉',
    re: /想要|需要|希望(可以|能)|想學|想用|想做|缺|不夠|沒有.{0,6}(工具|能力|方法)/,
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
    purpose: '避開風險與損失',
    aiPurpose: '學 AI 是為了不要失去現有位置、收入或競爭力',
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
    purpose: '進入某個圈子、跟上趨勢',
    aiPurpose: '學 AI 是為了跟對人、跟得上業界，不想被排除在外',
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
    purpose: '被怎樣看待、專業形象',
    aiPurpose: '學 AI 是為了被當專業人士、被尊重、被肯定',
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
    purpose: '意義、影響力、自我實現',
    aiPurpose: '學 AI 是為了成為想成為的人、幫助他人、留下影響',
    re: /成就感|很爽|開心|有面子|被(稱讚|肯定|認可)|驕傲|幫(助|到)|影響|意義|想變成|理想/,
    probe: '如果做到了，什麼會讓你覺得一切都值得？你想成為什麼樣的人？',
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

  const recommendations = [];
  const deepReasoning = buildDeepReasoning(segs, { signals, dominant, secondary });

  if (!signals.length) {
    recommendations.push({
      type: 'probe',
      text: '尚未判斷客戶學 AI 的目的類型。先用五層挖掘，再從客戶原話判斷是「要／怕／想／愛／爽」哪一型。',
    });
  } else {
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
    deepReasoning,
    recommendations,
  };
}

/** Backward-compatible motto list for other modules */
export function purposeMottoRules() {
  return PURPOSE_TYPES.map((t) => ({ key: t.label, re: t.re }));
}
