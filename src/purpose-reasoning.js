/** 五種目的類型的深層推理鏈：表面話語 → 深層目的 → 常見誤判 → 收斂驗證 */

export const DEEP_REASONING_META = {
  want: {
    deepQuestion: '他缺的是「工具／方法」還是「結果」？沒有它明天會怎樣？',
    surfaceTrap: '客戶說「想學 AI」只是表面詞，不等於已確認是「要什麼」',
    wrongRead: '勿誤判成「怕什麼」——若只說想學、未提擔心失去，還需往下問缺口',
    verify: '你現在最缺的是哪一塊？沒有它，明天會怎樣？',
    deepRe: /缺|不夠|沒有.{0,8}(時間|工具|方法|人)|補|來不及做|卡在做/,
  },
  fear: {
    deepQuestion: '他怕失去的是收入、位置、尊嚴，還是被誰看不起？',
    surfaceTrap: '「壓力大」可能是要什麼（缺資源）或怕什麼（怕後果），需區分',
    wrongRead: '勿誤判成「要什麼」——若核心是擔心後果而非缺工具，才是「怕什麼」',
    verify: '你最擔心的是什麼？如果真的發生，代價是什麼？',
    deepRe: /擔心|害怕|怕|焦慮|被淘汰|落後|失去|風險|跟不上/,
  },
  think: {
    deepQuestion: '他想加入的是哪個圈子？現在覺得自己在裡面還是外面？',
    surfaceTrap: '「想跟上趨勢」可能是想什麼（歸屬）或要什麼（缺能力），要問清楚',
    wrongRead: '勿誤判成「爽什麼」——若還在談跟不跟得上別人，是「想什麼」不是終局願景',
    verify: '你想跟誰站在一起？什麼事會讓你覺得自己還在圈子外？',
    deepRe: /圈子|同行|趨勢|跟上|不落後|被排除|外面|同業|大家都有/,
  },
  love: {
    deepQuestion: '他希望被誰、以什麼方式看重？什麼評價最重要？',
    surfaceTrap: '「想被肯定」可能是愛什麼（形象）或爽什麼（成就感），層次不同',
    wrongRead: '勿誤判成「想什麼」——若焦點是「別人怎麼看我」而非「跟誰一組」，是「愛什麼」',
    verify: '你希望別人怎麼看你？什麼樣的評價對你最重要？',
    deepRe: /被(看見|肯定|稱讚|尊重)|專業|形象|地位|跟風|懂.{0,4}的/,
  },
  enjoy: {
    deepQuestion: '做到之後，什麼會讓他覺得一切都值得？想成為什麼樣的人？',
    surfaceTrap: '「想有成就」可能是爽什麼（意義）或愛什麼（被看見），要問終局',
    wrongRead: '勿誤判成「要什麼」或「怕什麼」——若談的是自我證明、意義、影響力，就在爽什麼往下挖，勿硬問恐懼或缺什麼',
    verify: '如果做到了，什麼會讓你覺得一切都值得？你想成為什麼樣的人？',
    deepRe: /成就|意義|影響|幫(助|到)|想變成|理想|帶著|值得|驕傲/,
  },
};

function pickCustomerQuote(segs, re) {
  const hits = segs.filter((s) => s.spk === 'C' && re.test(s.text));
  if (!hits.length) return null;
  return hits.sort((a, b) => b.chars - a.chars)[0];
}

function clip(text, max = 80) {
  const t = String(text || '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * 從逐字稿推敲五種目的類型的深層推理（規則引擎版，供本機分析與 AI 標註參考）
 */
export function buildDeepReasoning(segs, profile) {
  const C = segs.filter((s) => s.spk === 'C');
  if (!profile?.dominant || !C.length) {
    return {
      ready: false,
      summary: '尚未分類目的類型，或客戶發言不足——先完成五層挖掘再推敲深層動機。',
      chains: [],
    };
  }

  const chains = [];
  const typesToReason = profile.signals.slice(0, 2);

  for (const typeHit of typesToReason) {
    const meta = DEEP_REASONING_META[typeHit.key];
    if (!meta) continue;

    const surface =
      pickCustomerQuote(segs, /想學|AI|人工智慧|想學習/) ||
      typeHit.evidence ||
      C.find((s) => s.chars >= 4) ||
      C[0];
    const deep = pickCustomerQuote(segs, meta.deepRe) || typeHit.evidence || surface;
    const role = typeHit.key === profile.dominant.key ? '主導' : '次要';

    const confidence =
      deep && surface && deep.text !== surface.text
        ? 'medium'
        : typeHit.hits.length >= 2
          ? 'medium'
          : 'low';

    chains.push({
      role,
      typeKey: typeHit.key,
      label: typeHit.label,
      confidence,
      steps: [
        {
          key: 'surface',
          title: '① 表面陳述',
          quote: clip(surface?.text),
          insight: meta.surfaceTrap,
        },
        {
          key: 'deep',
          title: '② 深層目的',
          quote: clip(deep?.text),
          insight: typeHit.aiPurpose,
          question: meta.deepQuestion,
        },
        {
          key: 'wrong',
          title: '③ 常見誤判',
          quote: null,
          insight: meta.wrongRead,
        },
        {
          key: 'verify',
          title: '④ 收斂驗證',
          quote: null,
          insight: `業務應複述理解並確認：「${meta.verify}」→ 客戶說「對」才算推對`,
        },
        {
          key: 'amplify',
          title: '⑤ 分別強化',
          quote: null,
          insight: typeHit.amplify,
          example: typeHit.amplifyExample,
        },
        {
          key: 'pitch',
          title: '⑥ 對接話術',
          quote: null,
          insight: '用客戶想聽的話，不換成業務自己的話術',
          example: typeHit.pitch,
        },
      ],
    });
  }

  const ambiguous =
    profile.secondary && profile.secondary.score >= profile.dominant.score * 0.55;
  const summary = ambiguous
    ? `主導「${profile.dominant.label}」，但「${profile.secondary.label}」訊號也強——需用收斂驗證釐清，勿急著選一邊強化。`
    : `主導「${profile.dominant.label}」：${DEEP_REASONING_META[profile.dominant.key].deepQuestion}`;

  return {
    ready: true,
    summary,
    ambiguous,
    ambiguousTypes: ambiguous ? [profile.dominant.label, profile.secondary.label] : [],
    chains,
  };
}

/** AI 微調／Gemini 用的深層推理輸出 schema 說明 */
export const DEEP_REASONING_SCHEMA = `purpose_reasoning:[{
  "type":"要什麼|怕什麼|想什麼|愛什麼|爽什麼",
  "role":"主導|次要",
  "surface_quote":"客戶表面說的話(含時間)",
  "deep_motive":"推敲出的深層目的(一句話)",
  "why_not_other":"為什麼不是其他類型(一句話)",
  "verify_question":"收斂驗證問句",
  "amplify_line":"依此類型的強化話術",
  "pitch_line":"依此類型的對接話術"
}]`;
