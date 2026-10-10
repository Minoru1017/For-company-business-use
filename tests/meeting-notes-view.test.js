import { describe, expect, it } from 'vitest';
import { dateKeyOf, directivesHtml, historyHtml, linesHtml, meetingNotesTemplate, pointsHtml } from '../src/meeting-notes-view.js';

describe('meeting notes view', () => {
  it('formats a timestamp as a local date key', () => {
    expect(dateKeyOf(new Date(2026, 9, 3, 8, 30).getTime())).toBe('2026-10-03');
  });

  it('renders the panel skeleton with every element the UI binds to', () => {
    const html = meetingNotesTemplate();
    for (const id of ['bfStatus', 'bfToggle', 'bfMicDevice', 'bfAudioPreset', 'bfLevelFill', 'bfText', 'bfPointList', 'bfDirList', 'bfHistList']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('renders transcript lines with clock and escaped text', () => {
    const html = linesHtml([{ t: 65, text: '<b>每通先問預算</b>' }]);
    expect(html).toContain('01:05');
    expect(html).toContain('&lt;b&gt;每通先問預算&lt;/b&gt;');
    expect(linesHtml(null)).toBe('');
  });

  it('renders points with category select, source label and empty state', () => {
    const html = pointsHtml([
      { id: 'p1', category: 'kpi', text: '每天 80 通', action: '', source: 'ai', selected: true },
      { id: 'p2', category: 'script', text: '開場', source: 'rule', selected: false },
    ]);
    expect(html.match(/class="brief-point /g)).toHaveLength(2);
    expect(html).toContain('<option value="kpi" selected>指標</option>');
    expect(html).toContain('>AI</span>');
    expect(html).toContain('>規則</span>');
    expect(html).toMatch(/brief-point on" data-id="p1"/);
    expect(pointsHtml([])).toContain('尚無重點');
  });

  it('renders directives with archive toggle', () => {
    const html = directivesHtml([
      { id: 'd1', category: 'process', text: '先問再推', action: '第 3 題前不提方案', date: '2026-10-09', meetingTitle: '週五早會' },
      { id: 'd2', category: 'remind', text: '舊的', archived: true },
    ]);
    expect(html).toContain('做法：第 3 題前不提方案');
    expect(html).toContain('2026-10-09 · 週五早會');
    expect(html).toContain('data-archive="1">封存');
    expect(html).toContain('data-archive="0">恢復');
    expect(html).toContain('已封存');
    expect(directivesHtml([])).toContain('尚未套用任何方向');
  });

  it('renders history with duration and current marker', () => {
    const start = new Date(2026, 9, 9, 9, 0).getTime();
    const html = historyHtml(
      [
        { id: 'm1', title: '週五早會', startedAt: start, endedAt: start + 25 * 60000, lines: [1, 2], points: [1], applied: true },
        { id: 'm2', title: '週四', startedAt: start - 86400000 },
      ],
      'm1'
    );
    expect(html).toContain('brief-hist current" data-id="m1"');
    expect(html).toContain('2026-10-09 · 25 分 · 2 段 · 1 點 · <b>已套用</b>');
    expect(html).toContain('2026-10-08 · 0 段 · 0 點');
    expect(historyHtml([])).toContain('還沒有紀錄');
  });
});
