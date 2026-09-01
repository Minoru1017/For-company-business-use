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
});
