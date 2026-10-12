import { describe, expect, it } from 'vitest';
import { emptyReview, normalizeReview } from '../src/demo-review.js';
import { reviewCardFileName, reviewCardModel } from '../src/demo-review-card.js';

const NOW = new Date(2026, 9, 12, 9, 30).getTime();

function rev(over = {}) {
  return normalizeReview({ ...emptyReview({ customer: '涵小姐', demoAt: '1006 20:30' }), ...over });
}

describe('demo review card model', () => {
  it('builds header, kpis, next step and only the filled sections', () => {
    const m = reviewCardModel(
      rev({
        outcome: 'next',
        tier: 'want',
        fit: 'B',
        nextStep: '週三 1:1 諮詢',
        followUpDate: '2026-10-15',
        reaction: '看到自動排程那頁眼睛一亮',
        improve: '示範前先問他最花時間的事',
        note: '這段不該上圖卡',
      }),
      NOW
    );
    expect(m.customer).toBe('涵小姐');
    expect(m.demoAt).toBe('1006 20:30');
    expect(m.outcome).toEqual({ label: '約好下一步', tone: 'ok', set: true });
    expect(m.kpis.map((k) => k.value)).toEqual(['要什麼', 'B', '2026-10-15']);
    expect(m.kpis.every((k) => !k.empty)).toBe(true);
    expect(m.nextStep).toBe('週三 1:1 諮詢');
    expect(m.sections.map((s) => s.label)).toEqual(['客戶最有反應的地方', '下次要改的一件事']);
    expect(JSON.stringify(m)).not.toContain('這段不該上圖卡');
    expect(m.analysis).toBe('');
    expect(m.stamp).toBe('2026-10-12');
  });

  it('falls back gracefully on an almost-empty review', () => {
    const m = reviewCardModel(rev({ customer: '', demoAt: '' }), NOW);
    expect(m.customer).toBe('未命名客戶');
    expect(m.outcome).toEqual({ label: '未填結果', tone: 'muted', set: false });
    expect(m.kpis.map((k) => k.value)).toEqual(['還沒判斷', '—', '未排']);
    expect(m.kpis.every((k) => k.empty)).toBe(true);
    expect(m.sections).toEqual([]);
  });

  it('includes the recording analysis summary when linked', () => {
    const m = reviewCardModel(
      rev({ analysis: { historyId: 'h1', at: NOW, summary: { totalDur: 1500, custRatio: 0.52, sQuestions: 9, deepest: 3, dominant: '怕什麼' } } }),
      NOW
    );
    expect(m.analysis).toContain('通話 25 分');
    expect(m.analysis).toContain('客戶偏向「怕什麼」');
  });

  it('names the png after the customer without unsafe characters', () => {
    expect(reviewCardFileName(rev({ customer: '王/先生 A:B' }), '2026-10-12')).toBe('DEMO複盤_王_先生_A_B_2026-10-12.png');
    expect(reviewCardFileName(rev({ customer: '' }), '2026-10-12')).toBe('DEMO複盤_未命名客戶_2026-10-12.png');
  });
});
