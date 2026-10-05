import { afterEach, describe, expect, it } from 'vitest';
import PptxGenJS from 'pptxgenjs';
import {
  DECKS_STORAGE_KEY,
  DECK_STYLES,
  buildDeckPrompt,
  deckFileName,
  hasCustomerInput,
  imageIdsInDecks,
  invitedReflectionEntries,
  loadDecks,
  moveSlide,
  newDeckRecord,
  normalizeDeck,
  normalizeSlide,
  parseDeckResponse,
  saveDecks,
  sectionNumbers,
  setByPath,
  slideNumbers,
  templateDeck,
} from '../src/demo-deck.js';
import { renderDeckSlides, renderSlideHtml } from '../src/demo-deck-slides.js';
import { buildDeckPptx } from '../src/demo-deck-pptx.js';

const liu = {
  name: '劉○○',
  demoAt: '1006 2030',
  background: '自由業，Uber 外送員、兼職跑物流',
  product: 'AI 未來學院初階計畫',
  goals: '想要透過 AI 跟自媒體能力做 BGM cover 內容，表達自己想傳達的東西\n希望未來能創造更自由的工作生活',
  traits: '好聊天',
  story: '這個想法想了五年還沒開始。AI、自媒體、音樂全部都是新手',
  concerns: '學不會怎麼辦？\n要花多少時間？',
  availability: '',
  raw: '',
};

const aiJson = {
  title: '劉○○的 BGM Cover 之路',
  customer: '劉○○',
  slides: [
    { type: 'cover', title: '劉○○的 BGM Cover 之路', subtitle: '先弄清楚方向', meta: '10/06 DEMO', why: '封面' },
    { type: 'section', kicker: '第一部分', title: '為什麼現在開始' },
    { type: 'quote', kicker: '你說過的話', title: '你在電話裡說', quotes: ['想做 BGM cover', { text: '想更自由', who: '開發通話' }], confirm: '我理解對嗎？' },
    { type: 'cards', kicker: '節奏', title: '三件事', cards: [{ label: '第一', title: 'A', text: 'a' }, { title: '', text: '' }, { title: 'C' }], banner: '先有作品' },
    { type: 'grid', kicker: '方向', title: '方向', items: [{ title: 'AI 音樂', tags: 'x', flow: 'a → b' }, { title: '剪輯', muted: 1 }] },
    { type: 'flow', kicker: '作品 一', title: '第一支 cover', chips: ['選歌', '編曲', '錄音', '剪輯', '發布', '多的'], steps: ['選歌', 'AI 編曲', '發布'], gain: '節奏感', map: '自媒體' },
    { type: 'plan', kicker: '第 1 個月 ｜ 起步', title: '先做一支', focus: ['工具'], goal: '一支作品', also: '開頻道' },
    { type: 'qa', kicker: '你在意的問題', title: '問題', items: [{ q: '學不會？', a: '從第一步開始' }, { q: '' }] },
    { type: 'weird', title: '未知類型變成卡片' },
    { type: 'closing', title: '下一步', confirm: '對嗎？', steps: ['開始時間', '第一週', '回顧', '多', '超過'] },
  ],
};

describe('normalize / parse', () => {
  it('normalizes every slide type and enforces limits', () => {
    const deck = normalizeDeck(aiJson);
    expect(deck.slides.map((s) => s.type)).toEqual(['cover', 'section', 'quote', 'cards', 'grid', 'flow', 'plan', 'qa', 'cards', 'closing']);
    const [, , quote, cards, grid, flow, , qa, , closing] = deck.slides;
    expect(quote.quotes).toEqual([{ text: '想做 BGM cover', who: '' }, { text: '想更自由', who: '開發通話' }]);
    expect(cards.cards).toHaveLength(2);
    expect(grid.items[1].muted).toBe(true);
    expect(flow.chips).toHaveLength(5);
    expect(flow.chipsLabel).toBe('常見情況');
    expect(qa.items).toHaveLength(1);
    expect(closing.steps).toHaveLength(4);
    expect(deck.slides.every((s) => s.id)).toBe(true);
  });

  it('parses fenced AI output and rejects empty or broken JSON', () => {
    expect(parseDeckResponse(`\`\`\`json\n${JSON.stringify(aiJson)}\n\`\`\``).slides).toHaveLength(10);
    expect(() => parseDeckResponse('{"slides":[]}')).toThrow(/沒有任何頁面/);
    expect(() => parseDeckResponse('{"slides":[{"type":"cards"')).toThrow(/不是完整 JSON/);
  });

  it('numbers only content slides', () => {
    expect(slideNumbers(normalizeDeck(aiJson).slides)).toEqual([0, 0, 1, 2, 3, 0, 0, 4, 5, 0]);
  });
});

describe('prompt', () => {
  it('includes customer facts, course notes and the guardrails', () => {
    const p = buildDeckPrompt(liu, { courseNotes: '初階計畫 12 週' });
    expect(p).toContain('BGM cover');
    expect(p).toContain('學員特質／個性：好聊天');
    expect(p).toContain('學習時間／裝置：（未填）');
    expect(p).toContain('初階計畫 12 週');
    expect(p).toContain('不承諾收入');
    expect(p).toContain('不貶低客戶');
    expect(p).toContain('"type":"closing"');
  });

  it('warns the AI not to invent course details when none are given', () => {
    expect(buildDeckPrompt(liu)).toContain('不可編造課名');
  });
});

describe('templateDeck', () => {
  it('builds the senior-colleague skeleton from the filled fields', () => {
    expect(hasCustomerInput(liu)).toBe(true);
    expect(hasCustomerInput({})).toBe(false);
    const d = templateDeck(liu);
    expect(d.title).toBe('劉○○的 AI 學習藍圖');
    expect(d.slides[0]).toMatchObject({ type: 'cover', meta: '1006 2030 ・ AI 未來學院初階計畫' });
    const quote = d.slides.find((s) => s.type === 'quote');
    expect(quote.quotes[0].text).toContain('BGM cover');
    expect(quote.confirm).toContain('我理解對嗎');
    const qa = d.slides.find((s) => s.type === 'qa');
    expect(qa.items.map((x) => x.q)).toEqual(['學不會怎麼辦', '要花多少時間']);
    expect(d.slides.at(-1).type).toBe('closing');
    expect(JSON.stringify(d)).toContain('【待補】');
  });
});

describe('reflection import & editing helpers', () => {
  it('only picks invited reflection entries', () => {
    const days = [
      {
        dateKey: '2026-10-02',
        entries: [
          { slot: 0, inviteResult: 'invited', callTitle: '劉先生', customerInfo: '外送員', customerSaid: '想做 cover' },
          { slot: 1, inviteResult: 'not_invited', callTitle: 'X' },
          { slot: 2, inviteResult: 'invited', linkedSource: 'a.wav' },
        ],
      },
    ];
    const out = invitedReflectionEntries(days);
    expect(out.map((x) => x.label)).toEqual(['2026-10-02 · 劉先生', '2026-10-02 · a.wav']);
    expect(out[0].text).toContain('客戶資訊：外送員');
    expect(out[0].text).toContain('客戶回應：想做 cover');
  });

  it('setByPath writes existing paths only', () => {
    const deck = normalizeDeck(aiJson);
    expect(setByPath(deck, 'slides.3.cards.1.text', '新的')).toBe(true);
    expect(deck.slides[3].cards[1].text).toBe('新的');
    expect(setByPath(deck, 'slides.3.cards.9.text', 'x')).toBe(false);
    expect(setByPath(deck, 'slides.99.title', 'x')).toBe(false);
    expect(setByPath(deck, 'slides.5.chips.9', 'x')).toBe(false);
  });

  it('moveSlide stays in bounds', () => {
    const deck = normalizeDeck(aiJson);
    const first = deck.slides[0].id;
    expect(moveSlide(deck, 0, -1)).toBe(0);
    expect(moveSlide(deck, 0, 1)).toBe(1);
    expect(deck.slides[1].id).toBe(first);
  });

  it('makes a safe file name', () => {
    expect(deckFileName({ input: { name: '劉○○', demoAt: '1006 20:30' } })).toBe('劉○○_10062030_DEMO簡報.pptx');
    expect(deckFileName({})).toBe('DEMO_DEMO簡報.pptx');
  });
});

describe('storage', () => {
  afterEach(() => {
    delete globalThis.localStorage;
  });

  it('round-trips decks and drops corrupted deck bodies', () => {
    const mem = {};
    globalThis.localStorage = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = String(v)) };
    const a = { ...newDeckRecord(), updatedAt: 1, input: { name: 'A' }, deck: normalizeDeck(aiJson) };
    const b = { ...newDeckRecord(), updatedAt: 2, deck: { slides: [] } };
    saveDecks([a, b]);
    const list = loadDecks();
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(list[0].deck).toBeNull();
    expect(list[1].deck.slides).toHaveLength(10);
    expect(list[1].input.goals).toBe('');
    mem[DECKS_STORAGE_KEY] = 'not json';
    expect(loadDecks()).toEqual([]);
  });
});

describe('slide HTML', () => {
  it('escapes text, numbers content slides and marks editable paths', () => {
    const deck = normalizeDeck({ slides: [{ type: 'cards', kicker: '節奏', title: '<b>x</b>', cards: [{ title: 'A' }] }] });
    const html = renderSlideHtml(deck.slides[0], { index: 0, total: 3, num: 5, editable: true });
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('<span class="dk-num">05</span>');
    expect(html).toContain('data-path="slides.0.cards.0.title"');
    expect(html).toContain('01 / 03');
    const view = renderSlideHtml(deck.slides[0], { index: 0, total: 1 });
    expect(view).not.toContain('contenteditable');
    expect(view).not.toContain('dk-banner');
  });

  it('renders every slide of a deck', () => {
    const html = renderDeckSlides(normalizeDeck(aiJson));
    expect(html).toHaveLength(10);
    expect(html[0]).toContain('dk-slide dark cover');
    expect(html[5]).toContain('dk-step last');
    expect(html[9]).toContain('dk-next');
  });
});

describe('pptx export', () => {
  it('builds a real pptx with speaker notes', async () => {
    const deck = normalizeDeck(aiJson);
    deck.slides[2].notes = '念原話給他聽';
    const pptx = buildDeckPptx(PptxGenJS, deck);
    const buf = await pptx.write({ outputType: 'nodebuffer' });
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    expect(buf.length).toBeGreaterThan(20000);
  });
});

describe('formatting & images', () => {
  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  it('keeps only valid colors, sizes, fonts and image boxes', () => {
    const s = normalizeSlide({
      type: 'cards',
      title: 'x',
      fmt: {
        bg: '#AABBCC',
        text: { title: { color: '#ff0000', size: 200, font: 'DFKai-SB' }, 'cards.0.text': { color: 'red', size: 'big', font: 'Comic' }, 'bad key!': { color: '#000000' } },
        blocks: { 'cards.1': { fill: '#123456' }, banner: { fill: 'nope' } },
      },
      images: [
        { id: 'img_abc123', x: 500, y: -90, w: 1, ratio: 0.5, bg: 1 },
        { id: 'javascript:alert(1)', x: 1 },
      ],
    });
    expect(s.fmt).toEqual({ bg: '#aabbcc', text: { title: { color: '#ff0000', size: 96, font: 'DFKai-SB' } }, blocks: { 'cards.1': { fill: '#123456' } } });
    expect(s.images).toEqual([{ id: 'img_abc123', x: 100, y: -50, w: 3, ratio: 0.5, bg: true }]);
    expect(normalizeDeck({ theme: { font: 'PMingLiU' }, slides: [{ title: 'a' }] }).theme.font).toBe('PMingLiU');
    expect(normalizeDeck({ theme: { font: 'Evil' }, slides: [{ title: 'a' }] }).theme.font).toBe('');
  });

  it('keeps slides whose title the user cleared when loading saved decks', () => {
    const d = { slides: [{ type: 'cards', title: '' }, { type: 'cards', title: 'b' }] };
    expect(normalizeDeck(d).slides).toHaveLength(1);
    expect(normalizeDeck(d, { keepEmpty: true }).slides).toHaveLength(2);
  });

  it('collects referenced image ids across decks', () => {
    const deck = normalizeDeck({ slides: [{ title: 'a', images: [{ id: 'img_aaaa1' }] }, { title: 'b', images: [{ id: 'img_bbbb2' }, { id: 'img_aaaa1' }] }] });
    expect([...imageIdsInDecks([{ deck }, { deck: null }])].sort()).toEqual(['img_aaaa1', 'img_bbbb2']);
  });

  it('renders text styles, block fills, slide bg, deck font and images', () => {
    const deck = normalizeDeck({
      theme: { font: 'PMingLiU' },
      slides: [
        {
          type: 'cards',
          title: 'T',
          cards: [{ title: 'A' }],
          banner: 'B',
          fmt: { bg: '#101010', text: { title: { color: '#ff0000', size: 48, font: 'DFKai-SB' } }, blocks: { 'cards.0': { fill: '#00ff00' }, banner: { fill: '#0000ff' } } },
          images: [{ id: 'img_fg0001', x: 10, y: 20, w: 30, ratio: 0.5 }, { id: 'img_bg0001', bg: true }, { id: 'img_none01' }],
        },
      ],
    });
    const map = new Map([['img_fg0001', PNG_1PX], ['img_bg0001', PNG_1PX]]);
    const [view] = renderDeckSlides(deck, { resolveImage: (id) => map.get(id) });
    expect(view).toContain('background:#101010');
    expect(view).toContain('&quot;PMingLiU&quot;');
    expect(view).toContain('color:#ff0000;font-size:5cqw;font-family:&quot;DFKai-SB&quot;');
    expect(view).toContain('class="dk-card" style="background:#00ff00"');
    expect(view).toContain('class="dk-banner" style="background:#0000ff"');
    expect(view).toContain('left:10%;top:20%;width:30%;aspect-ratio:1 / 0.5');
    expect(view).toContain('dk-img bg');
    expect(view).toContain('圖片載入中');
    expect(view).not.toContain('data-img=');
    const [ed] = renderDeckSlides(deck, { editable: true, resolveImage: (id) => map.get(id) });
    expect(ed).toContain('data-block="cards.0"');
    expect(ed).toContain('data-img="0"');
    expect(ed).toContain('data-img-resize');
  });

  it('exports formatting and images to pptx', async () => {
    const deck = normalizeDeck({
      theme: { font: 'PMingLiU' },
      slides: [
        {
          type: 'cards',
          title: '標題',
          cards: [{ title: 'A', text: 'a' }],
          fmt: { bg: '#101010', text: { title: { color: '#ff0000', size: 44, font: 'DFKai-SB' } }, blocks: { 'cards.0': { fill: '#00ff00' } } },
          images: [{ id: 'img_fg0001', x: 10, y: 20, w: 30, ratio: 1 }, { id: 'img_bg0001', bg: true, ratio: 1 }],
        },
      ],
    });
    const map = new Map([['img_fg0001', PNG_1PX], ['img_bg0001', PNG_1PX]]);
    const pptx = buildDeckPptx(PptxGenJS, deck, { images: map });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
    const xml = await zip.file('ppt/slides/slide1.xml').async('string');
    expect(xml).toContain('101010');
    expect(xml).toContain('FF0000');
    expect(xml).toContain('sz="4400"');
    expect(xml).toContain('DFKai-SB');
    expect(xml).toContain('00FF00');
    expect(xml).toContain('PMingLiU');
    expect((xml.match(/<p:pic>/g) || []).length).toBe(2);
    expect(Object.keys(zip.files).filter((f) => f.startsWith('ppt/media/') && !zip.files[f].dir)).toHaveLength(2);
  });
});

describe('digital nomad style', () => {
  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const nomadDeck = () =>
    normalizeDeck({ ...aiJson, theme: { style: 'nomad' }, slides: aiJson.slides.map((s, i) => (i === 0 ? { ...s, images: [{ id: 'img_photo1', bg: true, ratio: 1.5 }] } : s)) });

  it('validates the deck style', () => {
    expect(normalizeDeck({ slides: [{ title: 'a' }] }).theme.style).toBe('classic');
    expect(normalizeDeck({ theme: { style: 'nomad' }, slides: [{ title: 'a' }] }).theme.style).toBe('nomad');
    expect(normalizeDeck({ theme: { style: 'neon' }, slides: [{ title: 'a' }] }).theme.style).toBe('classic');
  });

  it('renders glass cards on dark slides and passport stamps on light slides', () => {
    const html = renderDeckSlides(nomadDeck(), { resolveImage: () => PNG_1PX });
    expect(html[0]).toContain('t-nomad has-photo');
    expect(html[0]).toContain('class="dk-nav"');
    expect(html[0]).toContain('<span class="dk-pill">劉○○ · Nomad Notes</span>');
    expect(html[1]).not.toContain('has-photo');
    expect(html[3]).toContain('dk-deco-stamp');
    expect(html[3]).toContain('N° 04 / 10');
    expect(renderDeckSlides(normalizeDeck(aiJson))[3]).not.toContain('t-nomad');
  });

  it('exports the nomad look to pptx', async () => {
    const pptx = buildDeckPptx(PptxGenJS, nomadDeck(), { images: new Map([['img_photo1', PNG_1PX]]) });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
    const cover = await zip.file('ppt/slides/slide1.xml').async('string');
    const section = await zip.file('ppt/slides/slide2.xml').async('string');
    const cards = await zip.file('ppt/slides/slide4.xml').async('string');
    expect(cover).toContain('<p:pic>');
    expect(cover).toContain('Nomad Notes');
    expect(cover).toContain('Segoe Script');
    expect(section).toContain('E8B04B');
    expect(cards).toContain('EEEBE3');
    expect(cards).toContain('prstGeom prst="ellipse"');
    expect(cards).toContain('Consolas');
    expect(cards).toContain('B83A2E');
    const rotated = (cards.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).filter((sp) => /<a:xfrm[^>]*rot=/.test(sp));
    expect(rotated.length).toBeGreaterThan(0);
    expect(rotated.every((sp) => !sp.includes('prst="roundRect"'))).toBe(true);
  });
});

describe('gallery brand style', () => {
  const PNG_1PX =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const galleryDeck = (withPhoto = false) =>
    normalizeDeck({
      ...aiJson,
      theme: { style: 'gallery' },
      slides: aiJson.slides.map((s, i) => (i === 0 && withPhoto ? { ...s, images: [{ id: 'img_photo1', bg: true, ratio: 1.5 }] } : s)),
    });

  it('is a selectable deck style', () => {
    expect(DECK_STYLES.map((x) => x.key)).toContain('gallery');
    expect(normalizeDeck({ theme: { style: 'gallery' }, slides: [{ title: 'a' }] }).theme.style).toBe('gallery');
    expect(sectionNumbers([{ type: 'cover' }, { type: 'section' }, { type: 'cards' }, { type: 'section' }])).toEqual([0, 1, 0, 2]);
  });

  it('renders brand-guide footer, checkerboard cover, oversized section number', () => {
    const html = renderDeckSlides(galleryDeck());
    expect(html[0]).toContain('t-gallery');
    expect(html[0]).toContain('dk-gl-panel');
    expect(html[0]).toContain('<b class="dk-gl-brand">劉○○</b>');
    expect(html[1]).toContain('<b class="dk-gl-big" aria-hidden="true">01</b>');
    expect(html[3]).toContain('<span class="dk-page">04</span>');
    expect(html.at(-1)).toContain('WATCHING.');
    const photo = renderDeckSlides(galleryDeck(true), { resolveImage: () => PNG_1PX });
    expect(photo[0]).toContain('t-gallery has-photo');
    expect(photo[0]).not.toContain('dk-gl-panel');
  });

  it('exports the gallery look to pptx', async () => {
    const pptx = buildDeckPptx(PptxGenJS, galleryDeck(true), { images: new Map([['img_photo1', PNG_1PX]]) });
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(await pptx.write({ outputType: 'nodebuffer' }));
    const cover = await zip.file('ppt/slides/slide1.xml').async('string');
    const section = await zip.file('ppt/slides/slide2.xml').async('string');
    const cards = await zip.file('ppt/slides/slide4.xml').async('string');
    expect(cover).toContain('<p:pic>');
    expect(cover).toContain('D8B48C');
    expect(cover).toContain('REPORT');
    expect(section).toContain('F4EFE6');
    expect(section).toContain('Arial Black');
    expect(cards).toContain('6B3A1E');
    expect(cards).toContain('CDC3B4');
    expect(cards).toContain('Demo Guidelines');
    const rotated = (cards.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || []).filter((sp) => /<a:xfrm[^>]*rot=/.test(sp));
    expect(rotated.length).toBeGreaterThan(0);
    expect(rotated.every((sp) => sp.includes('prst="ellipse"') || sp.includes('rot="5400000"'))).toBe(true);
  });
});
