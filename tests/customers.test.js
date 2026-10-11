import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isAppKey } from '../src/backup.js';
import {
  CUSTOMERS_CHANGED_EVENT,
  CUSTOMERS_KEY,
  addInvite,
  assignInviteTo,
  createCustomerNamed,
  customerLinks,
  deleteCustomer,
  editCustomer,
  ensureCustomerId,
  findByName,
  loadCustomers,
  mergeCustomers,
  mergeEverywhere,
  nameKey,
  normalizeCustomer,
  reconcile,
  renameCustomer,
  renameEverywhere,
  resolveCustomer,
  syncCustomers,
  unassignedInvites,
} from '../src/customers.js';
import { emptyReview, loadReviews, normalizeReview, saveReviews } from '../src/demo-review.js';

const DECKS_KEY = 'call_coach_demo_decks_v1';
const deck = (id, name, over = {}) => ({ id, updatedAt: 1, input: { name }, deck: null, ...over });
const cus = (name, over = {}) => normalizeCustomer({ name, ...over });
const rev = (over = {}) => normalizeReview({ ...emptyReview(), ...over });

let events;
beforeEach(() => {
  const store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
  events = vi.fn();
  vi.stubGlobal('window', { dispatchEvent: events });
});

describe('customers: names and basic operations', () => {
  it('compares names ignoring spaces, case and full-width characters', () => {
    expect(nameKey(' 涵 小姐 ')).toBe(nameKey('涵小姐'));
    expect(nameKey('ＡＢＣ')).toBe(nameKey('abc'));
    expect(nameKey('')).toBe('');
  });

  it('resolves an existing customer or creates one, and ignores blank names', () => {
    const first = resolveCustomer([], '涵小姐');
    expect(first.created).toBe(true);
    expect(first.customer).toMatchObject({ name: '涵小姐', auto: true });
    const again = resolveCustomer(first.list, ' 涵 小姐');
    expect(again.created).toBe(false);
    expect(again.customer.id).toBe(first.customer.id);
    expect(resolveCustomer(first.list, '  ').customer).toBeNull();
  });

  it('renames, refuses duplicates and empty names, and keeps renamed customers', () => {
    const list = [cus('A'), cus('B')];
    const ok = renameCustomer(list, list[0].id, 'A2');
    expect(ok.ok).toBe(true);
    expect(ok.list[0]).toMatchObject({ name: 'A2', auto: false });
    expect(renameCustomer(list, list[0].id, ' b ').reason).toBe('duplicate');
    expect(renameCustomer(list, list[0].id, ' ').reason).toBe('empty');
    expect(renameCustomer(list, 'nope', 'X').reason).toBe('missing');
    expect(renameCustomer(list, list[0].id, 'a').ok).toBe(true);
  });

  it('merges invites, phone and notes into the target', () => {
    const a = cus('A', { invites: ['k1'], phone: '0911', note: '甲' });
    const b = cus('B', { invites: ['k2', 'k1'], note: '乙' });
    const r = mergeCustomers([a, b], a.id, b.id);
    expect(r.list).toHaveLength(1);
    expect(r.into).toMatchObject({ id: b.id, phone: '0911', note: '乙\n甲', auto: false });
    expect(r.into.invites.sort()).toEqual(['k1', 'k2']);
    expect(mergeCustomers([a, b], a.id, a.id).ok).toBe(false);
  });

  it('gives one invite to one customer only', () => {
    const a = cus('A', { invites: ['k'] });
    const b = cus('B');
    const list = addInvite([a, b], b.id, 'k');
    expect(list.find((c) => c.id === a.id).invites).toEqual([]);
    expect(list.find((c) => c.id === b.id).invites).toEqual(['k']);
    expect(unassignedInvites([{ key: 'k' }, { key: 'z' }], list)).toEqual([{ key: 'z' }]);
  });

  it('normalizes loose data', () => {
    const c = normalizeCustomer({ name: ' 王 ', invites: ['a', 'a', '', 5], phone: 'x'.repeat(99) });
    expect(c.name).toBe('王');
    expect(c.invites).toEqual(['a', '5']);
    expect(c.phone).toHaveLength(40);
    expect(c.id).toMatch(/^cus_/);
    expect(findByName([c], '王').id).toBe(c.id);
  });
});

describe('customers: reconcile decks, reviews and the master list', () => {
  it('creates customers from deck and review names and links them by id', () => {
    const out = reconcile({ decks: [deck('d1', '涵小姐')], reviews: [rev({ customer: '王先生' })] });
    expect(out.customers.map((c) => c.name).sort()).toEqual(['涵小姐', '王先生']);
    const han = out.customers.find((c) => c.name === '涵小姐');
    expect(out.decks[0].customerId).toBe(han.id);
    expect(out.reviews[0].customerId).toBe(out.customers.find((c) => c.name === '王先生').id);
    expect(out.touched).toMatchObject({ decks: true, reviews: true, customers: true });
  });

  it('puts a deck and its review under the same customer', () => {
    const out = reconcile({ decks: [deck('d1', '涵小姐')], reviews: [rev({ deckId: 'd1', customer: '涵小姐' }), rev({ deckId: 'd1', customer: '' })] });
    expect(out.customers).toHaveLength(1);
    expect(out.reviews.every((r) => r.customerId === out.customers[0].id)).toBe(true);
  });

  it('treats a review whose name was changed as another customer', () => {
    const out = reconcile({ decks: [deck('d1', '涵小姐')], reviews: [rev({ deckId: 'd1', customer: '涵媽媽' })] });
    expect(out.customers).toHaveLength(2);
    expect(out.reviews[0].customerId).not.toBe(out.decks[0].customerId);
  });

  it('relinks when the name on a deck no longer matches its customer', () => {
    const old = cus('涵小姐', { auto: false });
    const out = reconcile({ customers: [old], decks: [deck('d1', '涵小姐二號', { customerId: old.id })] });
    expect(out.decks[0].customerId).not.toBe(old.id);
    expect(out.customers.find((c) => c.name === '涵小姐二號')).toBeTruthy();
    expect(out.customers.find((c) => c.id === old.id)).toBeTruthy();
  });

  it('adds the invites a deck remembers and prunes empty auto customers', () => {
    const ghost = cus('沒人用', { auto: true });
    const manual = cus('手動建立', { auto: false });
    const out = reconcile({ customers: [ghost, manual], decks: [deck('d1', '涵小姐', { inviteKeys: ['2026-10-01#0'] })] });
    expect(out.customers.map((c) => c.name).sort()).toEqual(['手動建立', '涵小姐'].sort());
    expect(out.customers.find((c) => c.name === '涵小姐').invites).toEqual(['2026-10-01#0']);
  });

  it('keeps an invite-only auto customer and is idempotent', () => {
    const only = cus('剛邀約', { invites: ['k'] });
    const first = reconcile({ customers: [only], decks: [deck('d1', 'A')], reviews: [] });
    const second = reconcile(first);
    expect(first.customers.some((c) => c.name === '剛邀約')).toBe(true);
    expect(second.touched).toEqual({ decks: false, reviews: false, customers: false });
  });

  it('does not touch decks that have no name', () => {
    const out = reconcile({ decks: [deck('d1', ''), deck('d2', '  ')] });
    expect(out.customers).toEqual([]);
    expect(out.touched.decks).toBe(false);
  });

  it('lists what hangs under a customer', () => {
    expect(customerLinks('c', { decks: [{ customerId: 'c' }, { customerId: 'x' }], reviews: [{ customerId: 'c' }] })).toEqual({ decks: [{ customerId: 'c' }], reviews: [{ customerId: 'c' }] });
  });
});

describe('customers: storage', () => {
  const seed = () => {
    localStorage.setItem(DECKS_KEY, JSON.stringify([deck('d1', '涵小姐', { extra: 'keep' }), deck('d2', '王先生')]));
    saveReviews([rev({ deckId: 'd1', customer: '涵小姐' })]);
  };

  it('sync writes ids back without losing other deck fields, then settles', () => {
    seed();
    const list = syncCustomers();
    expect(list.map((c) => c.name).sort()).toEqual(['涵小姐', '王先生']);
    const decks = JSON.parse(localStorage.getItem(DECKS_KEY));
    expect(decks.find((d) => d.id === 'd1')).toMatchObject({ extra: 'keep', customerId: list.find((c) => c.name === '涵小姐').id });
    expect(loadReviews()[0].customerId).toBe(decks[0].customerId);
    events.mockClear();
    syncCustomers();
    expect(events).not.toHaveBeenCalled();
  });

  it('ensureCustomerId creates once and returns the same id afterwards', () => {
    const id = ensureCustomerId('林小姐');
    expect(id).toMatch(/^cus_/);
    expect(ensureCustomerId(' 林小姐 ')).toBe(id);
    expect(ensureCustomerId('')).toBe('');
    expect(loadCustomers()).toHaveLength(1);
    expect(events.mock.calls[0][0].type).toBe(CUSTOMERS_CHANGED_EVENT);
  });

  it('rename updates every deck and review under the customer', () => {
    seed();
    syncCustomers();
    const id = loadCustomers().find((c) => c.name === '涵小姐').id;
    expect(renameEverywhere(id, '涵 Yuki').ok).toBe(true);
    expect(JSON.parse(localStorage.getItem(DECKS_KEY)).find((d) => d.id === 'd1').input.name).toBe('涵 Yuki');
    expect(loadReviews()[0].customer).toBe('涵 Yuki');
    expect(renameEverywhere(id, '王先生').reason).toBe('duplicate');
    syncCustomers();
    expect(loadCustomers().filter((c) => c.name === '涵 Yuki')).toHaveLength(1);
    expect(loadCustomers()).toHaveLength(2);
  });

  it('merge moves records and does not split again on the next sync', () => {
    seed();
    syncCustomers();
    const [han, wang] = ['涵小姐', '王先生'].map((n) => loadCustomers().find((c) => c.name === n));
    expect(mergeEverywhere(wang.id, han.id).ok).toBe(true);
    const decks = JSON.parse(localStorage.getItem(DECKS_KEY));
    expect(decks.every((d) => d.customerId === han.id && d.input.name === '涵小姐')).toBe(true);
    syncCustomers();
    expect(loadCustomers().map((c) => c.name)).toEqual(['涵小姐']);
  });

  it('delete is refused while decks or reviews hang under the customer', () => {
    seed();
    syncCustomers();
    const han = loadCustomers().find((c) => c.name === '涵小姐');
    expect(deleteCustomer(han.id)).toMatchObject({ ok: false, reason: 'linked', decks: 1, reviews: 1 });
    const made = createCustomerNamed('空客戶');
    expect(deleteCustomer(made.customer.id).ok).toBe(true);
    expect(deleteCustomer('nope').ok).toBe(false);
  });

  it('creates, edits and assigns invites', () => {
    const made = createCustomerNamed('新客戶', { phone: '0911' });
    expect(made.ok).toBe(true);
    expect(createCustomerNamed(' 新客戶 ')).toMatchObject({ ok: false, reason: 'duplicate' });
    expect(createCustomerNamed('  ').reason).toBe('empty');
    editCustomer(made.customer.id, { note: '想試聽' });
    expect(loadCustomers()[0]).toMatchObject({ phone: '0911', note: '想試聽', auto: false });
    expect(assignInviteTo(made.customer.id, '2026-10-01#1')).toBe(true);
    expect(assignInviteTo('nope', 'x')).toBe(false);
    expect(loadCustomers()[0].invites).toEqual(['2026-10-01#1']);
  });

  it('survives corrupted storage and is included in backups', () => {
    localStorage.setItem(CUSTOMERS_KEY, '{bad');
    expect(loadCustomers()).toEqual([]);
    localStorage.setItem(DECKS_KEY, '{bad');
    expect(() => syncCustomers()).not.toThrow();
    expect(isAppKey(CUSTOMERS_KEY)).toBe(true);
  });
});
