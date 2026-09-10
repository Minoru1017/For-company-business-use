import { describe, expect, it } from 'vitest';
import { runAnalysis } from '../src/analyze.js';
import {
  ACK_RE,
  buildCoaching,
  buildCustomerPrompt,
  CANNED_RE,
  classifySalesLine,
  DIFFICULTIES,
  endSession,
  judgeQuiz,
  MAX_SALES_TURNS,
  newSession,
  respond,
  sessionStats,
  sessionToSrt,
  sessionToText,
  startSession,
  timeoutTurn,
} from '../src/drill-engine.js';
import { DRILL_COMMON, DRILL_OPENING, getPersona } from '../src/drill-personas.js';
import { applyBuiltinSpeakerLabels, enrichSegments, parse } from '../src/parser.js';
import { labeledRatio } from '../src/speaker-labels.js';

const rand = () => 0;

function session(key = 'wang', opts = {}) {
  const s = newSession({ persona: getPersona(key), difficulty: 'gentle', limitSec: 30, rand, ...opts });
  startSession(s);
  return s;
}

function connect(s) {
  return respond(s, '您好，我是學院的顧問小陳，請問是王經理嗎？現在方便說話嗎？', 1500);
}

describe('drill engine: session flow', () => {
  it('customer picks up first; a proper opener gets the greeting, a stranger gets pushed back', () => {
    const s = session();
    expect(s.turns[0]).toMatchObject({ who: 'C', text: DRILL_OPENING, kind: 'opening' });

    const bad = session();
    const r0 = respond(bad, '你現在最困擾的是什麼？', 1000);
    expect(r0.classification.kind).toBe('noConnect');
    expect(r0.replies[0].text).toBe(bad.persona.noConnect);

    const r1 = connect(s);
    expect(r1.classification.kind).toBe('connect');
    expect(r1.replies[0].text).toBe(s.persona.greet);
    expect(s.connected).toBe(true);
  });

  it('reveals general layers only when asked specifically; vague questions get vague answers', () => {
    const s = session();
    connect(s);
    const r = respond(s, '想先了解一下你現在大概是什麼狀況？', 2000);
    expect(r.classification.kind).toBe('layer');
    expect(r.classification.layer).toBe(1);
    expect(r.replies[0].text).toBe(s.persona.layers[1]);
    expect(s.revealedGeneral.has(1)).toBe(true);

    const v = respond(s, '那你覺得 AI 怎麼樣？', 2000);
    expect(v.classification.kind).toBe('question');
    expect(v.classification.flags).toContain('vague');
    expect(DRILL_COMMON.vague).toContain(v.replies[0].text);

    const rep = respond(s, '你現在大概是什麼狀況？', 2000);
    expect(rep.classification.kind).toBe('repeat');
    expect(rep.replies[0].text).toBe(DRILL_COMMON.repeated);
  });

  it('walks the tier-specific ladder and answers facts', () => {
    const s = session('lin');
    connect(s);
    const t1 = respond(s, '對你來說，什麼事會讓你覺得真的很爽、很值得？', 3000);
    expect(t1.classification.kind).toBe('tierLayer');
    expect(t1.classification.tierLayer).toBe(1);
    expect(t1.replies[0].text).toBe(s.persona.tierLayers[1]);

    const f = respond(s, '你一週大概能有多少時間？', 3000);
    expect(f.classification.kind).toBe('fact');
    expect(f.classification.fact).toBe('time');
    expect(f.replies[0].text).toBe(s.persona.facts.time);

    const b = respond(s, '預算上你有什麼想法嗎？', 3000);
    expect(b.classification).toMatchObject({ kind: 'fact', fact: 'budget' });
  });

  it('wrong-direction probe is deflected (爽什麼 customer asked about fear)', () => {
    const s = session('lin');
    connect(s);
    const r = respond(s, '你最擔心的是什麼？', 2000);
    expect(r.classification.kind).toBe('wrongProbe');
    expect(r.classification.toward).toBe('怕什麼');
    expect(r.replies[0].text).toBe(s.persona.deflect);
    expect(s.revealedTier.size).toBe(0);
  });

  it('pitching before three layers is punished; after enough info it is answered', () => {
    const s = session();
    connect(s);
    const early = respond(s, '我們的培訓營很適合你，可以幫團隊落地。', 2000);
    expect(early.classification.kind).toBe('tooEarly');
    expect(early.replies[0].text).toBe(s.persona.tooEarly);
    const moodAfterEarly = s.mood;

    respond(s, '你現在大概是什麼狀況？', 2000);
    respond(s, '現在最困擾你的地方是什麼？', 2000);
    respond(s, '如果一直這樣下去，對你影響最大的是什麼？', 2000);
    expect(s.revealedGeneral.size).toBe(3);
    expect(s.mood).toBeGreaterThan(moodAfterEarly);
    const ok = respond(s, '我們的培訓營就是針對你說的團隊落地這段。', 2000);
    expect(ok.classification.kind).toBe('pitch');
    expect(ok.replies[0].text).toBe(s.persona.pitchReply);
  });

  it('fear words and canned phrases get pushback and cost mood', () => {
    const s = session();
    connect(s);
    const m0 = s.mood;
    const fear = respond(s, '你再不學就會被淘汰，完蛋了。', 1000);
    expect(fear.classification.kind).toBe('fear');
    expect(fear.replies[0].text).toBe(DRILL_COMMON.fearReact);
    expect(s.mood).toBeLessThan(m0);

    const canned = respond(s, '現在報名有優惠，名額有限喔。', 1000);
    expect(canned.classification.kind).toBe('canned');
    expect(canned.classification.flags).toContain('canned');
    expect(CANNED_RE.test('保證學會')).toBe(true);
  });

  it('acknowledgement detection ignores 「了解一下」 but catches real acknowledgements', () => {
    expect(ACK_RE.test('想先了解一下你現在大概是什麼狀況？')).toBe(false);
    expect(ACK_RE.test('了解，那你最在意的是什麼？')).toBe(true);
    expect(ACK_RE.test('這個問題很合理。')).toBe(true);
    expect(ACK_RE.test('你剛提到團隊帶不動，可以多說一點嗎？')).toBe(true);
    expect(ACK_RE.test('嗯，我懂你的意思。')).toBe(true);
  });

  it('timeouts: one gets pressure, two in a row hangs up', () => {
    const s = session();
    connect(s);
    const t1 = timeoutTurn(s);
    expect(t1.replies[0].kind).toBe('pressure');
    expect(s.ended).toBe(false);
    const t2 = timeoutTurn(s);
    expect(t2.replies[0].kind).toBe('hangup');
    expect(s.ended).toBe(true);
    expect(s.endReason).toBe('hangup');
    expect(() => respond(s, 'x', 0)).toThrow();
  });

  it('a spoken line resets the blank streak', () => {
    const s = session();
    connect(s);
    timeoutTurn(s);
    respond(s, '不好意思，你現在大概是什麼狀況？', 1000);
    expect(s.blanksInRow).toBe(0);
    timeoutTurn(s);
    expect(s.ended).toBe(false);
  });

  it('objections are scheduled by difficulty and judged on the next line', () => {
    const s = newSession({ persona: getPersona('chen'), difficulty: 'normal', limitSec: 30, rand });
    startSession(s);
    connect(s); // turn 1
    respond(s, '你現在大概是什麼狀況？', 1000); // 2
    const r3 = respond(s, '現在最困擾你的是什麼？', 1000); // 3 → objection
    expect(r3.replies.map((x) => x.kind)).toEqual(['info', 'objection']);
    expect(s.pendingObjection).toBe(s.persona.objections[0]);
    expect(s.objectionsThrown).toBe(1);

    const handled = respond(s, '這個問題很合理。你會這樣問，是之前買過的課沒用完嗎？', 2000);
    expect(handled.classification.flags).toContain('handled');
    expect(s.objectionsHandled).toBe(1);
    expect(s.pendingObjection).toBeNull();

    respond(s, '如果一直這樣下去，對你影響最大的是什麼？', 1000); // 5
    const r6 = respond(s, '為什麼這件事現在對你這麼重要？', 1000); // 6 → objection #2
    expect(r6.replies.at(-1).kind).toBe('objection');
    const missed = respond(s, '我們的培訓營課程非常適合您。', 1000);
    expect(missed.classification.flags).toContain('missedObjection');
    expect(missed.replies[0].text).toBe(DRILL_COMMON.objectionMissed);
    expect(s.objectionsHandled).toBe(1);
    expect(DIFFICULTIES.hard.every).toBeLessThan(DIFFICULTIES.gentle.every);
  });

  it('closing: decision accepted only after enough info and an explicit diagnosis', () => {
    const s = session();
    connect(s);
    const tooSoon = respond(s, '那我們約禮拜四晚上安排體驗好嗎？', 1000);
    expect(tooSoon.classification.kind).toBe('decision');
    expect(tooSoon.replies[0].text).toBe(s.persona.notYet);
    expect(s.ended).toBe(false);

    respond(s, '你現在大概是什麼狀況？', 1000);
    respond(s, '現在最困擾你的地方是什麼？', 1000);
    respond(s, '如果一直這樣下去，對你影響最大的是什麼？', 1000);
    respond(s, '為什麼這件事現在對你這麼重要？', 1000);
    const d = respond(s, '依照你的狀況，我判斷培訓營是高度適合你的，因為團隊落地就是它處理的。', 1000);
    expect(d.classification.kind).toBe('diagnose');
    expect(d.replies[0].text).toBe(s.persona.whyFit);
    const close = respond(s, '那我們下一步約禮拜四晚上，我把資料發給你，方便嗎？', 1000);
    expect(close.replies.at(-1).kind).toBe('accept');
    expect(s.ended).toBe(true);
    expect(s.endReason).toBe('closed');
  });

  it('converge check: agrees only once enough has been uncovered', () => {
    const s = session();
    connect(s);
    expect(respond(s, '所以你真正想解決的是團隊帶不動，我理解對嗎？', 1000).replies[0].text).toBe(DRILL_COMMON.converge.no);
    respond(s, '你現在大概是什麼狀況？', 1000);
    respond(s, '現在最困擾你的地方是什麼？', 1000);
    respond(s, '你一週有多少時間？', 1000);
    expect(respond(s, '所以你真正需要的是一套團隊能照做的方法，我理解對嗎？', 1000).replies[0].text).toBe(DRILL_COMMON.converge.yes);
  });

  it('stops after MAX_SALES_TURNS and respects manual end', () => {
    const s = session();
    connect(s);
    for (let i = 0; i < MAX_SALES_TURNS && !s.ended; i++) respond(s, '嗯嗯，了解。', 500);
    expect(s.ended).toBe(true);
    expect(s.endReason).toBe('maxTurns');
    const m = session();
    endSession(m, 'manual');
    expect(m.endReason).toBe('manual');
    endSession(m, 'other');
    expect(m.endReason).toBe('manual');
  });
});

describe('drill engine: scoring, coaching, export', () => {
  function goodRun() {
    const s = session('wang');
    connect(s);
    respond(s, '想先了解一下你現在大概是什麼狀況？', 2000);
    respond(s, '你剛提到團隊幾乎沒人在用，那現在最困擾你的地方是什麼？', 2500);
    respond(s, '報價單和追蹤都人工做，如果一直這樣下去，對你影響最大的是什麼？', 2500);
    respond(s, '你說老闆一直在問，為什麼這件事現在對你這麼重要？', 2500);
    respond(s, '如果真的解決了，三個月後你最希望團隊變成什麼樣子？', 2500);
    respond(s, '所以你真正想解決的是團隊帶不動、每週十幾小時在收尾，我理解對嗎？', 2500);
    respond(s, '依照你的狀況、目標和時間，我判斷培訓營是高度適合你的，因為它就是團隊共學加實戰產出。', 3000);
    respond(s, '那我們下一步約禮拜四晚上，我先把資料發給你，方便嗎？', 2000);
    return s;
  }

  it('a disciplined call scores high with positive coaching; the tier quiz is judged', () => {
    const s = goodRun();
    expect(s.endReason).toBe('closed');
    const stats = sessionStats(s);
    expect(stats.timeouts).toBe(0);
    expect(stats.canned).toBe(0);
    expect(stats.fear).toBe(0);
    expect(stats.generalLayers).toBe(5);
    expect(stats.followUpRate).toBeGreaterThan(0.4);
    expect(stats.score).toBeGreaterThanOrEqual(80);
    expect(stats.verdict).toBe('穩');

    const quiz = judgeQuiz(s, { tier: 'want', fit: 'A' });
    expect(quiz.tierCorrect).toBe(true);
    expect(quiz.fitCorrect).toBe(true);
    const coaching = buildCoaching(s, stats, quiz);
    expect(coaching.good.length).toBeGreaterThan(3);
    expect(coaching.good.join(' ')).toMatch(/分級判斷正確/);

    const wrong = judgeQuiz(s, { tier: 'fear', fit: 'C' });
    expect(wrong.tierCorrect).toBe(false);
    const c2 = buildCoaching(s, stats, wrong);
    expect(c2.bad.join(' ')).toMatch(/分級判斷錯了/);
    expect(c2.bad.join(' ')).toMatch(/適配判斷不同/);
  });

  it('a panicked call scores low and the coaching names every failure mode', () => {
    const s = newSession({ persona: getPersona('lin'), difficulty: 'hard', limitSec: 15, rand });
    startSession(s);
    respond(s, '你好，我是顧問。', 3000);
    timeoutTurn(s);
    respond(s, '現在報名有優惠，我們的課程非常適合您，不學就會被淘汰。', 14000);
    respond(s, '你最擔心的是什麼？', 9000);
    respond(s, '你覺得 AI 怎麼樣？', 9000);
    respond(s, '那你覺得呢？', 9000);
    if (!s.ended) endSession(s, 'manual');
    const stats = sessionStats(s);
    expect(stats.timeouts).toBe(1);
    expect(stats.fear).toBe(1);
    expect(stats.canned).toBe(1);
    expect(stats.wrongProbe).toBe(1);
    expect(stats.score).toBeLessThan(60);
    expect(stats.verdict).toBe('需要再練');
    const coaching = buildCoaching(s, stats, null);
    const all = coaching.bad.join('\n');
    expect(all).toMatch(/卡住 1 次/);
    expect(all).toMatch(/套話/);
    expect(all).toMatch(/恐嚇用語/);
    expect(all).toMatch(/問錯方向/);
    expect(all).toMatch(/爽什麼/);
  });

  it('exports an SRT the normal parser/analysis pipeline accepts, with blanks dropped', () => {
    const s = goodRun();
    timeoutTurn; // not used in the good run
    const srt = sessionToSrt(s);
    expect(srt).toMatch(/\[SPEAKER_00\]/);
    expect(srt).toMatch(/\[SPEAKER_01\]/);
    expect(srt).not.toMatch(/沒接上話/);
    const segs = parse(srt);
    applyBuiltinSpeakerLabels(segs);
    enrichSegments(segs);
    expect(labeledRatio(segs)).toBe(1);
    expect(segs[0]).toMatchObject({ spk: 'C', text: DRILL_OPENING });
    expect(segs.filter((x) => x.spk === 'S').length).toBe(9);
    for (let i = 1; i < segs.length; i++) expect(segs[i].start).toBeGreaterThanOrEqual(segs[i - 1].end);
    const r = runAnalysis(segs);
    expect(Object.values(r.stepHit).filter(Boolean).length).toBeGreaterThanOrEqual(5);
    expect(r.layerHits.filter((l) => l.hit).length).toBe(5);
    expect(r.purposeProfile.dominant?.key).toBe('want');
  });

  it('text export strips HTML and lists flags; the AI prompt carries persona and turn guidance', () => {
    const s = goodRun();
    const stats = sessionStats(s);
    const quiz = judgeQuiz(s, { tier: 'want', fit: 'A' });
    const txt = sessionToText(s, stats, buildCoaching(s, stats, quiz), quiz);
    expect(txt).toMatch(/臨場反應陪練/);
    expect(txt).not.toMatch(/<b>|<span/);
    expect(txt).toMatch(/業務：/);
    expect(txt).toMatch(/正解 要什麼/);

    const s2 = session('huang');
    connect(s2);
    const c = classifySalesLine('你現在大概是什麼狀況？', s2);
    const prompt = buildCustomerPrompt(s2, c, { text: s2.persona.layers[1], kind: 'info' });
    expect(prompt).toMatch(/黃老師/);
    expect(prompt).toMatch(/愛什麼/);
    expect(prompt).toMatch(/本輪資訊】/);
    expect(prompt).toMatch(/"reply"/);
    expect(prompt).not.toMatch(/undefined/);
  });
});
