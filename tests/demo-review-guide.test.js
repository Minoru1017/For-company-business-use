import { describe, expect, it } from 'vitest';
import {
  buildDecisionPrompt,
  buildDemoGuidePrompt,
  guideStats,
  guideToText,
  normalizeDemoGuide,
  parseDecisionResponse,
  parseDemoGuideResponse,
  patchGuideRoute,
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
});
