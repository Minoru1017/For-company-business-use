import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  REVIEWS_CHANGED_EVENT,
  emptyReview,
  formatAnalysisSummary,
  linkAnalysis,
  linkAnalysisToReview,
  linkTranscript,
  linkTranscriptToReview,
  loadReviews,
  matchReviewByVideo,
  mergeLinkFields,
  normalizeReview,
  reviewHasContent,
  reviewToText,
  reviewsToCsv,
  saveReviews,
  upsertReview,
  videoFromFile,
  videoKey,
} from '../src/demo-review.js';

const SUMMARY = { totalDur: 2520, custRatio: 0.41, sQuestions: 12, steps: 4, deepest: 3, dominant: '想要', badCount: 2, goodCount: 3 };

function withVideo(name = '涵小姐 DEMO 1011.mp4', over = {}) {
  return normalizeReview({ ...emptyReview({ customer: '涵小姐' }), video: videoFromFile({ name, size: 5e8 }, 1000), ...over });
}

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

describe('demo review video: normalize', () => {
  it('keeps only video metadata and drops empty or invalid values', () => {
    expect(normalizeReview({}).video).toBeNull();
    expect(normalizeReview({ video: { name: '  ' } }).video).toBeNull();
    const r = normalizeReview({ video: { name: 'a.mp4', size: -5, addedAt: 'x', sentAt: 5, transcribedAt: 9, blob: 'big' } });
    expect(r.video).toEqual({ name: 'a.mp4', size: 0, addedAt: 0, sentAt: 5, transcribedAt: 9 });
  });

  it('requires a history id for the analysis link and sanitizes the summary', () => {
    expect(normalizeReview({ analysis: { summary: SUMMARY } }).analysis).toBeNull();
    const r = normalizeReview({ analysis: { historyId: 'h1', at: 3, summary: { ...SUMMARY, custRatio: 'oops', dominant: 'x'.repeat(100), extra: 1 } } });
    expect(r.analysis.historyId).toBe('h1');
    expect(r.analysis.summary.custRatio).toBe(0);
    expect(r.analysis.summary.dominant).toHaveLength(40);
    expect(r.analysis.summary.extra).toBeUndefined();
  });

  it('counts a video as review content', () => {
    expect(reviewHasContent(emptyReview({ customer: '王' }))).toBe(false);
    expect(reviewHasContent(withVideo())).toBe(true);
  });
});

describe('demo review video: matching transcripts to reviews', () => {
  it('ignores extension, case, spaces and punctuation', () => {
    expect(videoKey('涵小姐 DEMO_1011.mp4')).toBe(videoKey('涵小姐-demo 1011.SRT'));
    expect(videoKey('')).toBe('');
  });

  it('matches by video name, newest first, and never matches empty names', () => {
    const a = withVideo('call.mp4', { updatedAt: 1 });
    const b = withVideo('Call.MP4', { updatedAt: 5 });
    const c = withVideo('other.mp4');
    expect(matchReviewByVideo([a, b, c], 'call.srt').id).toBe(b.id);
    expect(matchReviewByVideo([a, b, c], 'nothing.srt')).toBeNull();
    expect(matchReviewByVideo([a, b, c], '')).toBeNull();
    expect(matchReviewByVideo([emptyReview()], 'x.srt')).toBeNull();
  });

  it('records the transcript time once', () => {
    const r = withVideo('call.mp4');
    const first = linkTranscript([r], 'call.srt', 2000);
    expect(first.changed).toBe(true);
    expect(first.list[0].video.transcribedAt).toBe(2000);
    const again = linkTranscript(first.list, 'call.srt', 9000);
    expect(again.changed).toBe(false);
    expect(again.review.video.transcribedAt).toBe(2000);
    expect(linkTranscript([r], 'other.srt')).toBeNull();
  });

  it('attaches the analysis summary and fills in the transcript time', () => {
    const r = withVideo('call.mp4');
    const { review, list } = linkAnalysis([r], 'call.srt', { historyId: 'h1', summary: SUMMARY }, 3000);
    expect(review.analysis).toMatchObject({ historyId: 'h1', at: 3000 });
    expect(review.video.transcribedAt).toBe(3000);
    expect(list).toHaveLength(1);
    expect(linkAnalysis([r], 'call.srt', { summary: SUMMARY })).toBeNull();
    expect(linkAnalysis([r], 'zzz.srt', { historyId: 'h1' })).toBeNull();
  });
});

describe('demo review video: storage helpers used by app.js', () => {
  it('persists the link and notifies listeners', () => {
    const { list } = upsertReview([], withVideo('call.mp4'));
    saveReviews(list);
    const seen = vi.fn();
    vi.stubGlobal('window', { dispatchEvent: seen });
    expect(linkTranscriptToReview('call.srt').video.transcribedAt).toBeGreaterThan(0);
    expect(linkTranscriptToReview('call.srt')).toBeNull();
    expect(linkAnalysisToReview('call.srt', { historyId: 'h9', summary: SUMMARY }).analysis.historyId).toBe('h9');
    expect(loadReviews()[0].analysis.historyId).toBe('h9');
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.calls[0][0].type).toBe(REVIEWS_CHANGED_EVENT);
    expect(linkAnalysisToReview('nope.srt', { historyId: 'x' })).toBeNull();
  });

  it('does not throw on corrupted storage', () => {
    localStorage.setItem('call_coach_demo_reviews_v1', '{bad');
    expect(linkAnalysisToReview('call.srt', { historyId: 'x' })).toBeNull();
  });

  it('merges link fields without losing unsaved edits', () => {
    const base = withVideo('call.mp4', { updatedAt: 10 });
    const edited = { ...base, improve: '還沒存檔的修改', updatedAt: 11 };
    const fresh = { ...base, analysis: { historyId: 'h1', at: 5, summary: SUMMARY }, updatedAt: 12 };
    const extra = withVideo('x.mp4', { updatedAt: 1 });
    const merged = mergeLinkFields([edited], [normalizeReview(fresh), extra]);
    expect(merged).toHaveLength(2);
    expect(merged[0].improve).toBe('還沒存檔的修改');
    expect(merged[0].analysis.historyId).toBe('h1');
    expect(merged[0].updatedAt).toBe(12);
  });
});

describe('demo review video: output', () => {
  const analyzed = withVideo('call.mp4', { analysis: { historyId: 'h1', at: 1, summary: SUMMARY } });

  it('formats the analysis summary', () => {
    const t = formatAnalysisSummary(SUMMARY);
    expect(t).toContain('通話 42 分');
    expect(t).toContain('客戶說話 41%');
    expect(t).toContain('顧問提問 12 題');
    expect(t).toContain('L3');
    expect(t).toContain('想要');
    expect(formatAnalysisSummary(null)).toBe('');
  });

  it('adds the video and analysis to CSV and text', () => {
    const csv = reviewsToCsv([analyzed]);
    expect(csv).toContain('"DEMO 錄影"');
    expect(csv).toContain('"call.mp4"');
    expect(csv).toContain('客戶說話 41%');
    expect(reviewToText(analyzed)).toContain('錄影分析：');
    expect(reviewToText(withVideo())).not.toContain('錄影分析：');
  });
});
