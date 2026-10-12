import { describe, expect, it } from 'vitest';
import {
  buildConsultPrompt,
  consultToText,
  normalizeConsult,
  parseConsultResponse,
} from '../src/demo-review-consult.js';

const RAW = {
  diagnosis: {
    current: '每週手動整理報表',
    goal: '縮短整理時間',
    bottleneck: '資料散落',
    cost: '每週四小時',
    decision: '主管要看到成果',
    fit: 'B 部分適合：需先整理資料',
    recommendation: '先做一份週報 MVP',
    confidence: '中：缺少資料格式',
  },
  evidence: [
    { claim: '每週花四小時', source: '客戶說「每週至少四小時」', status: 'confirmed' },
    { claim: '主管是決策人', source: '', status: 'inferred' },
  ],
  gaps: [{ topic: '資料格式', why: '影響自動化方式', question: '目前資料放在哪裡？', priority: 'high' }],
  implementation: {
    user: '行政本人',
    workflow: '整理 Excel 後寫週報',
    input: 'Excel',
    output: '週報初稿',
    acceptance: '30 分鐘完成且數字經人工核對',
    review: '核對數字',
    risk: '格式不一致',
  },
  next: {
    action: '收一份去識別化 Excel',
    owner: '寄資料清單',
    counterpart: '提供樣本',
    date: '2026-10-15',
    condition: '完成 MVP 範圍確認',
    message: '方便先提供一份去識別化樣本嗎？',
  },
};

describe('DEMO consult P0', () => {
  it('normalizes bounded structured output and rejects invalid enums/date', () => {
    const c = normalizeConsult({
      ...RAW,
      evidence: [...RAW.evidence, { claim: 'x', source: 'y', status: 'certain' }],
      gaps: [{ ...RAW.gaps[0], priority: 'urgent' }],
      next: { ...RAW.next, date: '10/15' },
    });
    expect(c.evidence[2].status).toBe('inferred');
    expect(c.gaps[0].priority).toBe('medium');
    expect(c.next.date).toBe('');
  });

  it('parses fenced or surrounded JSON', () => {
    const parsed = parseConsultResponse(`結果如下：\n${JSON.stringify(RAW)}\n謝謝`);
    expect(parsed.diagnosis.fit).toContain('B 部分適合');
    expect(parsed.gaps[0].question).toBe('目前資料放在哪裡？');
    expect(parsed.implementation.acceptance).toContain('30 分鐘');
  });

  it('builds a grounded prompt from review and deck data', () => {
    const prompt = buildConsultPrompt({
      today: '2026-10-12',
      deckInput: { name: '王先生', goals: '週報自動化', raw: '現在每週整理四小時' },
      courseNotes: '提供工作坊與作業回饋',
      review: {
        customer: '王先生',
        outcome: 'thinking',
        tier: 'want',
        fit: 'B',
        reaction: '看到報表示範主動追問',
        objections: '擔心資料外流',
        analysis: { summary: { totalDur: 1200, custRatio: 0.51, sQuestions: 8, deepest: 3, dominant: '要什麼' } },
      },
    });
    expect(prompt).toContain('不能把推測寫成事實');
    expect(prompt).toContain('目標：週報自動化');
    expect(prompt).toContain('客戶疑慮與業務回應：擔心資料外流');
    expect(prompt).toContain('客戶說話 51%');
    expect(prompt).toContain('提供工作坊與作業回饋');
    expect(prompt).not.toContain('undefined');
  });

  it('formats all four cards as shareable text', () => {
    const text = consultToText(RAW);
    expect(text).toContain('【顧問診斷】');
    expect(text).toContain('【下次必問】');
    expect(text).toContain('【AI 落地定義】');
    expect(text).toContain('【具體下一步】');
    expect(text).toContain('可驗收標準');
    expect(text).toContain('方便先提供一份去識別化樣本嗎？');
  });
});
