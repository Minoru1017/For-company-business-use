/**
 * 症狀紀錄 → 陪練：把最近真實通話最常出現的病症，換成一個「這次只練這件事」的陪練重點。
 * 純函式（不碰 DOM／IndexedDB），陪練結束後也用這裡判斷重點有沒有做到。
 */
import { aggregateSymptoms, dateKey, shiftDateKey, SYMPTOM_DEFS } from './symptom-engine.js';

export const RECENT_SYMPTOM_DAYS = 14;

export const DRILL_FOCUSES = {
  icebreak: {
    key: 'icebreak',
    label: '開場破冰',
    track: 'icebreak',
    symptoms: ['early_hangup', 'step_missing_connect', 'trust_shutdown'],
    goal: '30 秒內讓客戶願意多講一句',
    tip: '第一句講清楚你是誰、為什麼打來、現在方不方便；接著只丟一個開放問題。',
    check: (s) => ({
      met: s.endReason === 'icebreakWin' || (s.connected && s.timeouts === 0 && s.canned === 0),
      detail: s.endReason === 'icebreakWin' ? '客戶願意多聊' : s.connected ? '有連結，但客戶還沒打開' : '還沒建立連結',
    }),
  },
  listen: {
    key: 'listen',
    label: '讓客戶多說',
    track: 'full',
    symptoms: ['talk_too_much', 'short_replies', 'step_missing_discovery'],
    goal: '至少 3 個好問題，每句不超過一件事',
    tip: '問完就停，不補充、不解釋；客戶回一句短的，就追問「怎麼說？」。',
    check: (s) => ({
      met: s.goodQuestions >= 3 && s.tooLong === 0,
      detail: `好問題 ${s.goodQuestions} 句、太長 ${s.tooLong} 句`,
    }),
  },
  dig: {
    key: 'dig',
    label: '往下挖五層',
    track: 'full',
    symptoms: ['stuck_L1', 'trust_no_breakthrough', 'layer_shallow', 'layer_incomplete', 'no_converge', 'step_missing_clarify'],
    goal: '一般層挖到 3 層以上，並接著客戶的話追問',
    tip: '順著客戶剛說的詞往下問：現況 → 卡在哪 → 影響 → 為什麼是現在 → 想變成什麼樣子。',
    check: (s) => ({
      met: s.generalLayers >= 3 && s.followUps >= 2,
      detail: `挖到 ${s.generalLayers} 層、追問 ${s.followUps} 次`,
    }),
  },
  noRush: {
    key: 'noRush',
    label: '不急著推方案',
    track: 'full',
    symptoms: ['premature_pitch', 'pitch_without_verdict', 'step_missing_diagnose', 'step_missing_recommend'],
    goal: '先問清楚再提方案，整通沒有「太早推」',
    tip: '至少問完現況、問題、影響三層，先講適配結論與理由，才提方案。',
    check: (s) => ({
      met: s.tooEarly === 0 && s.salesLines >= 3,
      detail: s.tooEarly ? `太早推 ${s.tooEarly} 次` : '沒有太早推方案',
    }),
  },
  tier: {
    key: 'tier',
    label: '判斷目的分級',
    track: 'full',
    symptoms: ['purpose_unclassified', 'wrong_probe', 'no_amplify'],
    goal: '依客戶自己的話判斷要／怕／想／愛／爽，不問錯方向',
    tip: '先聽客戶在意的是什麼，再沿同一個分級往下挖；結束後的分級判斷題要答對。',
    check: (s, quiz) => ({
      met: s.wrongProbe === 0 && s.tierLayers >= 1 && quiz?.tierCorrect !== false,
      detail: `問錯方向 ${s.wrongProbe} 次、分級層 ${s.tierLayers} 層${quiz ? `、分級${quiz.tierCorrect ? '答對' : '答錯'}` : ''}`,
    }),
  },
  noFear: {
    key: 'noFear',
    label: '不恐嚇、不套話',
    track: 'full',
    symptoms: ['fear_words'],
    goal: '整通零恐嚇、零套話',
    tip: '只放大客戶自己說過的困擾，用他的原話，不自己嚇他。',
    check: (s) => ({
      met: s.fear === 0 && s.canned === 0,
      detail: `恐嚇 ${s.fear} 句、套話 ${s.canned} 句`,
    }),
  },
  close: {
    key: 'close',
    label: '收尾約下一步',
    track: 'full',
    symptoms: ['step_missing_decision'],
    goal: '通話結束時客戶答應下一步',
    tip: '確認「你最在意的是＿＿對嗎？」之後，給二選一的時間。',
    check: (s) => ({
      met: s.endReason === 'closed',
      detail: s.endReason === 'closed' ? '客戶答應下一步' : '還沒約到下一步',
    }),
  },
};

/** 底線類的病症即使次數少也要優先 */
const WEIGHT = { fear_words: 3 };

const SYMPTOM_TO_FOCUS = Object.fromEntries(
  Object.values(DRILL_FOCUSES).flatMap((f) => f.symptoms.map((k) => [k, f.key]))
);

export function getFocus(key) {
  return DRILL_FOCUSES[key] || null;
}

export function focusForSymptom(symptomKey) {
  return getFocus(SYMPTOM_TO_FOCUS[symptomKey]);
}

/**
 * @param {{total:number, symptoms:{key:string,label:string,count:number}[]}} agg aggregateSymptoms 的結果
 * @returns {null | {focus, score:number, total:number, symptoms:{key,label,count}[]}}
 */
export function pickDrillFocus(agg) {
  if (!agg?.total || !agg.symptoms?.length) return null;
  const scores = new Map();
  agg.symptoms.forEach((s) => {
    const fk = SYMPTOM_TO_FOCUS[s.key];
    if (!fk) return;
    const cur = scores.get(fk) || { score: 0, symptoms: [] };
    cur.score += s.count * (WEIGHT[s.key] || 1);
    cur.symptoms.push({ key: s.key, label: s.label || SYMPTOM_DEFS[s.key]?.label || s.key, count: s.count });
    scores.set(fk, cur);
  });
  const order = Object.keys(DRILL_FOCUSES);
  const best = [...scores.entries()].sort((a, b) => b[1].score - a[1].score || order.indexOf(a[0]) - order.indexOf(b[0]))[0];
  if (!best) return null;
  return {
    focus: DRILL_FOCUSES[best[0]],
    score: best[1].score,
    total: agg.total,
    symptoms: best[1].symptoms.sort((a, b) => b.count - a.count),
  };
}

export function evaluateFocus(focusKey, stats, quiz = null) {
  const f = getFocus(focusKey);
  if (!f || !stats) return null;
  return { key: f.key, label: f.label, goal: f.goal, ...f.check(stats, quiz) };
}

/** 讀症狀紀錄最近 N 天（含今天）的已分析通話並彙總 */
export async function recentSymptomAggregate(listCallsBetween, { now = new Date(), days = RECENT_SYMPTOM_DAYS } = {}) {
  const to = dateKey(now);
  const from = shiftDateKey(to, -(days - 1));
  const calls = await listCallsBetween(from, to);
  return aggregateSymptoms(calls || []);
}
