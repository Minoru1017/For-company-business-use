import { describe, expect, it } from 'vitest';
import {
  addDeckFromInput,
  appendRawNote,
  clampSlideIndex,
  cleanEditedText,
  deckLabel,
  deckListMeta,
  deckOpenMeta,
  deleteSlidePrompt,
  duplicateSlide,
  editorKeyAction,
  presentKeyAction,
  slideIndexAfter,
} from '../src/demo-deck-actions.js';
import { newDeckRecord, templateDeck } from '../src/demo-deck.js';

function recWithDeck(extra = {}) {
  const rec = newDeckRecord();
  rec.input.name = '劉同學';
  rec.deck = templateDeck(rec.input);
  return Object.assign(rec, extra);
}

describe('deck list labels', () => {
  it('prefers input name, then deck customer, then placeholder', () => {
    expect(deckLabel({ input: { name: '  王小明 ' } })).toBe('王小明');
    expect(deckLabel({ input: { name: '' }, deck: { customer: '陳先生' } })).toBe('陳先生');
    expect(deckLabel({})).toBe('未命名客戶');
  });

  it('builds list meta with demo time and page count', () => {
    const rec = recWithDeck({ source: 'template' });
    rec.input.demoAt = '1006 20:30';
    const n = rec.deck.slides.length;
    expect(deckListMeta(rec)).toBe(`1006 20:30 · ${n} 頁・範本`);
    expect(deckListMeta({ input: {} })).toBe('尚未產生');
  });

  it('builds open-card meta with style label', () => {
    const rec = recWithDeck({ source: 'ai' });
    rec.deck.theme = { ...rec.deck.theme, style: 'noir' };
    expect(deckOpenMeta(rec)).toBe(`${rec.deck.slides.length} 頁 · 黑色俐落`);
    rec.deck.theme.style = 'unknown';
    expect(deckOpenMeta(rec)).toContain('經典深藍');
    expect(deckOpenMeta({ deck: null })).toBe('');
  });
});

describe('slide navigation', () => {
  it('clamps indexes', () => {
    expect(clampSlideIndex(-3, 5)).toBe(0);
    expect(clampSlideIndex(9, 5)).toBe(4);
    expect(clampSlideIndex(2, 0)).toBe(0);
  });

  it('maps present-mode keys', () => {
    expect(presentKeyAction('ArrowRight')).toBe('next');
    expect(presentKeyAction(' ')).toBe('next');
    expect(presentKeyAction('Backspace')).toBe('prev');
    expect(presentKeyAction('Home')).toBe('first');
    expect(presentKeyAction('End')).toBe('last');
    expect(presentKeyAction('N')).toBe('notes');
    expect(presentKeyAction('Escape')).toBe('exit');
    expect(presentKeyAction('a')).toBeNull();
  });

  it('maps editor keys but ignores typing and modifiers', () => {
    expect(editorKeyAction('ArrowLeft')).toBe('prev');
    expect(editorKeyAction('f')).toBe('maximize');
    expect(editorKeyAction('Escape')).toBe('close');
    expect(editorKeyAction('ArrowLeft', { typing: true })).toBeNull();
    expect(editorKeyAction('f', { modifier: true })).toBeNull();
    expect(editorKeyAction(' ')).toBeNull();
  });

  it('computes next index per action', () => {
    expect(slideIndexAfter('next', 4, 5)).toBe(4);
    expect(slideIndexAfter('next', 1, 5)).toBe(2);
    expect(slideIndexAfter('prev', 0, 5)).toBe(0);
    expect(slideIndexAfter('first', 3, 5)).toBe(0);
    expect(slideIndexAfter('last', 0, 5)).toBe(4);
    expect(slideIndexAfter('notes', 2, 5)).toBeNull();
  });
});

describe('slide editing', () => {
  it('duplicates a slide after itself with a new id', () => {
    const { deck } = recWithDeck();
    const before = deck.slides.length;
    const orig = deck.slides[1];
    const at = duplicateSlide(deck, 1);
    expect(at).toBe(2);
    expect(deck.slides).toHaveLength(before + 1);
    expect(deck.slides[2].title).toBe(orig.title);
    expect(deck.slides[2].id).not.toBe(orig.id);
  });

  it('blocks deleting the last slide and confirms otherwise', () => {
    expect(deleteSlidePrompt({ slides: [{ title: 'x', type: 'cover' }] }, 0)).toEqual({ blocked: '至少要留一頁' });
    const r = deleteSlidePrompt({ slides: [{ title: '開場', type: 'cover' }, { title: '', type: 'cards' }] }, 1);
    expect(r.confirm).toMatch(/^刪除第 2 頁「.+」？$/);
    expect(r.confirm).not.toContain('「」');
  });

  it('cleans edited text and appends raw notes', () => {
    expect(cleanEditedText('  a\n\n\n\nb  ')).toBe('a\n\nb');
    expect(cleanEditedText(null)).toBe('');
    expect(appendRawNote(' 舊 ', '新')).toBe('舊\n\n新');
    expect(appendRawNote('', '新')).toBe('新');
  });
});

describe('addDeckFromInput', () => {
  it('copies known string fields, sets source, drops blank decks', () => {
    const blank = newDeckRecord();
    const filled = newDeckRecord();
    filled.input.name = '舊客戶';
    const withDeck = recWithDeck();
    withDeck.input.name = '';
    const { rec, decks } = addDeckFromInput([blank, filled, withDeck], { name: '新客戶', goals: '學 AI', bogus: 'x', traits: 3 }, { source: 'reflection' });
    expect(rec.input.name).toBe('新客戶');
    expect(rec.input.goals).toBe('學 AI');
    expect(rec.input.traits).toBe('');
    expect(rec.input).not.toHaveProperty('bogus');
    expect(rec.source).toBe('reflection');
    expect(decks.map((d) => d.id)).toEqual([rec.id, filled.id, withDeck.id]);
  });

  it('defaults source to call and tolerates missing list', () => {
    const { rec, decks } = addDeckFromInput(undefined, { name: 'A' });
    expect(rec.source).toBe('call');
    expect(decks).toEqual([rec]);
  });
});
