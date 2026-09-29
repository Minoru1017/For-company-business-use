import { beforeEach, describe, expect, it, vi } from 'vitest';

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    clear: () => m.clear(),
  };
}

let cd;
let se;

beforeEach(async () => {
  globalThis.localStorage = memoryStorage();
  vi.resetModules();
  cd = await import('../src/coach-directives.js');
  se = await import('../src/symptom-engine.js');
});

const POINTS = [
  { text: '每天至少 30 通', category: 'kpi', action: '上午先打 15 通' },
  { text: '開場先問「最近在忙什麼」', category: 'script' },
  { text: '', category: 'value' },
];

describe('coach-directives: store', () => {
  it('applies confirmed points as directives, skipping empty text', () => {
    const fresh = cd.applyMeetingDirectives({ meetingId: 'm1', meetingTitle: '9/29 早會', date: '2026-09-29', points: POINTS });
    expect(fresh).toHaveLength(2);
    const list = cd.listDirectives();
    expect(list.map((d) => d.text)).toEqual(['每天至少 30 通', '開場先問「最近在忙什麼」']);
    expect(list[0]).toMatchObject({ meetingId: 'm1', meetingTitle: '9/29 早會', date: '2026-09-29', category: 'kpi', action: '上午先打 15 通', archived: false });
  });

  it('re-applying the same meeting replaces its previous directives, other meetings kept', () => {
    cd.applyMeetingDirectives({ meetingId: 'm1', points: [{ text: '舊的' }] });
    cd.applyMeetingDirectives({ meetingId: 'm2', points: [{ text: '別場的' }] });
    cd.applyMeetingDirectives({ meetingId: 'm1', points: [{ text: '新的' }] });
    const texts = cd.listDirectives().map((d) => d.text);
    expect(texts).toContain('新的');
    expect(texts).toContain('別場的');
    expect(texts).not.toContain('舊的');
  });

  it('archive hides from default list / prompt but keeps in includeArchived', () => {
    cd.applyMeetingDirectives({ meetingId: 'm1', points: [{ text: '甲' }, { text: '乙' }] });
    const id = cd.listDirectives().find((d) => d.text === '甲').id;
    expect(cd.archiveDirective(id, true)).toBe(true);
    expect(cd.listDirectives().map((d) => d.text)).toEqual(['乙']);
    expect(cd.listDirectives({ includeArchived: true })).toHaveLength(2);
    expect(cd.buildDirectivesPromptAddendum()).not.toContain('甲');
    cd.archiveDirective(id, false);
    expect(cd.listDirectives()).toHaveLength(2);
    expect(cd.archiveDirective('nope')).toBe(false);
  });

  it('remove and clear', () => {
    cd.applyMeetingDirectives({ meetingId: 'm1', points: [{ text: '甲' }, { text: '乙' }] });
    cd.removeDirective(cd.listDirectives()[0].id);
    expect(cd.listDirectives()).toHaveLength(1);
    cd.clearDirectives();
    expect(cd.listDirectives()).toEqual([]);
  });

  it('unknown category falls back to process', () => {
    cd.applyMeetingDirectives({ meetingId: 'm1', points: [{ text: 'x', category: 'zzz' }] });
    expect(cd.listDirectives()[0].category).toBe('process');
  });
});

describe('coach-directives: prompt addendum', () => {
  it('is empty when nothing applied and prompt is unchanged', () => {
    expect(cd.buildDirectivesPromptAddendum()).toBe('');
    expect(cd.appendDirectivesToPrompt('BASE')).toBe('BASE');
  });

  it('lists directives with category label, date and action', () => {
    cd.applyMeetingDirectives({ meetingId: 'm1', date: '2026-09-29', points: POINTS });
    const add = cd.buildDirectivesPromptAddendum();
    expect(add).toContain('[主管近期方向（早會紀錄，業務已確認）]');
    expect(add).toContain('- [指標](2026-09-29) 每天至少 30 通｜做法：上午先打 15 通');
    expect(add).toContain('- [話術](2026-09-29) 開場先問「最近在忙什麼」');
    expect(cd.appendDirectivesToPrompt('BASE')).toBe('BASE' + add);
  });

  it('caps the number of lines by max', () => {
    cd.applyMeetingDirectives({ meetingId: 'm1', points: Array.from({ length: 12 }, (_, i) => ({ text: `第${i}點` })) });
    const lines = cd.buildDirectivesPromptAddendum(3).split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(3);
  });

  it('flows into the symptom diagnosis prompt', () => {
    cd.applyMeetingDirectives({ meetingId: 'm1', points: [{ text: '先挖困擾再談方案', category: 'process' }] });
    const agg = { total: 2, metrics: {}, symptoms: [] };
    const withDir = se.buildDiagnosisPrompt(agg, { directives: cd.buildDirectivesPromptAddendum() });
    const without = se.buildDiagnosisPrompt(agg, {});
    expect(withDir).toContain('先挖困擾再談方案');
    expect(without).not.toContain('主管近期方向');
  });
});

describe('coach-directives: html', () => {
  it('renders nothing without directives, escapes text otherwise', () => {
    expect(cd.renderDirectivesHtml()).toBe('');
    cd.applyMeetingDirectives({ meetingId: 'm1', meetingTitle: '<b>早會</b>', date: '2026-09-29', points: [{ text: '<script>x</script>', category: 'remind', action: 'act' }] });
    const html = cd.renderDirectivesHtml();
    expect(html).toContain('coach-directives');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;b&gt;早會&lt;/b&gt;');
    expect(html).toContain('coach-directive-act');
    expect(cd.renderDirectivesHtml({ compact: true })).not.toContain('coach-directive-act');
  });
});
