import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  formatPurposeTitle,
  getBadgeText,
  matchesTabSearch,
  normalizeColor,
  normalizePurpose,
  stripPurposePrefix,
  stripPurposePrefixes,
} from '../tab-purpose-extension/lib/purpose.js';

describe('tab purpose helpers', () => {
  it('normalizes purpose text for compact labels', () => {
    expect(normalizePurpose('  核對   11 月報表  ')).toBe('核對 11 月報表');
    expect(normalizePurpose('1234567890123456789012345')).toHaveLength(20);
  });

  it('adds and replaces a purpose prefix without stacking prefixes', () => {
    expect(formatPurposeTitle('待回覆', '客戶信箱')).toBe('【待回覆】 客戶信箱');
    expect(formatPurposeTitle('要核對', '【待回覆】 客戶信箱', '待回覆')).toBe(
      '【要核對】 客戶信箱',
    );
    expect(
      formatPurposeTitle(
        '要核對',
        '【待回覆】 【要核對】 【待回覆】 客戶信箱',
        '待回覆',
      ),
    ).toBe('【要核對】 客戶信箱');
    expect(stripPurposePrefix('【要核對】 客戶信箱', '要核對')).toBe('客戶信箱');
    expect(stripPurposePrefix('【公告】 客戶信箱', '要核對')).toBe('【公告】 客戶信箱');
  });

  it('removes only known extension prefixes and preserves unrelated bracketed titles', () => {
    expect(
      stripPurposePrefixes(
        '【待處理】 【要核對】 【待處理】 Example Domain',
        ['待處理', '要核對'],
      ),
    ).toBe('Example Domain');
    expect(
      stripPurposePrefixes('【待處理】 【公告】 Example Domain', ['待處理', '要核對']),
    ).toBe('【公告】 Example Domain');
  });

  it('creates a short toolbar badge for Chinese and emoji text', () => {
    expect(getBadgeText('待回覆')).toBe('待回');
    expect(getBadgeText('📌確認')).toBe('📌確');
  });

  it('falls back to a supported color', () => {
    expect(normalizeColor('teal')).toBe('teal');
    expect(normalizeColor('purple')).toBe('ocean');
  });

  it('searches title, URL, and purpose', () => {
    const tab = {
      title: '公司信箱',
      url: 'https://mail.example.com',
      purpose: '待回覆',
    };
    expect(matchesTabSearch(tab, '信箱')).toBe(true);
    expect(matchesTabSearch(tab, 'MAIL.EXAMPLE')).toBe(true);
    expect(matchesTabSearch(tab, '待回覆')).toBe(true);
    expect(matchesTabSearch(tab, '報表')).toBe(false);
  });
});

describe('extension manifest', () => {
  it('uses Manifest V3 and only the required permissions', async () => {
    const manifestPath = new URL('../tab-purpose-extension/manifest.json', import.meta.url);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage', 'tabs']);
    expect(manifest.host_permissions).toBeUndefined();
    expect(manifest.background.service_worker).toBe('background.js');
  });
});
