import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRAND_STORAGE_KEY,
  brandOf,
  customersInBrand,
  getBrandId,
  inBrand,
  otherBrandCount,
  otherBrandId,
  setBrandId,
} from '../src/brands.js';
import { buildDeckPrompt, loadCourseNotes, loadDecks, newDeckRecord, saveCourseNotes } from '../src/demo-deck.js';
import { emptyReview, normalizeReview } from '../src/demo-review.js';
import { buildConsultPrompt } from '../src/demo-review-consult.js';
import { reviewCardModel } from '../src/demo-review-card.js';
import { loadCustomerProgress } from '../src/customer-progress.js';

let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

describe('brands', () => {
  it('defaults to NOVA and remembers the choice', () => {
    expect(getBrandId()).toBe('nova');
    setBrandId('aifa');
    expect(store.get(BRAND_STORAGE_KEY)).toBe('aifa');
    expect(getBrandId()).toBe('aifa');
    setBrandId('bogus');
    expect(getBrandId()).toBe('nova');
    expect(otherBrandId('nova')).toBe('aifa');
  });

  it('treats records without a brand as AI未來學院', () => {
    expect(brandOf({})).toBe('aifa');
    expect(brandOf({ brand: 'nova' })).toBe('nova');
    const list = [{ id: 'a' }, { id: 'b', brand: 'nova' }, { id: 'c', brand: 'aifa' }];
    expect(inBrand(list, 'aifa').map((r) => r.id)).toEqual(['a', 'c']);
    expect(otherBrandCount(list, 'nova')).toBe(2);
  });

  it('keeps old decks and reviews in AI未來學院 and tags new ones with the current brand', () => {
    localStorage.setItem('call_coach_demo_decks_v1', JSON.stringify([{ id: 'old', input: { name: '舊' } }]));
    setBrandId('nova');
    expect(loadDecks()[0].brand).toBe('aifa');
    expect(newDeckRecord().brand).toBe('nova');
    expect(normalizeReview({ id: 'r1' }).brand).toBe('aifa');
    expect(emptyReview().brand).toBe('nova');
    expect(emptyReview({ brand: 'aifa' }).brand).toBe('aifa');
  });

  it('stores course notes per brand, reusing the old key for AI未來學院', () => {
    localStorage.setItem('call_coach_demo_deck_course_v1', '舊課綱');
    setBrandId('nova');
    expect(loadCourseNotes()).toBe('');
    saveCourseNotes('NOVA 課綱');
    expect(loadCourseNotes('nova')).toBe('NOVA 課綱');
    expect(loadCourseNotes('aifa')).toBe('舊課綱');
  });

  it('puts the brand name in prompts and the review card', () => {
    expect(buildDeckPrompt({}, { brand: 'nova' })).toContain('「NOVA超星計劃」的資深課程顧問');
    expect(buildDeckPrompt({}, { brand: 'aifa' })).toContain('【品牌】AI未來學院');
    expect(buildConsultPrompt({ brand: 'NOVA超星計劃' })).toContain('品牌：NOVA超星計劃');
    expect(reviewCardModel(normalizeReview({ id: 'r', brand: 'nova' })).brand).toBe('NOVA超星計劃');
  });

  it('shows shared customers only where they have records', () => {
    const customers = [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }];
    const decks = [{ id: 'd1', customerId: 'c1' }, { id: 'd2', customerId: 'c2', brand: 'nova' }];
    expect(customersInBrand(customers, { decks }, 'nova').map((c) => c.id)).toEqual(['c2', 'c3']);
    expect(customersInBrand(customers, { decks }, 'aifa').map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('filters home customer progress by brand', () => {
    localStorage.setItem(
      'call_coach_demo_decks_v1',
      JSON.stringify([
        { id: 'd1', input: { name: '舊客戶' } },
        { id: 'd2', brand: 'nova', input: { name: '新客戶' } },
      ])
    );
    expect(loadCustomerProgress('2026-10-14', 'nova').map((c) => c.name)).toEqual(['新客戶']);
    expect(loadCustomerProgress('2026-10-14', 'aifa').map((c) => c.name)).toEqual(['舊客戶']);
  });
});
