/**
 * 臨場反應陪練引擎（純邏輯、無 DOM）。
 *
 * 業務主動丟問題 → 引擎依劇本判斷這句「問到哪一層／踩到什麼雷」→ 產生客戶反應。
 * 訓練目標：不慌（限時接話）、不亂套話（套話／恐嚇／太早推）、不講不出話（卡住）。
 * 每個判定都對應手冊規則（rules.js / purpose-types.js），結束後可直接送進正式分析。
 */
import { DRILL_COMMON, DRILL_OPENING } from './drill-personas.js';
import { sharesDiscoveryTerms } from './manual-check.js';
import { PURPOSE_TYPES, TYPE_DISCOVERY_LAYERS, detectWrongProbes } from './purpose-types.js';
import { RULES } from './rules.js';
import { isQuestion } from './speaker.js';
import { countChars } from './utils.js';

export const DIFFICULTIES = {
  gentle: { key: 'gentle', label: '溫和', every: 5, desc: '每 5 句丟一次突襲' },
  normal: { key: 'normal', label: '正常', every: 3, desc: '每 3 句丟一次突襲' },
  hard: { key: 'hard', label: '刁難', every: 2, desc: '每 2 句丟一次突襲' },
};
export const TIME_LIMITS = [15, 30, 45];
export const MAX_SALES_TURNS = 30;
export const TOO_LONG_CHARS = 70;
export const TIER_LABELS = Object.fromEntries(PURPOSE_TYPES.map((t) => [t.key, t.label]));
export const FIT_LABELS = { A: 'A 高度適合', B: 'B 部分適合', C: 'C 不適合' };

/** 罐頭話術：客戶一聽就知道是在背稿 */
export const CANNED_RE =
  /現在報名(有|享)|限時(優惠|折扣)|名額(有限|不多)|很多學員都|大家都在(學|上)|不學(就)?會被淘汰|非常適合(您|你)|保證(學會|有效|成果)|穩賺|絕對(可以|沒問題|學得會)|一定要(報名|把握)|錯過(可惜|就沒)|最後(機會|一天)|CP ?值(很|超)高|業界(第一|最強)|老師(很|超)(厲害|強)|你(相信|放心)我|不用擔心/;

/** 接住客戶的話（承認／理解），用來判斷突襲有沒有被接住 */
export const ACK_RE =
  /^(嗯|喔|好|對)[，、,\s]|我(了解|理解|明白|懂)|了解(了|你|您|。|，)|理解(你|您|。|，)|明白(了|你|您)|懂你|沒關係|謝謝|好問題|合理|很正常|我聽到|聽起來|可以想像|不好意思|抱歉|確實|的確|你說的|你剛(提到|說|講)|你講的/;

const INFO_NEEDED_BEFORE_PITCH = 3;
/** 明確在約下一步的字眼——即使句中提到費用／時間也算決策步驟 */
const DECISION_STRONG_RE = /安排|約(個|一個|在|時間)|發(連結|資料)給|傳(資料|連結)給|報名|付款|下一步|Meet|體驗/;
/** 明講判斷的字眼——「很適合你」這種帶產品的句子算推銷，不算判斷 */
const JUDGE_RE = /判斷|評估|我認為|依(照)?(你|您)的|適不適合|不適合|高度適合|部分適合/;

export function newSession({ persona, difficulty = 'normal', limitSec = 30, engine = 'script', rand = Math.random }) {
  if (!persona) throw new Error('persona required');
  const diff = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  return {
    persona,
    difficulty: diff.key,
    limitSec,
    engine,
    rand,
    turns: [],
    mood: 60,
    connected: false,
    revealedGeneral: new Set(),
    revealedTier: new Set(),
    revealedFacts: new Set(),
    pitched: false,
    diagnosed: false,
    blanksInRow: 0,
    objectionIdx: 0,
    objectionsThrown: 0,
    objectionsHandled: 0,
    pendingObjection: null,
    nextObjectionAt: diff.every,
    salesTurns: 0,
    ended: false,
    endReason: null,
    clock: 0,
  };
}

function speakDurMs(text) {
  return Math.round(Math.max(1200, countChars(text) * 220));
}

function pushTurn(state, who, text, extra = {}) {
  const turn = { who, text, at: state.clock, ...extra };
  state.turns.push(turn);
  if (who === 'C' || text) state.clock += speakDurMs(text) + 400;
  return turn;
}

function pick(list, rand) {
  return list[Math.floor(rand() * list.length)];
}

function infoCount(state) {
  return state.revealedGeneral.size + state.revealedTier.size + state.revealedFacts.size;
}

export function startSession(state) {
  state.clock = 0;
  const turn = pushTurn(state, 'C', DRILL_OPENING, { kind: 'opening' });
  return { replies: [turn] };
}

function lastCustomerText(state) {
  for (let i = state.turns.length - 1; i >= 0; i--) {
    if (state.turns[i].who === 'C') return state.turns[i].text;
  }
  return '';
}

/**
 * 判斷業務這句話：問到哪一層、踩到哪個雷。純函式，方便測試與 AI 模式共用。
 */
export function classifySalesLine(text, state) {
  const t = String(text || '').trim();
  const flags = [];
  const chars = countChars(t);
  const question = isQuestion(t);
  const persona = state.persona;
  const tier = persona.tier;
  const res = { text: t, chars, isQuestion: question, kind: 'statement', flags, layer: null, tierLayer: null, fact: null };

  if (RULES.fearWords.test(t)) flags.push('fear');
  if (CANNED_RE.test(t)) flags.push('canned');
  if (chars > TOO_LONG_CHARS) flags.push('tooLong');
  if (ACK_RE.test(t)) flags.push('ack');
  const prevC = lastCustomerText(state);
  if (prevC && sharesDiscoveryTerms([prevC], t)) flags.push('followUp');

  if (!state.connected) {
    res.kind = RULES.steps[0].re.test(t) ? 'connect' : 'noConnect';
    return res;
  }
  if (flags.includes('fear')) {
    res.kind = 'fear';
    return res;
  }
  if (flags.includes('canned')) {
    res.kind = 'canned';
    return res;
  }
  if (RULES.converge.test(t)) {
    res.kind = 'converge';
    return res;
  }
  const wrong = detectWrongProbes([{ spk: 'S', text: t }], { key: tier, label: TIER_LABELS[tier] });
  if (wrong.length) {
    res.kind = 'wrongProbe';
    res.toward = wrong[0].toward;
    flags.push('wrongProbe');
    return res;
  }
  if (JUDGE_RE.test(t) || RULES.fitA.test(t) || RULES.fitC.test(t)) {
    res.kind = 'diagnose';
    return res;
  }
  if (question && RULES.five[4].re.test(t) && !DECISION_STRONG_RE.test(t)) {
    res.kind = 'fact';
    res.fact = /預算|費用|多少錢|價格|負擔/.test(t) ? 'budget' : 'time';
    return res;
  }
  if (RULES.steps[5].re.test(t)) {
    res.kind = 'decision';
    return res;
  }
  if (RULES.steps[4].re.test(t) || RULES.products.test(t)) {
    res.kind = infoCount(state) >= INFO_NEEDED_BEFORE_PITCH ? 'pitch' : 'tooEarly';
    if (res.kind === 'tooEarly') flags.push('tooEarly');
    return res;
  }
  if (RULES.steps[3].re.test(t)) {
    res.kind = 'diagnose';
    return res;
  }
  if (question) {
    if (RULES.five[0].re.test(t)) {
      res.kind = 'fact';
      res.fact = 'background';
      return res;
    }
    const general = RULES.layers.filter((L) => L.re.test(t)).map((L) => L.n);
    const tierLs = (TYPE_DISCOVERY_LAYERS[tier] || []).filter((L) => L.re.test(t)).map((L) => L.n);
    const freshGeneral = general.find((n) => !state.revealedGeneral.has(n));
    const freshTier = tierLs.find((n) => !state.revealedTier.has(n));
    if (freshGeneral != null) {
      res.kind = 'layer';
      res.layer = freshGeneral;
      flags.push('goodQuestion');
      return res;
    }
    if (freshTier != null) {
      res.kind = 'tierLayer';
      res.tierLayer = freshTier;
      flags.push('goodQuestion');
      return res;
    }
    if (general.length || tierLs.length) {
      res.kind = 'repeat';
      flags.push('repeat');
      return res;
    }
    res.kind = 'question';
    flags.push('vague');
    return res;
  }
  if (flags.includes('canned')) res.kind = 'canned';
  return res;
}

function bumpMood(state, delta) {
  state.mood = Math.max(0, Math.min(100, state.mood + delta));
}

function scriptedReply(state, c) {
  const p = state.persona;
  const rand = state.rand;
  switch (c.kind) {
    case 'connect':
      return { text: p.greet, kind: 'greet', reword: true };
    case 'noConnect':
      return { text: p.noConnect, kind: 'noConnect', reword: false };
    case 'fear':
      return { text: DRILL_COMMON.fearReact, kind: 'pushback', reword: true };
    case 'canned':
      return { text: DRILL_COMMON.cannedReact, kind: 'pushback', reword: true };
    case 'tooEarly':
      return { text: p.tooEarly, kind: 'pushback', reword: true };
    case 'wrongProbe':
      return { text: p.deflect, kind: 'deflect', reword: true };
    case 'converge':
      return infoCount(state) >= 3
        ? { text: DRILL_COMMON.converge.yes, kind: 'converge', reword: true }
        : { text: DRILL_COMMON.converge.no, kind: 'converge', reword: true };
    case 'diagnose':
      return { text: state.diagnosed ? DRILL_COMMON.askedWhyFit : p.whyFit, kind: 'diagnose', reword: true };
    case 'decision':
      return infoCount(state) >= 4 && state.diagnosed
        ? { text: p.accept, kind: 'accept', reword: false }
        : { text: p.notYet, kind: 'notYet', reword: true };
    case 'pitch':
      return { text: p.pitchReply, kind: 'pitchReply', reword: true };
    case 'fact':
      return { text: p.facts[c.fact], kind: 'info', reword: true };
    case 'layer':
      return { text: p.layers[c.layer], kind: 'info', reword: true };
    case 'tierLayer':
      return { text: p.tierLayers[c.tierLayer], kind: 'info', reword: true };
    case 'repeat':
      return { text: DRILL_COMMON.repeated, kind: 'repeat', reword: true };
    case 'question':
      return { text: pick(DRILL_COMMON.vague, rand), kind: 'vague', reword: true };
    default:
      if (c.flags.includes('tooLong')) return { text: DRILL_COMMON.tooLong, kind: 'tooLong', reword: true };
      return { text: pick(DRILL_COMMON.ack, rand), kind: 'ack', reword: true };
  }
}

const MOOD_DELTA = {
  connect: 5,
  noConnect: -8,
  fear: -25,
  canned: -10,
  tooEarly: -15,
  wrongProbe: -6,
  converge: 6,
  diagnose: 4,
  decision: 0,
  pitch: 2,
  fact: 6,
  layer: 8,
  tierLayer: 8,
  repeat: -6,
  question: -3,
  statement: 0,
};

/**
 * 業務說了一句話。回傳 { classification, replies:[{text,kind,reword}], ended }
 * AI 模式：UI 可用 replies[i].reword 決定要不要請模型改寫語氣，再用 overrideReplyText 寫回。
 */
export function respond(state, text, reactionMs = 0) {
  if (state.ended) throw new Error('session ended');
  const c = classifySalesLine(text, state);
  state.salesTurns += 1;
  state.blanksInRow = 0;
  state.clock += Math.max(0, reactionMs);
  const salesTurn = pushTurn(state, 'S', c.text, {
    kind: c.kind,
    flags: c.flags,
    reactionMs,
    layer: c.layer,
    tierLayer: c.tierLayer,
    fact: c.fact,
  });

  // 先決定劇本反應（要用到「這句之前」的狀態，例如是否已做過判斷），再更新狀態
  const main = scriptedReply(state, c);
  const replies = [];
  let skipMain = false;
  const pending = state.pendingObjection;
  state.pendingObjection = null;
  if (pending) {
    const handled =
      !c.flags.includes('fear') && !c.flags.includes('canned') && !c.flags.includes('tooEarly') && (c.isQuestion || c.flags.includes('ack'));
    if (handled) {
      state.objectionsHandled += 1;
      c.flags.push('handled');
      bumpMood(state, 10);
      if (!c.isQuestion && c.kind === 'statement') {
        replies.push({ text: DRILL_COMMON.objectionHandled, kind: 'ack', reword: true });
        skipMain = true;
      }
    } else {
      c.flags.push('missedObjection');
      bumpMood(state, -10);
      replies.push({ text: DRILL_COMMON.objectionMissed, kind: 'pushback', reword: true });
      if (['pushback', 'ack', 'vague', 'tooLong'].includes(main.kind)) skipMain = true;
    }
  }

  if (c.kind === 'connect' || c.kind === 'noConnect') state.connected = true;
  if (c.kind === 'layer') state.revealedGeneral.add(c.layer);
  if (c.kind === 'tierLayer') state.revealedTier.add(c.tierLayer);
  if (c.kind === 'fact') state.revealedFacts.add(c.fact);
  if (c.kind === 'diagnose') state.diagnosed = true;
  if (c.kind === 'pitch') state.pitched = true;
  bumpMood(state, MOOD_DELTA[c.kind] ?? 0);
  if (c.flags.includes('tooLong')) bumpMood(state, -4);

  if (!skipMain) replies.push(main);

  if (main.kind === 'accept' && !skipMain) {
    endSession(state, 'closed');
  } else if (state.mood < 15) {
    replies.push({ text: DRILL_COMMON.hangup, kind: 'hangup', reword: false });
    endSession(state, 'hangup');
  } else if (state.salesTurns >= MAX_SALES_TURNS) {
    endSession(state, 'maxTurns');
  } else if (
    state.salesTurns >= state.nextObjectionAt &&
    c.kind !== 'connect' &&
    c.kind !== 'noConnect' &&
    !['pushback', 'notYet', 'repeat'].includes(main.kind)
  ) {
    const p = state.persona;
    const objection = p.objections[state.objectionIdx % p.objections.length];
    state.objectionIdx += 1;
    state.objectionsThrown += 1;
    state.pendingObjection = objection;
    state.nextObjectionAt = state.salesTurns + DIFFICULTIES[state.difficulty].every;
    replies.push({ text: objection, kind: 'objection', reword: false });
  }

  replies.forEach((r) => {
    r.turn = pushTurn(state, 'C', r.text, { kind: r.kind });
  });
  salesTurn.replyKinds = replies.map((r) => r.kind);
  return { classification: c, replies, ended: state.ended, mood: state.mood };
}

/** 限時內沒接上話 */
export function timeoutTurn(state) {
  if (state.ended) throw new Error('session ended');
  state.blanksInRow += 1;
  state.clock += state.limitSec * 1000;
  pushTurn(state, 'S', '', { kind: 'blank', flags: ['blank'], reactionMs: state.limitSec * 1000 });
  bumpMood(state, -15);
  const replies = [];
  if (state.blanksInRow >= 2 || state.mood < 15) {
    replies.push({ text: DRILL_COMMON.hangup, kind: 'hangup', reword: false });
    endSession(state, 'hangup');
  } else {
    replies.push({ text: DRILL_COMMON.pressure[(state.blanksInRow - 1) % DRILL_COMMON.pressure.length], kind: 'pressure', reword: false });
  }
  replies.forEach((r) => {
    r.turn = pushTurn(state, 'C', r.text, { kind: r.kind });
  });
  return { replies, ended: state.ended, mood: state.mood };
}

export function endSession(state, reason = 'manual') {
  if (state.ended) return state;
  state.ended = true;
  state.endReason = reason;
  return state;
}

/** AI 模式改寫客戶台詞後寫回逐字稿 */
export function overrideReplyText(turn, text) {
  const t = String(text || '').trim();
  if (t) turn.text = t;
  return turn;
}

/**
 * 給 Gemini 的提示：讓模型只負責「客戶怎麼講」，該不該透露資訊由引擎決定。
 */
export function buildCustomerPrompt(state, classification, reply) {
  const p = state.persona;
  const history = state.turns
    .filter((t) => t.text && t.kind !== 'blank')
    .slice(-12, -1)
    .map((t) => `${t.who === 'S' ? '業務' : '客戶'}：${t.text}`)
    .join('\n');
  const guide = {
    greet: '業務有好好開場，你認出對方了，語氣放鬆一點。',
    info: '業務問到了你願意講的資訊，請把【本輪資訊】用自己的口吻講出來，不要加業務沒問的內容。',
    vague: '業務的問題太籠統，你不知道從哪回答，給一個模糊、敷衍、很短的回答。',
    pushback: '業務踩到你的雷（推銷太早／恐嚇／背稿／沒回答你），請明顯表現出不悅或防備。',
    deflect: '業務問的方向跟你真正在意的不一樣，輕輕帶開，不要順著他的方向講。',
    converge: '業務在確認理解，請照【本輪資訊】的意思回應（同意或不完全同意）。',
    diagnose: '業務在做判斷，你想聽他的理由。',
    notYet: '你還沒被說服，不要答應下一步，但別關門。',
    pitchReply: '業務講方案了，你有點興趣，但要問一個實際的問題（怎麼上／時間／費用）。',
    repeat: '業務問了剛剛已經講過的事，語氣略帶不耐。',
    tooLong: '業務一次講太多，你跟不上。',
    ack: '簡短回應一兩個字，等業務繼續。',
  };
  return `你在扮演一位接到電訪的潛在客戶，讓業務練習臨場反應。請完全用客戶口吻、繁體中文口語、一到兩句、不超過 45 字，不要教學、不要幫業務。
【你的人設（業務看不到）】${p.name}，${p.brief} 學 AI 的真正目的屬「${TIER_LABELS[p.tier]}」這一級。只有被具體問到才透露對應資訊；問得模糊就答得模糊。
【對話至今】
${history || '（剛接起電話）'}
業務：${classification.text}
【本輪指示】${guide[reply.kind] || guide.ack}
【本輪資訊】${reply.text}
請只輸出 JSON：{"reply":"客戶這一句"}`;
}

/* ------------------------------------------------------------------ */
/* 結束後：計分、教練回饋、轉逐字稿                                     */
/* ------------------------------------------------------------------ */

export function judgeQuiz(state, { tier, fit } = {}) {
  const p = state.persona;
  return {
    tierAnswer: tier || null,
    tierCorrect: !!tier && tier === p.tier,
    expectedTier: p.tier,
    expectedTierLabel: TIER_LABELS[p.tier],
    fitAnswer: fit || null,
    fitCorrect: !!fit && fit === p.fit,
    expectedFit: p.fit,
    expectedFitLabel: FIT_LABELS[p.fit],
    fitReason: p.fitReason,
  };
}

export function sessionStats(state) {
  const S = state.turns.filter((t) => t.who === 'S');
  const spoken = S.filter((t) => t.kind !== 'blank');
  const count = (flag) => spoken.filter((t) => t.flags?.includes(flag)).length;
  const reactions = spoken.map((t) => t.reactionMs || 0);
  const avgMs = reactions.length ? reactions.reduce((a, b) => a + b, 0) / reactions.length : 0;
  const followUpEligible = spoken.filter((t) => t.kind !== 'connect' && t.kind !== 'noConnect').length;
  const stats = {
    salesLines: spoken.length,
    timeouts: S.filter((t) => t.kind === 'blank').length,
    avgReactionMs: avgMs,
    maxReactionMs: reactions.length ? Math.max(...reactions) : 0,
    canned: count('canned'),
    fear: count('fear'),
    tooEarly: count('tooEarly'),
    wrongProbe: count('wrongProbe'),
    repeat: count('repeat'),
    tooLong: count('tooLong'),
    vague: count('vague'),
    goodQuestions: count('goodQuestion'),
    followUps: count('followUp'),
    followUpRate: followUpEligible ? count('followUp') / followUpEligible : 0,
    objectionsThrown: state.objectionsThrown,
    objectionsHandled: state.objectionsHandled,
    generalLayers: state.revealedGeneral.size,
    tierLayers: state.revealedTier.size,
    facts: state.revealedFacts.size,
    diagnosed: state.diagnosed,
    pitched: state.pitched,
    mood: state.mood,
    endReason: state.endReason,
    connected: state.turns.some((t) => t.kind === 'connect'),
  };
  let score = 100;
  score -= stats.timeouts * 15;
  score -= stats.canned * 10;
  score -= stats.fear * 20;
  score -= stats.tooEarly * 12;
  score -= stats.wrongProbe * 8;
  score -= stats.repeat * 5;
  score -= stats.tooLong * 4;
  score -= stats.vague * 3;
  score -= (stats.objectionsThrown - stats.objectionsHandled) * 8;
  score += stats.objectionsHandled * 4;
  score += Math.min(10, stats.generalLayers * 2);
  if (stats.endReason === 'hangup') score -= 15;
  if (stats.endReason === 'closed') score += 5;
  if (!stats.connected) score -= 5;
  stats.score = Math.max(0, Math.min(100, Math.round(score)));
  stats.verdict = stats.score >= 80 ? '穩' : stats.score >= 60 ? '還可以' : '需要再練';
  return stats;
}

export function buildCoaching(state, stats, quiz) {
  const p = state.persona;
  const tierLabel = TIER_LABELS[p.tier];
  const good = [];
  const bad = [];
  const limit = state.limitSec;

  if (stats.timeouts) {
    bad.push(
      `<b>卡住 ${stats.timeouts} 次</b>（超過 ${limit} 秒沒接話）。先備好三句萬用接話，任何時候都能先開口：<span class="q">「這個問題好，我先確認一下你的意思是…」</span><span class="q">「你剛提到＿＿，可以多說一點嗎？」</span><span class="q">「我理解，那對你來說最在意的是…？」</span>`
    );
  } else if (stats.salesLines >= 3) {
    good.push(`全程沒有卡住——${stats.salesLines} 句都在 ${limit} 秒內接上`);
  }
  if (stats.avgReactionMs && stats.salesLines >= 3) {
    const avg = (stats.avgReactionMs / 1000).toFixed(1);
    if (stats.avgReactionMs <= limit * 500) good.push(`平均反應 ${avg} 秒，最慢 ${(stats.maxReactionMs / 1000).toFixed(1)} 秒——節奏穩`);
    else bad.push(`平均反應 ${avg} 秒，偏慢——不是想完整句子才開口，先接一句再想`);
  }
  if (stats.canned) {
    const ex = state.turns.find((t) => t.flags?.includes('canned'));
    bad.push(`<b>套話 ${stats.canned} 句</b>${ex ? `（例：「${ex.text.slice(0, 30)}」）` : ''}——客戶聽到罐頭話術就關機。改成引用客戶剛說的話，再問一句`);
  }
  if (stats.fear) bad.push(`<b>恐嚇用語 ${stats.fear} 句</b>——手冊底線：只能放大客戶自己說過的擔憂，不能自己嚇客戶`);
  if (stats.tooEarly) bad.push(`<b>太早推方案 ${stats.tooEarly} 次</b>——第一次提方案前至少問到三層資訊（現況／問題／影響）`);
  else if (stats.pitched) good.push('沒有急著推方案——先問到足夠資訊才開口講方案');
  if (stats.wrongProbe) {
    bad.push(`<b>問錯方向 ${stats.wrongProbe} 句</b>——客戶是「${tierLabel}」，你往其他分級導。手冊：${p.tier === 'enjoy' ? '學員是爽什麼時勿硬問最深恐懼' : '就在客戶自己的那條線往下挖五層'}`);
  }
  if (stats.vague >= 2) {
    bad.push(`<b>${stats.vague} 句問題客戶只給模糊回答</b>——問法太籠統。把「你覺得 AI 怎麼樣？」換成「你現在工作上哪一段最花時間？」`);
  }
  if (stats.repeat) bad.push(`重複問了 ${stats.repeat} 句已經問過的事——沒在聽答案就急著問下一題`);
  if (stats.tooLong) bad.push(`${stats.tooLong} 句一次講超過 ${TOO_LONG_CHARS} 字——電話裡一次只講一件事、一句話，問完就閉嘴`);
  if (stats.objectionsThrown) {
    const r = stats.objectionsHandled / stats.objectionsThrown;
    if (r >= 0.7) good.push(`突襲處理 <b>${stats.objectionsHandled}/${stats.objectionsThrown}</b>——客戶丟難題時有接住（承認→反問）`);
    else bad.push(`突襲處理只有 <b>${stats.objectionsHandled}/${stats.objectionsThrown}</b>——客戶丟難題時不要直接解釋，先接住：<span class="q">「這個問題很合理。」</span>再反問一句：<span class="q">「你會這樣問，是之前有遇過＿＿嗎？」</span>`);
  }
  if (stats.salesLines >= 4) {
    const pct = Math.round(stats.followUpRate * 100);
    if (stats.followUpRate >= 0.5) good.push(`接話率 ${pct}%——多數問題有引用客戶上一句的關鍵字，不是背題庫`);
    else bad.push(`接話率只有 ${pct}%——問題跟客戶剛講的沒關係，這就是「亂套話」的訊號。下一句一定要用到客戶上一句的字`);
  }
  if (stats.generalLayers + stats.tierLayers >= 5) good.push(`挖到 ${stats.generalLayers} 層一般資訊＋${stats.tierLayers} 層「${tierLabel}」路徑——足以做適配判斷`);
  else if (stats.salesLines >= 4) bad.push(`只挖到 ${stats.generalLayers} 層一般資訊＋${stats.tierLayers} 層「${tierLabel}」路徑——資訊不足就推方案會變成瞎猜`);
  if (stats.diagnosed) good.push('有明講適配判斷（A／B／C）——顧問核心價值有做出來');
  else if (stats.salesLines >= 6) bad.push('沒有明講適配判斷——問完之後要敢下結論：<span class="q">「依照你的＿＿，我判斷＿＿適合／不適合你，因為＿＿」</span>');
  if (stats.endReason === 'hangup') bad.push('<b>客戶掛電話了</b>——耐心耗盡。看一下上面哪幾句把耐心值打下去的');
  if (stats.endReason === 'closed') good.push('客戶答應下一步——判斷＋對接都到位才會有這個結果');
  if (!stats.connected && stats.salesLines) bad.push('開場沒建立連結（表明身分、確認方便）——客戶不會跟陌生人說真話');

  if (quiz) {
    if (quiz.tierAnswer) {
      if (quiz.tierCorrect) good.push(`分級判斷正確：<b>${quiz.expectedTierLabel}</b>`);
      else bad.push(`分級判斷錯了——你選「${TIER_LABELS[quiz.tierAnswer]}」，客戶其實是「<b>${quiz.expectedTierLabel}</b>」。回頭看客戶哪幾句透露的`);
    }
    if (quiz.fitAnswer) {
      if (quiz.fitCorrect) good.push(`適配判斷正確：<b>${quiz.expectedFitLabel}</b>——${quiz.fitReason}`);
      else bad.push(`適配判斷不同——你選 ${FIT_LABELS[quiz.fitAnswer]}，劇本設定是 <b>${quiz.expectedFitLabel}</b>：${quiz.fitReason}`);
    }
  }
  return { good, bad };
}

function srtTime(ms) {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const mm = t % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mm).padStart(3, '0')}`;
}

/** 轉成 WhisperX 風格 SRT（SPEAKER_00 = 業務、SPEAKER_01 = 客戶），可直接進正式分析 */
export function sessionToSrt(state) {
  const turns = state.turns.filter((t) => t.text && t.kind !== 'blank');
  return turns
    .map((t, i) => {
      const start = t.at;
      const dur = speakDurMs(t.text);
      const next = turns[i + 1];
      const end = next ? Math.min(start + dur, next.at - 100) : start + dur;
      return `${i + 1}\n${srtTime(start)} --> ${srtTime(Math.max(start + 300, end))}\n[${t.who === 'S' ? 'SPEAKER_00' : 'SPEAKER_01'}] ${t.text}\n`;
    })
    .join('\n');
}

export function sessionToText(state, stats, coaching, quiz) {
  const strip = (h) => String(h).replace(/<[^>]+>/g, '');
  const lines = [];
  lines.push(`【臨場反應陪練】劇本：${state.persona.name}（${state.persona.brief}）`);
  lines.push(`難度：${DIFFICULTIES[state.difficulty].label}｜限時：${state.limitSec} 秒｜引擎：${state.engine === 'ai' ? 'Gemini AI 客戶' : '離線劇本'}`);
  lines.push(`分數：${stats.score}（${stats.verdict}）｜卡住 ${stats.timeouts}｜套話 ${stats.canned}｜恐嚇 ${stats.fear}｜太早推 ${stats.tooEarly}｜突襲 ${stats.objectionsHandled}/${stats.objectionsThrown}`);
  if (quiz) lines.push(`分級：${quiz.tierAnswer ? TIER_LABELS[quiz.tierAnswer] : '未答'} → 正解 ${quiz.expectedTierLabel}｜適配：${quiz.fitAnswer || '未答'} → 正解 ${quiz.expectedFit}`);
  lines.push('');
  lines.push('— 做得好 —');
  coaching.good.forEach((g) => lines.push(`・${strip(g)}`));
  lines.push('— 待加強 —');
  coaching.bad.forEach((b) => lines.push(`・${strip(b)}`));
  lines.push('');
  lines.push('— 對話 —');
  state.turns.forEach((t) => {
    if (t.kind === 'blank') lines.push('業務：（沒接上話）');
    else lines.push(`${t.who === 'S' ? '業務' : '客戶'}：${t.text}${t.flags?.length ? `  [${t.flags.join(',')}]` : ''}`);
  });
  return lines.join('\n');
}

export const FLAG_LABELS = {
  blank: '卡住',
  canned: '套話',
  fear: '恐嚇',
  tooEarly: '太早推',
  wrongProbe: '問錯方向',
  repeat: '重複',
  tooLong: '太長',
  vague: '問太籠統',
  goodQuestion: '好問題',
  followUp: '接話',
  handled: '接住突襲',
  missedObjection: '沒接突襲',
};
export const BAD_FLAGS = new Set(['blank', 'canned', 'fear', 'tooEarly', 'wrongProbe', 'repeat', 'tooLong', 'vague', 'missedObjection']);
