import { RULES } from './rules.js';
import { isQuestion } from './speaker.js';
import { countChars, escapeHTML, fmt } from './utils.js';

/**
 * 規則「信任感 Trust」
 *
 * 客戶在陌生人面前講出真需求是「示弱」，所以會偽裝、會敷衍。
 * 這條規則不看業務講了什麼漂亮話，而是看兩件事：
 *   1. 客戶是否「越講越私人」——從敷衍 → 事實 → 困擾 → 私人／動機，一路往下揭露。
 *      客戶願意為了你說出更多隱私，本身就是成交率在上升。
 *   2. 業務有沒有做出讓客戶願意揭露的行為（先給、事實題起手、給退路、被否認就退一步、不催不審）。
 * 另外特別處理常見的「搖擺型」客戶：需求可有可無，但不缺錢也不缺時間。
 * 這不是五種分級之一——資源不等於動機；正確做法是用想／愛／爽三個試探句找動機，找不到就敢判 C。
 */

export const TRUST = {
  /** 客戶揭露層級 0：敷衍／防守 */
  guarded: /還好|還可以|普通|了解一下|沒有特別|沒特別|再看看|看看|不急|可有可無|隨便|都可以|沒想過|不知道|沒什麼|沒差/,
  /** 「沒什麼困擾」這種帶著困擾字眼的否認，仍屬防守 */
  negatedAll: /(沒有|沒什麼|沒|不會|不算|也沒|不是|倒不是|都不是)(特別|什麼|太|很)?(困擾|問題|壓力|擔心|麻煩|卡|影響|重點)/g,
  /** 層級 1：可查證的事實（人數、年資、工具、產業） */
  fact: /\d|[一二兩三四五六七八九十幾半]+(個|年|人|位|小時|天|週|月|萬)|人數|團隊|公司|部門|工具|ChatGPT|Excel|工作|產業|行業|職|老師|主管|課長|經理|平常|目前|現在|畢業/,
  /** 層級 2：困擾／評價 */
  trouble: /困擾|卡(住|在|關|得)|很卡|麻煩|花.{0,4}時間|不知道怎麼|不知道從哪|問題|不順|重工|加班|來不及|瓶頸|痛點|壓力|沒說服力|聽不懂|插不上話/,
  /** 層級 3：私人／動機／情緒（真正的需求層） */
  private:
    /老闆|主管|同事|家(裡|人|庭)|房貸|小孩|收入|薪水|月薪|年紀|歲|被(取代|淘汰|看|覺得|說|排除|甩)|怕|擔心|受不了|不能接受|最在意|證明自己|證明|面子|尊重|安心|考績|裁員|落單|跟不上|希望變成|想變成|成為.{0,6}(人|樣|那個)|不得不|救火|包袱|自己給的/,
  /** 坦白標記：出現時代表客戶在「講真話」，揭露層級 +1 */
  candor: /其實|老實說|說真的|坦白|不瞞|講白了|說實話|私底下|不好意思說/,

  /** 搖擺型：需求可有可無 */
  waveringNeed:
    /可有可無|沒有特別(需要|想|急|一定)|沒特別(需要|想|急)|不(急|一定要)|再看看|看看而已|了解一下(而已|就好)|不學也(不會|沒)|沒差|學不學都|有也好沒有也|不學也(不會|沒)怎樣|可以也可以不|順便問問/,
  /** 搖擺型：但不缺錢、不缺時間 */
  waveringResource:
    /(預算|費用|錢|學費|金額|價格).{0,10}(沒問題|不是問題|不是重點|OK|可以接受|不缺|夠|付得起|負擔得起|還好|無所謂)|不缺(錢|時間|預算)|(時間|空).{0,6}(很多|蠻多|滿多|不是問題|不是重點|OK|夠|沒問題|都可以|都有|有空|彈性|很彈性)|(錢|時間).{0,4}(都)?(不是|沒)問題/,

  /** 業務：先給再問（分享觀察、案例、第三人稱框架） */
  giveFirst:
    /我(最近|自己|這邊|們)?(接觸|看到|遇到|碰到|觀察|服務)(過|到|的)?.{0,3}(蠻多|很多|滿多|不少|一些|幾個|的)|分享(一個|一下|給你|給您)|(很多|蠻多|滿多|不少|大部分)(人|客戶|學員|主管|老師|老闆|公司|團隊)|有(個|一個)(做法|案例|例子)|舉個例|像(有些|之前|上次|我)|其他(客戶|人|學員|主管|老師)|有(些|的)人.{0,8}(會|卡在|遇到|覺得)|我先講一下我看到的/,
  /** 業務：事實題（不用示弱就能回答） */
  factQ:
    /幾(個|位|年|人)|多久|多少(人|時間)|什麼工具|用(什麼|哪些|哪個)|怎麼(做|用|處理|分工)|哪(個|一)(產業|行業|段|環節|部分)|平常.{0,6}(用|做|怎麼)|目前.{0,4}(怎麼|如何|用|在做)|大概是什麼狀況|工作內容|哪方面/,
  /** 業務：給退路／敢不賣 */
  exit:
    /不一定(適合|要|需要)|不用(急|勉強|現在決定)|不勉強|沒關係|不(需要|用)也(可以|沒關係|沒問題|OK)|(不適合|不建議).{0,10}(直接|老實|跟你說|跟您說)|敢不賣|真的不需要|你決定就好|您決定就好|覺得不需要/,
  /** 業務：被否認後退一步 */
  retreat: /了解|沒關係|那不是重點|OK|好的|明白|那我換個(方式|問法|角度)|不勉強|懂|那就好|那很好|那先不管/,
  /** 客戶：短否認 */
  denial: /^(沒有|不是|還好|沒|不會|沒什麼|也沒有|沒有啦|沒有欸|還沒|沒想過)/,
  /** 業務：催促／套話（會把安全感打掉） */
  pressure: /現在(報名|決定|下單|訂)|名額|只剩|優惠|今天(報名|決定|下單)|限時|再不.{0,6}就|錯過|最後(一|幾)|早鳥|趕快|盡快決定/,
};

/** 搖擺型客戶的三個試探方向（不在「要／怕」硬挖，因為他已經說了需求可有可無） */
export const WAVERING_PROBES = [
  {
    key: 'think',
    label: '想什麼',
    question: '你身邊的同行或朋友，有人已經在用了嗎？你看他們在用的時候，自己是什麼感覺？',
    re: /圈子|同行|同業|身邊.{0,6}(人|朋友|同事)|趨勢|跟上|落後|他們.{0,4}(在用|用了)/,
  },
  {
    key: 'love',
    label: '愛什麼',
    question: '如果你會用了，你希望別人怎麼看你？',
    re: /怎麼看(你|您)|別人.{0,6}(看|覺得|認為|評價)|被.{0,4}(看見|覺得|認為|肯定|尊重|當成)|形象|專業|評價/,
  },
  {
    key: 'enjoy',
    label: '爽什麼',
    question: '對你來說，什麼事會讓你覺得真的很爽、很值得？',
    re: /爽|成就|意義|值得|影響力|證明|驕傲|想變成|成為.{0,6}(人|樣)/,
  },
];

/** 一句客戶話的揭露層級 0–3 */
export function disclosureLevel(text) {
  const raw = String(text || '').trim();
  const chars = countChars(raw);
  if (chars <= 4) return 0;
  // 去掉「擔心？」這種複述問題的開頭，以及「沒什麼困擾／不是問題」這類否認片語，避免把否認算成揭露
  const t = raw.replace(/^[^，。？?！!]{1,4}[？?]/, '').replace(TRUST.negatedAll, '');
  if (TRUST.guarded.test(t) && chars <= 12 && !TRUST.private.test(t) && !TRUST.trouble.test(t)) return 0;
  let base = 0;
  if (TRUST.private.test(t)) base = 3;
  else if (TRUST.trouble.test(t)) base = 2;
  else if (TRUST.fact.test(t)) base = 1;
  else if (!TRUST.guarded.test(t) && chars >= 15) base = 1;
  if (base < 3 && TRUST.candor.test(t) && chars >= 6) base = Math.max(base, 1) + (base >= 1 ? 1 : 0);
  return Math.min(3, base);
}

export const DISCLOSURE_LABELS = ['敷衍／防守', '事實', '困擾', '私人／動機'];

/**
 * 客戶揭露軌跡：起點層級 → 最深層級、第一次「信任突破」（層級 3）。
 * 收尾階段客戶只回「對」「好」是正常的，所以不用「後段平均」判斷越講越收，
 * 而是看：說出困擾之後有沒有再往下（rose），或講到一半就收回去（shutDown）。
 */
export function disclosureTrajectory(segs) {
  const levels = [];
  segs.forEach((s, idx) => {
    if (s.spk !== 'C') return;
    levels.push({ idx, level: disclosureLevel(s.text), start: s.start, text: s.text, seg: s, chars: s.chars });
  });
  const n = levels.length;
  if (!n) return { levels, startLevel: 0, peak: 0, peakAt: -1, rose: false, shutDown: false, breakthrough: null };
  const substantive = levels.filter((l) => l.chars > 4);
  const startLevel = (substantive[0] || levels[0]).level;
  const peak = Math.max(...levels.map((l) => l.level));
  const peakAt = levels.findIndex((l) => l.level === peak);
  const breakthrough = levels.find((l) => l.level === 3) || null;
  const rose = peak >= 2 && (startLevel < peak || peak >= 3);
  const afterPeak = substantive.filter((l) => l.idx > levels[peakAt].idx);
  const shutDown = !breakthrough && peak >= 2 && afterPeak.length >= 2 && afterPeak.every((l) => l.level <= 1);
  return { levels, startLevel, peak, peakAt, rose, shutDown, breakthrough };
}

/** 第一次信任突破的 segs 索引（無則 -1） */
export function firstBreakthroughIdx(segs) {
  const idx = segs.findIndex((s) => s.spk === 'C' && disclosureLevel(s.text) === 3);
  return idx;
}

function isPitch(text) {
  return RULES.steps[4].re.test(text) || RULES.products.test(text);
}

/** 搖擺型客戶偵測：需求可有可無 × 不缺錢時間，以及業務接下來有沒有做對 */
export function detectWavering(segs) {
  const C = [];
  segs.forEach((s, idx) => {
    if (s.spk === 'C') C.push({ ...s, idx });
  });
  const needSeg = C.find((s) => TRUST.waveringNeed.test(s.text)) || null;
  const resourceSeg = C.find((s) => TRUST.waveringResource.test(s.text)) || null;
  if (!needSeg || !resourceSeg) {
    return { detected: false, needSeg, resourceSeg, probedTypes: [], pitchedFirst: false, judgedC: false, handled: false };
  }
  const fromIdx = Math.max(needSeg.idx, resourceSeg.idx);
  const salesAfter = segs.slice(fromIdx + 1).filter((s) => s.spk === 'S');
  const probedTypes = WAVERING_PROBES.filter((p) => salesAfter.some((s) => isQuestion(s.text) && p.re.test(s.text)));
  const firstMove = salesAfter.find((s) => isPitch(s.text) || WAVERING_PROBES.some((p) => isQuestion(s.text) && p.re.test(s.text)));
  const pitchedFirst = !!firstMove && isPitch(firstMove.text);
  const judgedC = salesAfter.some((s) => RULES.fitC.test(s.text));
  return {
    detected: true,
    needSeg,
    resourceSeg,
    probedTypes,
    pitchedFirst,
    judgedC,
    handled: probedTypes.length > 0 || judgedC,
  };
}

function ev(s) {
  const text = s.text.length > 50 ? `${s.text.slice(0, 50)}…` : s.text;
  return `<span class="ev">[${fmt(s.start)}] ${escapeHTML(text)}</span>`;
}

function statusLabel(status) {
  if (status === 'pass') return '通過';
  if (status === 'partial') return '部分達標';
  return '未達標';
}

/** 連續審問：業務連問 ≥3 句，客戶每次都只回 ≤4 字 */
function detectInterrogation(segs) {
  let run = 0;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    const c = segs[i + 1];
    if (s.spk === 'S' && isQuestion(s.text) && c.spk === 'C') {
      run = c.chars <= 4 ? run + 1 : 0;
      if (run >= 3) return segs[i];
    } else if (s.spk === 'S' && !isQuestion(s.text)) {
      run = 0;
    }
  }
  return null;
}

/** 被否認後追問：客戶短否認 → 業務下一句仍在問同一件事 */
function detectPressedDenials(segs) {
  const pressed = [];
  for (let i = 1; i < segs.length - 1; i++) {
    const prevS = segs[i - 1];
    const c = segs[i];
    const nextS = segs[i + 1];
    if (c.spk !== 'C' || prevS.spk !== 'S' || nextS.spk !== 'S') continue;
    if (c.chars > 10 || !TRUST.denial.test(c.text.trim())) continue;
    if (TRUST.retreat.test(nextS.text)) continue;
    if (!isQuestion(nextS.text)) continue;
    const prevKey = keyTerms(prevS.text);
    const nextKey = keyTerms(nextS.text);
    if (prevKey.some((k) => nextKey.includes(k))) pressed.push({ question: prevS, denial: c, followUp: nextS });
  }
  return pressed;
}

/** 追問判定用的主題群：同義詞視為同一件事（問「擔心」被否認後改問「怕不怕」仍算追問） */
const TOPIC_GROUPS = [
  { key: 'fear', re: /擔心|害怕|怕|恐懼|焦慮|淘汰|風險/ },
  { key: 'problem', re: /困擾|問題|痛點|卡(住|在)?|麻煩|瓶頸/ },
  { key: 'budget', re: /預算|費用|錢|學費|價格/ },
  { key: 'time', re: /時間|多久|幾點/ },
  { key: 'goal', re: /目標|想達到|想變成|希望/ },
  { key: 'need', re: /缺|需要|想要/ },
  { key: 'impact', re: /影響|損失|代價/ },
  { key: 'why', re: /為什麼|契機|怎麼會/ },
  { key: 'people', re: /老闆|主管|同事|家(裡|人)/ },
];
function keyTerms(text) {
  const t = String(text);
  return TOPIC_GROUPS.filter((g) => g.re.test(t)).map((g) => g.key);
}

export function evaluateTrust(segs, { purposeProfile } = {}) {
  const S = segs.filter((s) => s.spk === 'S');
  const sQuestions = S.filter((s) => isQuestion(s.text));
  const firstPitchIdx = segs.findIndex((s) => s.spk === 'S' && isPitch(s.text));
  const beforePitch = firstPitchIdx >= 0 ? segs.slice(0, firstPitchIdx) : segs;

  const trajectory = disclosureTrajectory(segs);
  const wavering = detectWavering(segs);

  const giveFirstSeg = beforePitch.find((s) => s.spk === 'S' && TRUST.giveFirst.test(s.text)) || null;
  const factQSeg = sQuestions.slice(0, 3).find((s) => TRUST.factQ.test(s.text) || RULES.layers[0].re.test(s.text)) || null;
  const exitSeg = S.find((s) => TRUST.exit.test(s.text) || RULES.fitC.test(s.text)) || null;
  const pressed = detectPressedDenials(segs);
  const pressureSeg = S.find((s) => TRUST.pressure.test(s.text)) || null;
  const interrogationSeg = detectInterrogation(segs);
  const safe = !pressureSeg && !interrogationSeg;

  const breakthrough = trajectory.breakthrough;
  const openerSeg = breakthrough && breakthrough.idx > 0 && segs[breakthrough.idx - 1].spk === 'S' ? segs[breakthrough.idx - 1] : null;
  const disclosePass = trajectory.rose;
  const pathText = `起點「${DISCLOSURE_LABELS[trajectory.startLevel]}」→ 最深「${DISCLOSURE_LABELS[trajectory.peak]}」`;

  const criteria = [
    {
      key: 'giveFirst',
      label: '先給再問（分享觀察／案例／第三人稱框架）',
      pass: !!giveFirstSeg,
      hint: '客戶不會先示弱。先給：「我接觸蠻多主管，卡的都不是工具，是不知道怎麼教團隊」——讓他決定要不要對號入座',
    },
    {
      key: 'factQ',
      label: '事實題起手（不用示弱就能回答）',
      pass: !!factQSeg,
      hint: '前三個問題先問事實：「你們幾個人？」「平常用什麼工具？」「目前怎麼做？」——事實答完，困擾才會跟著出來',
    },
    {
      key: 'exit',
      label: '給退路／敢不賣（降低講真話的風險）',
      pass: !!exitSeg,
      hint: '說一句「不一定適合，聊完你覺得不需要也沒關係」——客戶知道你不會硬賣，才敢講真的',
    },
    {
      key: 'retreat',
      label: pressed.length ? `被否認就退一步（追問了 ${pressed.length} 次）` : '被否認就退一步（不追問被否認的點）',
      pass: pressed.length === 0,
      hint: pressed.length
        ? `客戶說「${escapeHTML(pressed[0].denial.text)}」後仍追問同一件事 ${ev(pressed[0].followUp)}。否認≠沒有，是「還不信你」——先接住（「了解，那不是重點」），換事實題再繞回來`
        : null,
    },
    {
      key: 'safe',
      label: '守住安全感（未催促、未連續審問）',
      pass: safe,
      hint: pressureSeg
        ? `偵測到催促／套話 ${ev(pressureSeg)}——催促會讓客戶把剩下的話收回去`
        : interrogationSeg
          ? `連續 3 句以上提問客戶都只回 ≤4 字 ${ev(interrogationSeg)}——已經變成審問，先停下來給一段自己的觀察`
          : null,
    },
    {
      key: 'disclose',
      label: '客戶越講越私人（揭露層級由淺到深）',
      pass: disclosePass,
      hint: trajectory.levels.length
        ? `客戶揭露層級 ${pathText}（敷衍→事實→困擾→私人）。客戶願意為你說出更多隱私，成交率才會上升`
        : '尚無客戶話語可判斷',
    },
    {
      key: 'breakthrough',
      label: '出現信任突破（客戶說出私人／動機層資訊）',
      pass: !!breakthrough,
      hint: '客戶還沒說出任何「老闆／同事／怕／其實／年紀／收入」這類私人層資訊——代表他還在偽裝，先做前四項再挖',
    },
  ];

  if (wavering.detected) {
    criteria.push({
      key: 'wavering',
      label: '搖擺型客戶（需求可有可無、不缺錢時間）→ 用想／愛／爽試探，不直接推方案',
      pass: wavering.handled,
      hint: wavering.pitchedFirst
        ? '客戶說需求可有可無，業務卻因為「他有錢有時間」就推方案——資源不等於動機，會直接被「我再想想」帶走'
        : '這不是五種分級之一。用三句試探：「身邊同行有人在用嗎？」（想）「會用了你希望別人怎麼看你？」（愛）「什麼事會讓你覺得真的很值得？」（爽）——找不到動機就敢判 C',
    });
  }

  const passCount = criteria.filter((c) => c.pass).length;
  const total = criteria.length;
  const waveringBlocks = wavering.detected && !wavering.handled;
  const pass = !waveringBlocks && !!breakthrough && safe && passCount >= total - 1;
  const partial = passCount >= Math.ceil(total / 2) || !!breakthrough;
  const status = pass ? 'pass' : partial ? 'partial' : 'fail';

  const good = [];
  const bad = [];
  const sug = [];

  if (breakthrough) {
    good.push(
      `<b>信任突破</b>：客戶在 [${fmt(breakthrough.start)}] 說出私人／動機層資訊${ev(breakthrough.seg)}${
        openerSeg ? `——打開他的是前一句 ${ev(openerSeg)}` : ''
      }`
    );
  }
  if (disclosePass) {
    good.push(`客戶<b>越講越私人</b>（${pathText}）——他願意為了你說出更多，成交率正在上升`);
  } else if (trajectory.levels.length >= 3 && trajectory.peak <= 1) {
    bad.push(
      `<b>客戶全程在偽裝</b>——${trajectory.levels.length} 句客戶話語最深只到「${DISCLOSURE_LABELS[trajectory.peak]}」層。在陌生人面前講需求是示弱，他還沒覺得安全`
    );
    sug.push(
      '先給再問：<span class="q">「我接觸蠻多像你這樣的主管，卡的多半不是工具，是不知道怎麼讓團隊跟著用——你那邊比較像哪一種？」</span>用第三人稱讓他對號入座，不用自己開口示弱'
    );
  }
  if (trajectory.shutDown) {
    bad.push(
      `客戶<b>講到一半收回去</b>——說出困擾（${pathText}）之後就沒再往下，中途有話把他的安全感打掉了：回頭看被否認後有沒有追問、有沒有太早推方案`
    );
  }
  if (giveFirstSeg) good.push(`有<b>先給再問</b>——用觀察／案例開路，客戶不用先示弱 ${ev(giveFirstSeg)}`);
  if (exitSeg) good.push(`有<b>給退路</b>——先說不一定適合／不勉強，客戶講真話的風險變低 ${ev(exitSeg)}`);
  if (pressed.length) {
    bad.push(
      `<b>被否認後仍追問 ${pressed.length} 次</b>——客戶說「${escapeHTML(pressed[0].denial.text)}」不是沒有，是還不信你 ${ev(pressed[0].followUp)}`
    );
    sug.push(
      '被否認先接住再繞：<span class="q">「了解，那不是重點。那你們現在這段大概是誰在做、花多久？」</span>回到事實題，等他自己再講回來'
    );
  }
  if (pressureSeg) bad.push(`<b>催促／套話</b>會把安全感打掉——客戶正在猶豫要不要多講，一催就收回去 ${ev(pressureSeg)}`);
  if (interrogationSeg) {
    bad.push(`<b>連續審問</b>——連問三句以上、客戶都只回 ≤4 字，代表他在防守，不是在配合 ${ev(interrogationSeg)}`);
    sug.push(
      '審問卡住時停一拍，先給一段自己的觀察：<span class="q">「我先講一下我看到的，你聽聽有沒有像——很多主管自己會用，但團隊帶不動。」</span>再問「你那邊呢？」'
    );
  }

  if (wavering.detected) {
    const need = wavering.needSeg;
    const res = wavering.resourceSeg;
    const evidence = need.idx === res.idx ? `${ev(need)}` : `${ev(need)}${ev(res)}`;
    if (wavering.handled) {
      const types = wavering.probedTypes.map((p) => `「${p.label}」`).join('');
      good.push(
        `<b>搖擺型客戶處理正確</b>——客戶說需求可有可無、但不缺錢時間${evidence}，業務${
          wavering.judgedC && !types ? '敢判 C' : `用${types}試探動機${wavering.judgedC ? '，並敢判 C' : ''}`
        }，沒有因為「他有錢有時間」就推方案`
      );
    } else {
      bad.push(
        `<b>搖擺型客戶</b>：需求可有可無、但不缺錢時間${evidence}——這不是要／怕／想／愛／爽任何一級，<b>資源≠動機</b>。${
          wavering.pitchedFirst ? '業務卻直接推方案，會被「我再想想」帶走' : '業務沒有往想／愛／爽試探，也沒有敢判 C'
        }`
      );
      WAVERING_PROBES.filter((p) => !wavering.probedTypes.includes(p)).forEach((p) =>
        sug.push(`搖擺型試探（${p.label}）：<span class="q">「${p.question}」</span>`)
      );
      sug.push(
        '三句都問不出動機就敢判 C：<span class="q">「聽起來這件事對你現在不是非做不可，我不建議你現在花這筆錢——等你身邊有人開始用、你覺得有差再回來找我。」</span>敢不賣，他反而會記得你'
      );
    }
  }

  const summary =
    status === 'pass'
      ? '客戶越講越私人並出現信任突破，業務用先給／事實題／給退路打開他，沒有催促或追問被否認的點。'
      : status === 'partial'
        ? breakthrough
          ? '客戶已說出私人層資訊，但業務的信任行為（先給、給退路、被否認退一步、不催不審）尚未全部達標。'
          : '業務有部分建立信任的行為，但客戶仍未說出私人／動機層資訊——他還在偽裝。'
        : '客戶全程防守、業務也沒有做出讓他敢講真話的行為——先建立信任，再談挖掘。';

  return {
    title: '信任感 Trust',
    subtitle: '在陌生人面前講需求是示弱，客戶會偽裝。看他是否越講越私人，以及你有沒有讓他敢講',
    status,
    statusLabel: statusLabel(status),
    criteria,
    summary,
    trajectory: {
      startLevel: trajectory.startLevel,
      peak: trajectory.peak,
      rose: trajectory.rose,
      shutDown: trajectory.shutDown,
      levels: trajectory.levels.map((l) => ({ idx: l.idx, level: l.level, start: l.start })),
      breakthrough: breakthrough ? { idx: breakthrough.idx, start: breakthrough.start, text: breakthrough.text } : null,
      opener: openerSeg ? { text: openerSeg.text, start: openerSeg.start } : null,
    },
    wavering: {
      detected: wavering.detected,
      handled: wavering.handled,
      pitchedFirst: wavering.pitchedFirst,
      judgedC: wavering.judgedC,
      probedTypes: wavering.probedTypes.map((p) => p.key),
      needText: wavering.needSeg?.text || null,
      resourceText: wavering.resourceSeg?.text || null,
    },
    pressedCount: pressed.length,
    good,
    bad,
    sug,
    dominant: purposeProfile?.dominant?.key || null,
  };
}
