import { describe, expect, it } from 'vitest';
import { escapeHTML, safeHTML } from '../src/utils.js';

describe('utils XSS helpers', () => {
  it('escapes HTML entities', () => {
    expect(escapeHTML('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
  });

  it('allows trusted span.q tags via safeHTML', () => {
    const html = safeHTML('建議<span class="q">「你好」</span>');
    expect(html).toContain('<span class="q">');
    expect(html).not.toContain('&lt;span class=&quot;q&quot;&gt;');
  });

  it('report list rows keep li tags outside safeHTML', () => {
    const item = safeHTML('<b>重點</b>與<span class="q">「話術」</span>');
    const row = `<li>${item}</li>`;
    expect(row).toContain('<li>');
    expect(row).not.toContain('&lt;li&gt;');
    expect(row).toContain('<b>重點</b>');
  });
});
