import { describe, expect, it } from 'vitest';
import { runAnalysis } from '../src/analyze.js';
import { detectKeyMoments } from '../src/key-moments.js';
import { enrichSegments } from '../src/parser.js';
import {
  DISCLOSURE_LABELS,
  detectWavering,
  disclosureLevel,
  disclosureTrajectory,
  evaluateTrust,
  firstBreakthroughIdx,
  WAVERING_PROBES,
} from '../src/trust.js';

function seg(spk, text, i) {
  return { start: i * 5, end: i * 5 + 4, text, spk };
}
function dialogue(lines) {
  return enrichSegments(lines.map(([spk, text], i) => seg(spk, text, i)));
}

/** 搖擺型客戶 × 業務直接推方案（錯誤示範） */
const WAVERING_PITCHED = dialogue([
  ['S', '您好，我是 AI 學院的顧問，請問方便聊嗎？'],
  ['C', '可以，就是了解一下'],
  ['S', '你現在最擔心的是什麼？'],
  ['C', '沒有特別擔心'],
  ['S', '那你怕不怕被淘汰？'],
  ['C', '還好'],
  ['S', '那預算跟時間上有限制嗎？'],
  ['C', '學費不是問題，時間也很多，只是需求可有可無'],
  ['S', '那太好了，我們的企業 AI 落地培訓營很適合你，這期名額只剩三個，今天報名有優惠'],
  ['C', '我再想想'],
]);

/** 搖擺型客戶 × 先給、事實題、給退路、想什麼試探 → 信任突破（正確示範） */
const WAVERING_HANDLED = dialogue([
  ['S', '您好，我是 AI 學院的顧問，請問方便聊嗎？'],
  ['C', '可以，就是了解一下'],
  ['S', '我先說，不一定適合你，聊完你覺得不需要也沒關係。我接觸蠻多主管，卡的都不是工具，是團隊帶不動。你們那邊幾個人、平常用什麼工具？'],
  ['C', '我們六個人，現在只有我自己用 ChatGPT'],
  ['S', '那你們現在報價這段大概是誰在做、花多久？'],
  ['C', '都是人工在做，其實我自己想教又不知道從哪教，很卡'],
  ['S', '預算跟時間上有限制嗎？'],
  ['C', '學費不是問題，時間也很多，只是這件事對我來說可有可無'],
  ['S', '了解。那你身邊的同行有人已經在用了嗎？你看他們在用的時候自己是什麼感覺？'],
  ['C', '老實說，老闆一直問為什麼別的部門都用 AI 了我們還在加班，我怕下個月提計畫的時候被說跟不上'],
  ['S', '所以你真正想解決的是團隊帶不動，因為老闆在看；你真正需要的是一套團隊能照著做的方法，我理解對嗎？'],
  ['C', '對，就是這樣'],
]);

describe('disclosureLevel', () => {
  it('grades customer lines from guarded to private', () => {
    expect(disclosureLevel('嗯')).toBe(0);
    expect(disclosureLevel('還好')).toBe(0);
    expect(disclosureLevel('還好，沒有特別困擾')).toBe(0);
    expect(disclosureLevel('就是了解一下，沒有特別需要，錢跟時間倒不是問題')).toBe(0);
    expect(disclosureLevel('我們六個人，用 ChatGPT')).toBe(1);
    expect(disclosureLevel('我不知道怎麼教團隊')).toBe(2);
    expect(disclosureLevel('其實我老闆一直在問')).toBe(3);
    expect(disclosureLevel('我怕我帶他們上完課，回到公司還是不會用。')).toBe(3);
    expect(DISCLOSURE_LABELS).toHaveLength(4);
  });

  it('does not count an echoed denial ("擔心？也沒有特別擔心") as private disclosure', () => {
    expect(disclosureLevel('擔心？也沒有特別擔心什麼，就是想把事情弄起來。')).toBeLessThan(3);
  });

  it('candor markers raise the level', () => {
    expect(disclosureLevel('報表這段很卡')).toBe(2);
    expect(disclosureLevel('其實我們報表這段很卡')).toBe(3);
  });
});

describe('disclosureTrajectory / breakthrough', () => {
  it('detects rising disclosure and the first breakthrough line', () => {
    const t = disclosureTrajectory(WAVERING_HANDLED);
    expect(t.peak).toBe(3);
    expect(t.startLevel).toBe(0);
    expect(t.rose).toBe(true);
    expect(t.shutDown).toBe(false);
    expect(t.breakthrough.idx).toBe(5);
    expect(firstBreakthroughIdx(WAVERING_HANDLED)).toBe(5);
  });

  it('reports no breakthrough when the customer stays guarded', () => {
    const t = disclosureTrajectory(WAVERING_PITCHED);
    expect(t.peak).toBeLessThanOrEqual(1);
    expect(t.rose).toBe(false);
    expect(t.breakthrough).toBeNull();
    expect(firstBreakthroughIdx(WAVERING_PITCHED)).toBe(-1);
  });

  it('flags a customer who opens up then shuts down, but not normal short closing replies', () => {
    const shut = disclosureTrajectory(
      dialogue([
        ['S', '現在最困擾你的是什麼？'],
        ['C', '報價單這段很卡，每次都要重工'],
        ['S', '那你怕不怕被淘汰？'],
        ['C', '還好啦，沒有想那麼多，就是看看'],
        ['S', '預算大概多少？'],
        ['C', '這個要看公司，我們有六個人'],
      ])
    );
    expect(shut.shutDown).toBe(true);
    const closing = disclosureTrajectory(
      dialogue([
        ['S', '現在最困擾你的是什麼？'],
        ['C', '老實說老闆一直在問，我怕被說跟不上'],
        ['S', '所以你真正需要的是一套方法，我理解對嗎？'],
        ['C', '對'],
        ['S', '那我們約下週二體驗？'],
        ['C', '好，可以'],
      ])
    );
    expect(closing.shutDown).toBe(false);
    expect(closing.rose).toBe(true);
  });

  it('handles empty input', () => {
    expect(disclosureTrajectory([]).levels).toEqual([]);
    expect(evaluateTrust([]).status).toBe('fail');
  });
});

describe('detectWavering', () => {
  it('flags need-optional + resources-available and whether sales pitched first', () => {
    const w = detectWavering(WAVERING_PITCHED);
    expect(w.detected).toBe(true);
    expect(w.pitchedFirst).toBe(true);
    expect(w.handled).toBe(false);
    expect(w.probedTypes).toEqual([]);
  });

  it('accepts probing 想／愛／爽 as the correct move', () => {
    const w = detectWavering(WAVERING_HANDLED);
    expect(w.detected).toBe(true);
    expect(w.pitchedFirst).toBe(false);
    expect(w.probedTypes.map((p) => p.key)).toContain('think');
    expect(w.handled).toBe(true);
  });

  it('accepts a brave C verdict as handling', () => {
    const segs = dialogue([
      ['S', '預算跟時間上有限制嗎？'],
      ['C', '學費不是問題，時間也很多，只是需求可有可無'],
      ['S', '聽起來這件事對你現在不是非做不可，我目前不建議你花這筆錢。'],
      ['C', '好'],
    ]);
    const w = detectWavering(segs);
    expect(w.detected).toBe(true);
    expect(w.judgedC).toBe(true);
    expect(w.handled).toBe(true);
  });

  it('does not fire when only one signal is present', () => {
    expect(detectWavering(dialogue([['C', '需求可有可無']])).detected).toBe(false);
    expect(detectWavering(dialogue([['C', '時間很多，學費不是問題']])).detected).toBe(false);
    expect(WAVERING_PROBES.map((p) => p.key)).toEqual(['think', 'love', 'enjoy']);
  });
});

describe('evaluateTrust', () => {
  it('fails the pitched-on-budget call and coaches the three probes + C verdict', () => {
    const t = evaluateTrust(WAVERING_PITCHED);
    expect(t.status).toBe('fail');
    const byKey = Object.fromEntries(t.criteria.map((c) => [c.key, c]));
    expect(byKey.wavering.pass).toBe(false);
    expect(byKey.safe.pass).toBe(false);
    expect(byKey.retreat.pass).toBe(false);
    expect(byKey.breakthrough.pass).toBe(false);
    const text = [...t.bad, ...t.sug].join('\n');
    expect(text).toContain('搖擺型');
    expect(text).toContain('資源≠動機');
    expect(text).toContain('身邊的同行');
    expect(text).toContain('希望別人怎麼看你');
    expect(text).toContain('很值得');
    expect(text).toContain('敢判 C');
  });

  it('passes the trust-building call and names the breakthrough opener', () => {
    const t = evaluateTrust(WAVERING_HANDLED);
    expect(t.status).toBe('pass');
    const byKey = Object.fromEntries(t.criteria.map((c) => [c.key, c]));
    expect(byKey.giveFirst.pass).toBe(true);
    expect(byKey.factQ.pass).toBe(true);
    expect(byKey.exit.pass).toBe(true);
    expect(byKey.disclose.pass).toBe(true);
    expect(byKey.breakthrough.pass).toBe(true);
    expect(byKey.wavering.pass).toBe(true);
    expect(t.trajectory.opener.text).toContain('誰在做');
    expect(t.good.join('\n')).toContain('信任突破');
    expect(t.good.join('\n')).toContain('搖擺型客戶處理正確');
  });

  it('flags pressing a denied topic with a synonym', () => {
    const segs = dialogue([
      ['S', '你現在最擔心的是什麼？'],
      ['C', '沒有特別擔心'],
      ['S', '那你怕不怕被淘汰？'],
      ['C', '還好'],
    ]);
    const t = evaluateTrust(segs);
    expect(t.pressedCount).toBe(1);
    expect(t.criteria.find((c) => c.key === 'retreat').pass).toBe(false);
  });

  it('accepts a retreat after denial', () => {
    const segs = dialogue([
      ['S', '你現在最擔心的是什麼？'],
      ['C', '沒有特別擔心'],
      ['S', '了解，那不是重點。那你們現在這段大概是誰在做？'],
      ['C', '都是我在做'],
    ]);
    expect(evaluateTrust(segs).pressedCount).toBe(0);
  });

  it('flags interrogation runs of short answers', () => {
    const segs = dialogue([
      ['S', '你有在用 AI 嗎？'],
      ['C', '有'],
      ['S', '用多久了？'],
      ['C', '一年'],
      ['S', '團隊有在用嗎？'],
      ['C', '沒有'],
      ['S', '為什麼？'],
      ['C', '不知道'],
    ]);
    const t = evaluateTrust(segs);
    expect(t.criteria.find((c) => c.key === 'safe').pass).toBe(false);
    expect(t.bad.join('\n')).toContain('連續審問');
  });

  it('escapes transcript text in evidence', () => {
    const xss = '<img src=x onerror=alert(1)>';
    const segs = dialogue([
      ['S', '你們現在幾個人？'],
      ['C', `其實我老闆一直在問 ${xss}`],
    ]);
    const t = evaluateTrust(segs);
    expect(t.good.join('\n')).toContain('&lt;img');
    expect(t.good.join('\n')).not.toContain('<img');
  });
});

describe('integration', () => {
  it('runAnalysis exposes trust as a third manual check and in the report', () => {
    const r = runAnalysis(WAVERING_PITCHED);
    expect(r.manualChecks.trust.title).toContain('信任感');
    expect(r.trust.wavering.detected).toBe(true);
    expect(r.reportText).toContain('信任檢核：未達標');
    expect(r.reportText).toContain('搖擺型客戶');
    expect(r.bad.some((b) => b.includes('搖擺型'))).toBe(true);
  });

  it('key moments mark the first breakthrough', () => {
    const moments = detectKeyMoments(WAVERING_HANDLED);
    const bt = moments.filter((m) => m.breakthrough);
    expect(bt).toHaveLength(1);
    expect(bt[0].endIdx).toBe(5);
    expect(bt[0].label).toContain('信任突破');
  });

  it('key moments use the trust type when nothing else classifies the pair', () => {
    const segs = dialogue([
      ['S', '我先講一下我看到的，很多主管自己會用，團隊帶不動。'],
      ['C', '老實說我老闆一直在問我為什麼別的部門都用了'],
    ]);
    const moments = detectKeyMoments(segs);
    expect(moments.some((m) => m.type === 'trust')).toBe(true);
  });
});
