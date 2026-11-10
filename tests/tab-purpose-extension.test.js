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
import { normalizeAccount } from '../tab-purpose-extension/lib/google-account.js';
import { buildLogoUrl, enrichPageWithLogo, resolveSlotLogo } from '../tab-purpose-extension/lib/logo.js';
import {
  EMBED_ALLOW_RULE_ID,
  buildEmbedAllowRules,
} from '../tab-purpose-extension/lib/embed-allow.js';
import {
  assignOpenTarget,
  clampSplitRatio,
  closeViewerPane,
  createViewerState,
  pageFromSlot,
  ratioFromPointer,
  setViewerMode,
} from '../tab-purpose-extension/lib/viewer.js';
import {
  SLOT_COUNT,
  addPageToFirstEmptySlot,
  createHomepageArea,
  getAreaWorkspace,
  getRoutinePlan,
  getRoutineSlots,
  getWorkspaceGroups,
  moveSlot,
  normalizeHomepage,
  normalizeWebUrl,
  normalizeWorkspace,
  updateAreaWorkspace,
} from '../tab-purpose-extension/lib/workspace.js';

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

describe('work homepage helpers', () => {
  it('always creates exactly 16 normalized slots', () => {
    const workspace = normalizeWorkspace({
      slots: [{ url: 'example.com', title: ' 範例網站 ' }],
    });
    expect(workspace.slots).toHaveLength(SLOT_COUNT);
    expect(workspace.slots[0]).toMatchObject({
      url: 'https://example.com/',
      title: '範例網站',
    });
    expect(workspace.slots[15].url).toBe('');
  });

  it('accepts only web URLs', () => {
    expect(normalizeWebUrl('portal.company.com')).toBe('https://portal.company.com/');
    expect(normalizeWebUrl('http://localhost:5173')).toBe('http://localhost:5173/');
    expect(normalizeWebUrl('chrome://extensions')).toBe('');
    expect(normalizeWebUrl('javascript:alert(1)')).toBe('');
  });

  it('adds a page to the first empty slot and reports a full homepage', () => {
    const initial = normalizeWorkspace({
      slots: [{ url: 'https://first.example', title: '第一個' }],
    });
    const result = addPageToFirstEmptySlot(initial, {
      url: 'https://second.example',
      title: '第二個',
    });
    expect(result.index).toBe(1);
    expect(result.workspace.slots[1].title).toBe('第二個');

    const full = normalizeWorkspace({
      slots: Array.from({ length: SLOT_COUNT }, (_, index) => ({
        url: `https://example.com/${index}`,
        title: String(index),
      })),
    });
    expect(addPageToFirstEmptySlot(full, { url: 'https://overflow.example' }).index).toBe(-1);
  });

  it('moves slots while keeping a fixed 16-slot workspace', () => {
    const initial = normalizeWorkspace({
      slots: [
        { url: 'https://first.example', title: '第一個' },
        { url: 'https://second.example', title: '第二個' },
      ],
    });
    const moved = moveSlot(initial, 0, 1);
    expect(moved.slots).toHaveLength(SLOT_COUNT);
    expect(moved.slots[0].title).toBe('第二個');
    expect(moved.slots[1].title).toBe('第一個');

    const movedBack = moveSlot(moved, 1, 0);
    expect(movedBack.slots).toHaveLength(SLOT_COUNT);
    expect(movedBack.slots.slice(0, 2).map((slot) => slot.title)).toEqual([
      '第一個',
      '第二個',
    ]);
  });

  it('groups sites and sorts routines by step then slot position', () => {
    const workspace = normalizeWorkspace({
      slots: [
        {
          url: 'https://mail.example',
          title: '信箱',
          group: '行政',
          routine: '每日開工',
          step: 2,
        },
        {
          url: 'https://calendar.example',
          title: '行事曆',
          group: '行政',
          routine: '每日開工',
          step: 1,
        },
        { url: 'https://wiki.example', title: '知識庫', group: '參考' },
      ],
    });
    expect(getWorkspaceGroups(workspace)).toEqual(['行政', '參考']);
    expect(getRoutineSlots(workspace, '每日開工').map((slot) => slot.title)).toEqual([
      '行事曆',
      '信箱',
    ]);
    const plan = getRoutinePlan(workspace, '每日開工');
    expect(plan.slots.map((slot) => slot.title)).toEqual(['行事曆', '信箱']);
    expect(plan.summary).toBe('將依序開啟 2 個網站：行事曆 → 信箱');
  });

  it('migrates the previous 16-slot homepage into the work area', () => {
    const homepage = normalizeHomepage({
      slots: [{ url: 'https://legacy.example', title: '舊首頁網站' }],
    });
    expect(homepage.version).toBe(2);
    expect(homepage.areas.map((area) => area.name)).toEqual(['工作', '興趣', '影視']);
    expect(getAreaWorkspace(homepage, 'work').slots[0].title).toBe('舊首頁網站');
    expect(getAreaWorkspace(homepage, 'interest').slots[0].url).toBe('');
  });

  it('keeps 16 slots isolated for each main area', () => {
    let homepage = normalizeHomepage();
    const interest = normalizeWorkspace({
      slots: [{ url: 'https://hobby.example', title: '興趣網站' }],
    });
    homepage = updateAreaWorkspace(homepage, 'interest', interest);
    expect(getAreaWorkspace(homepage, 'interest').slots[0].title).toBe('興趣網站');
    expect(getAreaWorkspace(homepage, 'work').slots[0].url).toBe('');
  });

  it('creates a custom area with its own empty slots', () => {
    const homepage = createHomepageArea(normalizeHomepage(), '旅遊');
    const custom = homepage.areas.find((area) => area.name === '旅遊');
    expect(custom).toBeTruthy();
    expect(custom.slots).toHaveLength(SLOT_COUNT);
    expect(custom.slots.every((slot) => !slot.url)).toBe(true);
    expect(homepage.activeAreaId).toBe(custom.id);
  });
});


describe('slot logo helpers', () => {
  it('builds and resolves enlarged logo URLs for empty-slot imports', () => {
    expect(buildLogoUrl('https://www.youtube.com/watch?v=1', 128)).toContain(
      'youtube.com',
    );
    expect(buildLogoUrl('https://www.youtube.com/watch?v=1', 128)).toContain('sz=128');
    expect(resolveSlotLogo({ url: 'https://example.com', favicon: '' })).toContain(
      'example.com',
    );
    expect(
      enrichPageWithLogo({ url: 'https://calendar.google.com', title: '行事曆' }).favicon,
    ).toContain('calendar.google.com');
  });
});

describe('google account helpers', () => {
  it('normalizes signed-in and signed-out account states', () => {
    expect(normalizeAccount()).toMatchObject({ signedIn: false, email: '' });
    expect(normalizeAccount({ email: 'user@gmail.com', id: '123' })).toMatchObject({
      signedIn: true,
      email: 'user@gmail.com',
      id: '123',
    });
  });
});

describe('embedded viewer helpers', () => {
  it('opens the first slot in a single floating pane', () => {
    const first = assignOpenTarget(
      createViewerState(),
      pageFromSlot({ title: 'YouTube', url: 'https://youtube.com' }),
    );
    expect(first).toMatchObject({
      open: true,
      mode: 'single',
      left: { title: 'YouTube', url: 'https://youtube.com' },
      right: null,
    });
  });

  it('puts the next slot on the right and supports split resize clamping', () => {
    const first = assignOpenTarget(
      createViewerState(),
      pageFromSlot({ title: '左', url: 'https://left.example' }),
    );
    const split = assignOpenTarget(
      first,
      pageFromSlot({ title: '右', url: 'https://right.example' }),
    );
    expect(split.mode).toBe('split');
    expect(split.right.title).toBe('右');
    expect(clampSplitRatio(0.05)).toBe(0.24);
    expect(clampSplitRatio(0.95)).toBe(0.76);
    expect(ratioFromPointer(250, { left: 0, width: 1000 })).toBe(0.25);
    expect(setViewerMode(split, 'single').right).toBeNull();
    expect(closeViewerPane(split, 'left').left.title).toBe('右');
  });
});

describe('embed allow rules', () => {
  it('builds a sub_frame header-removal rule scoped to this extension', () => {
    const rules = buildEmbedAllowRules('abcdefghijklmnop');
    expect(rules).toHaveLength(1);
    expect(rules[0].id).toBe(EMBED_ALLOW_RULE_ID);
    expect(rules[0].condition).toMatchObject({
      resourceTypes: ['sub_frame'],
      initiatorDomains: ['abcdefghijklmnop'],
    });
    expect(rules[0].action.responseHeaders.map((item) => item.header)).toEqual([
      'x-frame-options',
      'content-security-policy',
      'content-security-policy-report-only',
    ]);
    expect(buildEmbedAllowRules('')).toEqual([]);
  });
});

describe('extension manifest', () => {
  it('uses Manifest V3 and only the required permissions', async () => {
    const manifestPath = new URL('../tab-purpose-extension/manifest.json', import.meta.url);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe('1.4.1');
    expect(manifest.permissions).toEqual([
      'activeTab',
      'declarativeNetRequest',
      'identity',
      'identity.email',
      'scripting',
      'storage',
      'tabs',
    ]);
    expect(manifest.host_permissions).toEqual(['http://*/*', 'https://*/*']);
    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.chrome_url_overrides.newtab).toBe('dashboard/dashboard.html');
  });
});
