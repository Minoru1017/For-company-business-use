import { describe, expect, it } from 'vitest';
import { buildLayerHits, evaluateManualRules, sharesDiscoveryTerms } from '../src/manual-check.js';
import { enrichSegments } from '../src/parser.js';

describe('manual-check', () => {
  it('detects layers from customer speech', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '您好，請問方便聊嗎？', spk: 'S' },
      { start: 5, end: 10, text: '可以，我最近想學 AI', spk: 'C' },
      { start: 10, end: 15, text: '你現在大概是什麼狀況？', spk: 'S' },
      { start: 15, end: 20, text: '工作很忙，加班壓力很大', spk: 'C' },
      { start: 20, end: 25, text: '如果一直這樣，對你影響最大的是什麼？', spk: 'S' },
      { start: 25, end: 30, text: '影響就是浪費很多時間', spk: 'C' },
    ]);
    const layerHits = buildLayerHits(segs);
    expect(layerHits[0].hit).toBeTruthy();
    expect(layerHits[2].hit).toBeTruthy();
  });

  it('evaluates discovery and amplification verdicts', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '您好，請問方便聊嗎？', spk: 'S' },
      { start: 5, end: 10, text: '可以，我最近想學 AI', spk: 'C' },
      { start: 10, end: 15, text: '你現在大概是什麼狀況？', spk: 'S' },
      { start: 15, end: 20, text: '工作很忙，最困擾是報表', spk: 'C' },
      { start: 20, end: 25, text: '如果一直這樣，對你影響最大的是什麼？', spk: 'S' },
      { start: 25, end: 30, text: '浪費很多時間在報表', spk: 'C' },
      { start: 30, end: 35, text: '為什麼這件事現在對你這麼重要？', spk: 'S' },
      { start: 35, end: 40, text: '因為現在壓力很大想改變', spk: 'C' },
      { start: 40, end: 45, text: '如果真的解決了，你最希望變成什麼樣子？', spk: 'S' },
      { start: 45, end: 50, text: '希望準時下班還被主管肯定', spk: 'C' },
      { start: 50, end: 55, text: '所以你真正想解決的是報表重工，因為浪費時間；你真正需要的是準時下班，我理解對嗎？', spk: 'S' },
      { start: 55, end: 60, text: '對', spk: 'C' },
      { start: 60, end: 65, text: '沒有把報表流程改掉，每週就會繼續浪費時間加班', spk: 'S' },
    ]);
    const layerHits = buildLayerHits(segs);
    const convergeSeg = segs.find((s) => s.text.includes('我理解對嗎'));
    const sQuestions = segs.filter((s) => s.spk === 'S' && /[?？]/.test(s.text));
    const checks = evaluateManualRules(segs, { layerHits, convergeSeg, sQuestions });
    expect(checks.discovery.status).toBe('pass');
    expect(checks.amplification.criteria.find((c) => c.key === 'pattern').pass).toBe(true);
    expect(checks.amplification.criteria.find((c) => c.key === 'link').pass).toBe(true);
  });

  it('flags fear-mongering in amplification', () => {
    const segs = enrichSegments([
      { start: 0, end: 5, text: '你再不改就完蛋了', spk: 'S' },
      { start: 5, end: 10, text: '嗯', spk: 'C' },
    ]);
    const checks = evaluateManualRules(segs, { layerHits: buildLayerHits(segs), convergeSeg: null, sQuestions: [] });
    expect(checks.amplification.criteria.find((c) => c.key === 'nofear').pass).toBe(false);
    expect(checks.amplification.status).toBe('fail');
  });

  it('sharesDiscoveryTerms matches overlapping customer words', () => {
    expect(sharesDiscoveryTerms(['浪費很多時間在報表'], '沒有把報表流程改掉，每週就會繼續浪費時間加班')).toBe(true);
    expect(sharesDiscoveryTerms(['想學 AI'], '我們的課程很好')).toBe(false);
  });
});
