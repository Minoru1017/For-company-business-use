import { describe, expect, it } from 'vitest';
import {
  applyQuoteMatches,
  buildDecisionPrompt,
  buildDemoGuidePrompt,
  buildQuoteMatchPrompt,
  findQuoteMoments,
  formatClock,
  guideStats,
  guideToText,
  normalizeDemoGuide,
  parseClock,
  parseDecisionResponse,
  parseDemoGuideResponse,
  parseQuoteMatchResponse,
  patchGuideRoute,
  quoteMatchSchema,
  selectQuoteCandidates,
} from '../src/demo-review-guide.js';
import { decisionCardModel } from '../src/demo-review-decision-card.js';

const ROUTES = [
  {
    id: 'route_1',
    title: '週報流程',
    customerQuote: '每週整理報表要四小時',
    hypothesis: '主要問題是資料彙整',
    demo: 'Excel 轉週報初稿',
    beforeQuestion: '目前最花時間的是哪一步？',
    signals: ['指出實際欄位', '主動詢問核對'],
    afterQuestion: '這能省掉哪一步？',
    stopCondition: '資料格式不固定',
    avoid: '圖片生成',
  },
  {
    id: 'route_2',
    title: '人工覆核',
    customerQuote: '擔心數字錯誤',
    hypothesis: '正確性比速度重要',
    demo: '異常標記與人工確認',
    beforeQuestion: '哪些數字一定要人工核對？',
    signals: ['提出驗收方式'],
    afterQuestion: '這個覆核方式能否接受？',
    stopCondition: '不願提供資料',
    avoid: '其他工具介紹',
  },
];

describe('consultative DEMO P1', () => {
  it('parses at most three routes and initializes field evidence', () => {
    const g = parseDemoGuideResponse(JSON.stringify({ routes: [...ROUTES, ROUTES[0], ROUTES[1]] }));
    expect(g.routes).toHaveLength(3);
    expect(g.routes[0]).toMatchObject({ result: 'pending', reaction: 'none', observedQuote: '' });
    expect(g.decision).toBeNull();
  });

  it('updates one route, clears stale decision and computes progress', () => {
    const base = normalizeDemoGuide({ routes: ROUTES, decision: { internal: { verdict: 'old' } } });
    const one = patchGuideRoute(base, 'route_1', { result: 'confirmed', reaction: 'inquiry', observedQuote: '這個可以省很多時間' });
    expect(one.decision).toBeNull();
    expect(guideStats(one)).toMatchObject({ total: 2, tested: 1, confirmed: 1, withQuote: 1, complete: false });
    const two = patchGuideRoute(one, 'route_2', { result: 'rejected' });
    expect(guideStats(two)).toMatchObject({ tested: 2, rejected: 1, complete: true });
  });

  it('builds a route prompt grounded in P0 and course facts', () => {
    const prompt = buildDemoGuidePrompt({
      review: { customer: '王小姐', reaction: '看到週報主動追問', consult: { diagnosis: { current: '每週手動整理' }, implementation: { acceptance: '一小時內完成' }, evidence: [], gaps: [], next: {} } },
      deckInput: { goals: '自動化週報', raw: '每週要四小時' },
      courseNotes: '提供工作坊與作業回饋',
    });
    expect(prompt).toContain('不是產品功能導覽');
    expect(prompt).toContain('現況：每週手動整理');
    expect(prompt).toContain('提供工作坊與作業回饋');
    expect(prompt).toContain('不該展示');
  });

  it('builds decision prompt from field evidence and parses two safe cards', () => {
    const guide = patchGuideRoute(normalizeDemoGuide({ routes: ROUTES, resistanceWords: '我要跟主管討論' }), 'route_1', {
      result: 'confirmed',
      reaction: 'agreed',
      observedQuote: '這至少省一半時間',
    });
    const prompt = buildDecisionPrompt({ review: { customer: '王小姐' }, guide });
    expect(prompt).toContain('這至少省一半時間');
    expect(prompt).toContain('內部標籤');

    const decision = parseDecisionResponse(
      JSON.stringify({
        resistance: { customerWords: '我要跟主管討論', category: 'authority', hypothesis: '決策人缺席', verifyQuestion: '主管最需要確認哪一點？', action: '安排 15 分鐘共識會', status: 'confirmed' },
        internal: { verdict: 'B 部分適合', validated: ['週報流程有價值'], revised: ['速度不是唯一重點'], risks: ['決策人未參與'], strategy: '邀請主管', investment: '安排一次短會' },
        external: { current: '每週手動整理', goal: '縮短時間', validatedScene: '週報初稿', pilot: '先做一份', roles: '客戶提供樣本', acceptance: '一小時內完成', risks: '資料格式需固定', nextDecision: '主管確認驗收標準' },
      })
    );
    const withDecision = normalizeDemoGuide({ ...guide, decision });
    expect(guideToText(withDecision, 'internal')).toContain('B 部分適合');
    const external = guideToText(withDecision, 'external');
    expect(external).toContain('【DEMO 決策共識】');
    expect(external).not.toContain('B 部分適合');

    const review = { customer: '王小姐', demoGuide: withDecision };
    const internalCard = decisionCardModel(review, 'internal');
    const externalCard = decisionCardModel(review, 'external');
    expect(internalCard.rows.some((x) => x.text.includes('B 部分適合'))).toBe(true);
    expect(externalCard.rows.some((x) => x.text.includes('B 部分適合'))).toBe(false);
    expect(externalCard.footer).toContain('不代表正式合約');

    const leaked = normalizeDemoGuide({
      ...guide,
      decision: {
        ...decision,
        external: { ...decision.external, goal: 'B 部分適合，成交機率 80%' },
      },
    });
    expect(leaked.decision.external.goal).toBe('');
  });

  it('formats and parses recording clock times', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(1938.6)).toBe('32:18');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(parseClock('32:18')).toBe(1938);
    expect(parseClock('1:02:05')).toBe(3725);
    expect(parseClock('95')).toBe(95);
    expect(parseClock('3２:1')).toBeNull();
    expect(parseClock('32：18')).toBe(1938);
    expect(parseClock('12:75')).toBeNull();
    expect(parseClock('')).toBeNull();
  });

  it('keeps quote timestamps on routes and in evidence text', () => {
    const base = normalizeDemoGuide({ routes: ROUTES });
    expect(base.routes[0].quoteAt).toBeNull();
    const g = patchGuideRoute(base, 'route_1', { result: 'confirmed', observedQuote: '這樣每週能省三小時', quoteAt: 1938.64 });
    expect(g.routes[0].quoteAt).toBe(1938.6);
    expect(patchGuideRoute(g, 'route_1', { quoteAt: -3 }).routes[0].quoteAt).toBeNull();
    expect(guideStats(g)).toMatchObject({ withQuote: 1, withTime: 1 });
    const prompt = buildDecisionPrompt({ review: { customer: '王小姐' }, guide: g, deckInput: {}, courseNotes: '' });
    expect(prompt).toContain('這樣每週能省三小時（錄影 32:18）');
  });

  it('finds the closest customer lines in a transcript', () => {
    const segs = [
      { start: 10, text: '每週整理報表要花四個小時', spk: 'S' },
      { start: 62, text: '我們每週整理報表真的要四小時左右', spk: 'C' },
      { start: 130, text: '好', spk: 'C' },
      { start: 200, text: '主管最在意的是數字有沒有錯', spk: 'C' },
    ];
    const hits = findQuoteMoments(segs, '整理報表四小時');
    expect(hits[0]).toMatchObject({ index: 1, start: 62 });
    expect(hits.every((h) => segs[h.index].spk === 'C')).toBe(true);
    const fallback = findQuoteMoments(segs, '');
    expect(fallback.map((h) => h.start)).toEqual([62, 200]);
    expect(findQuoteMoments(null, 'x')).toEqual([]);
  });

  const SEGS = [
    { start: 5, text: '今天幫您看看週報要怎麼整理比較快', spk: 'S' },
    { start: 62, text: '我們每週整理報表真的要四小時左右', spk: 'C' },
    { start: 130, text: '好', spk: 'C' },
    { start: 1938, text: '其實報表不難，最花時間的是跟各部門要資料', spk: 'C' },
    { start: 2010, text: '主管最在意的是數字有沒有錯，錯一次就不敢用', spk: 'C' },
  ];

  it('selects only customer lines as candidates, in time order', () => {
    const routes = normalizeDemoGuide({ routes: ROUTES }).routes;
    const c = selectQuoteCandidates(SEGS, routes);
    expect(c.map((x) => x.start)).toEqual([62, 1938, 2010]);
    expect(c.map((x) => x.id)).toEqual(['L1', 'L2', 'L3']);
    expect(c.every((x) => SEGS[x.index].spk === 'C')).toBe(true);
    expect(selectQuoteCandidates(SEGS, routes, { max: 2 })).toHaveLength(2);
    const prompt = buildQuoteMatchPrompt({ routes, candidates: c });
    expect(prompt).toContain('route_1｜週報流程｜主要問題是資料彙整');
    expect(prompt).toContain('L2｜其實報表不難');
    expect(prompt).not.toContain('今天幫您看看');
    const schema = quoteMatchSchema(routes, c);
    expect(schema.properties.judgments.items.properties.line.enum).toEqual(['L1', 'L2', 'L3']);
    expect(schema.properties.judgments.items.properties.stance.enum).toContain('unrelated');
  });

  it('keeps only valid choices and uses local transcript text and time', () => {
    const routes = normalizeDemoGuide({ routes: ROUTES }).routes;
    const candidates = selectQuoteCandidates(SEGS, routes);
    const raw = JSON.stringify({
      judgments: [
        { route: 'route_1', line: 'L1', stance: 'support', confidence: 'medium', text: '模型亂寫的原話' },
        { route: 'route_1', line: 'L2', stance: 'revise', confidence: 'high' },
        { route: 'route_1', line: 'L2', stance: 'support', confidence: 'low' },
        { route: 'route_2', line: 'L3', stance: 'support', confidence: 'high' },
        { route: 'route_2', line: 'L1', stance: 'unrelated', confidence: 'high' },
        { route: 'route_9', line: 'L1', stance: 'support', confidence: 'high' },
        { route: 'route_2', line: 'L99', stance: 'reject', confidence: 'high' },
      ],
    });
    const out = parseQuoteMatchResponse(raw, { routes, candidates });
    expect(out.route_1.map((m) => [m.start, m.stance])).toEqual([
      [1938, 'revise'],
      [62, 'support'],
    ]);
    expect(out.route_1[1].text).toBe('我們每週整理報表真的要四小時左右');
    expect(out.route_2).toHaveLength(1);
    expect(out.route_9).toBeUndefined();

    const g = applyQuoteMatches(normalizeDemoGuide({ routes: ROUTES, decision: { internal: { verdict: 'keep' } } }), out, 123);
    expect(g.matchAt).toBe(123);
    expect(g.routes[0].matches).toHaveLength(2);
    expect(g.decision.internal.verdict).toBe('keep');
    const patched = patchGuideRoute(g, 'route_1', { observedQuote: out.route_1[0].text, quoteAt: out.route_1[0].start });
    expect(patched.routes[0].matches).toHaveLength(2);
    expect(normalizeDemoGuide({ routes: [{ ...ROUTES[0], matches: [{ text: 'x', stance: 'maybe', start: 1 }] }] }).routes[0].matches).toEqual([]);
  });
});
