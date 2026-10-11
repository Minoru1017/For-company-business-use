/**
 * 統一的客戶主檔：一位客戶一個 ID，電訪邀約、DEMO 簡報、DEMO 後複盤都掛在他底下。
 * 簡報與複盤各自的紀錄裡仍存姓名（顯示用），以 customerId 對應回主檔；
 * 改名、合併一律從主檔操作，會同步更新所有掛在他底下的簡報與複盤。
 * 資料只存本機 localStorage（會跟著「全部備份」一起走）。
 */
import { DECKS_STORAGE_KEY } from './demo-deck.js';
import { loadReviews, saveReviews } from './demo-review.js';

export const CUSTOMERS_KEY = 'call_coach_customers_v1';
export const CUSTOMERS_CHANGED_EVENT = 'callcoach:customers-changed';

const NAME_LIMIT = 80;
const TEXT_LIMIT = 400;

function cid() {
  return `cus_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

const clip = (v, n) => String(v ?? '').trim().slice(0, n);

/** 比對姓名用：忽略空白、大小寫與全半形 */
export function nameKey(name) {
  return String(name ?? '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
}

export function normalizeCustomer(c = {}) {
  const now = Date.now();
  const invites = [...new Set((Array.isArray(c.invites) ? c.invites : []).map((k) => clip(k, 60)).filter(Boolean))];
  const createdAt = Number(c.createdAt) || now;
  return {
    id: clip(c.id, 60) || cid(),
    name: clip(c.name, NAME_LIMIT),
    phone: clip(c.phone, 40),
    note: clip(c.note, TEXT_LIMIT),
    /** true＝從簡報／複盤的姓名自動建立；沒有任何紀錄掛著時會自動清掉。手動建立的不會 */
    auto: c.auto !== false,
    invites,
    createdAt,
    updatedAt: Number(c.updatedAt) || createdAt,
  };
}

export function findByName(list, name) {
  const key = nameKey(name);
  return key ? (list || []).find((c) => nameKey(c.name) === key) || null : null;
}

/** 沒有就建立，回傳客戶與新清單；姓名空白回傳 null */
export function resolveCustomer(list, name, { auto = true, now = Date.now() } = {}) {
  const clean = clip(name, NAME_LIMIT);
  if (!nameKey(clean)) return { customer: null, list: list || [], created: false };
  const hit = findByName(list, clean);
  if (hit) return { customer: hit, list: list || [], created: false };
  const customer = normalizeCustomer({ name: clean, auto, createdAt: now, updatedAt: now });
  return { customer, list: [customer, ...(list || [])], created: true };
}

/** @returns {{ok:boolean, reason?:'empty'|'duplicate'|'missing', list:Array}} */
export function renameCustomer(list, id, name, now = Date.now()) {
  const clean = clip(name, NAME_LIMIT);
  const target = (list || []).find((c) => c.id === id);
  if (!target) return { ok: false, reason: 'missing', list };
  if (!nameKey(clean)) return { ok: false, reason: 'empty', list };
  const dup = findByName(list, clean);
  if (dup && dup.id !== id) return { ok: false, reason: 'duplicate', list };
  return { ok: true, list: list.map((c) => (c.id === id ? { ...c, name: clean, auto: false, updatedAt: now } : c)) };
}

export function updateCustomer(list, id, patch, now = Date.now()) {
  return (list || []).map((c) => (c.id === id ? normalizeCustomer({ ...c, ...patch, id: c.id, updatedAt: now }) : c));
}

export function removeCustomer(list, id) {
  return (list || []).filter((c) => c.id !== id);
}

/** 把 fromId 併進 intoId：邀約合併、空白的電話與備註補上，回傳新清單 */
export function mergeCustomers(list, fromId, intoId, now = Date.now()) {
  const from = (list || []).find((c) => c.id === fromId);
  const into = (list || []).find((c) => c.id === intoId);
  if (!from || !into || from.id === into.id) return { ok: false, list };
  const merged = normalizeCustomer({
    ...into,
    auto: false,
    invites: [...into.invites, ...from.invites],
    phone: into.phone || from.phone,
    note: [into.note, from.note].filter(Boolean).join('\n'),
    updatedAt: now,
  });
  return { ok: true, into: merged, list: list.filter((c) => c.id !== fromId).map((c) => (c.id === intoId ? merged : c)) };
}

export function addInvite(list, customerId, key, now = Date.now()) {
  const k = clip(key, 60);
  if (!k) return list;
  return (list || []).map((c) => {
    if (c.id === customerId) return c.invites.includes(k) ? c : { ...c, invites: [...c.invites, k], updatedAt: now };
    // 一通邀約只屬於一位客戶
    return c.invites.includes(k) ? { ...c, invites: c.invites.filter((x) => x !== k) } : c;
  });
}

/** 還沒歸給任何客戶的「有邀約」電訪（items 是 invitedReflectionEntries 的結果） */
export function unassignedInvites(items, customers) {
  const taken = new Set((customers || []).flatMap((c) => c.invites));
  return (items || []).filter((it) => !taken.has(it.key));
}

/**
 * 讓簡報、複盤、主檔三邊對齊（純函式，不碰儲存）：
 * - 簡報／複盤有姓名但沒有（或對不上）customerId → 以姓名找主檔，沒有就自動建立
 * - 複盤綁著簡報、姓名沒有另外改過 → 沿用簡報的客戶
 * - 簡報記著的邀約（inviteKeys）掛到客戶底下
 * - 自動建立、且沒有任何紀錄掛著的客戶清掉
 * @param {{customers:Array, decks:Array, reviews:Array}} data  decks 是儲存裡的原始格式
 */
export function reconcile({ customers = [], decks = [], reviews = [] } = {}, now = Date.now()) {
  let list = customers.map((c) => ({ ...c }));
  const outDecks = decks.map((d) => ({ ...d }));
  const outReviews = reviews.map((r) => ({ ...r }));
  const touched = { decks: false, reviews: false, customers: false };

  const link = (rec, name, set) => {
    const cur = list.find((c) => c.id === rec.customerId);
    if (cur && nameKey(cur.name) === nameKey(name)) return cur;
    const r = resolveCustomer(list, name, { now });
    list = r.list;
    if (r.created) touched.customers = true;
    set(r.customer.id);
    return r.customer;
  };

  outDecks.forEach((d) => {
    const name = clip(d.input?.name, NAME_LIMIT);
    if (nameKey(name)) {
      link(d, name, (id) => {
        d.customerId = id;
        touched.decks = true;
      });
    } else if (d.customerId && !list.some((c) => c.id === d.customerId)) {
      d.customerId = '';
      touched.decks = true;
    }
  });

  outReviews.forEach((r) => {
    const deck = r.deckId ? outDecks.find((d) => d.id === r.deckId) : null;
    const deckName = clip(deck?.input?.name, NAME_LIMIT);
    const name = clip(r.customer, NAME_LIMIT);
    let id = r.customerId || '';
    if (deck?.customerId && (!nameKey(name) || nameKey(name) === nameKey(deckName))) {
      id = deck.customerId;
    } else if (nameKey(name)) {
      id = link(r, name, () => {}).id;
    } else if (id && !list.some((c) => c.id === id)) {
      id = '';
    }
    if (id !== (r.customerId || '')) {
      r.customerId = id;
      touched.reviews = true;
    }
  });

  outDecks.forEach((d) => {
    if (!d.customerId || !Array.isArray(d.inviteKeys)) return;
    d.inviteKeys.forEach((k) => {
      const before = list.find((c) => c.id === d.customerId)?.invites.includes(k);
      if (!before) {
        list = addInvite(list, d.customerId, k, now);
        touched.customers = true;
      }
    });
  });

  const used = new Set([...outDecks.map((d) => d.customerId), ...outReviews.map((r) => r.customerId)].filter(Boolean));
  const kept = list.filter((c) => !c.auto || c.invites.length || used.has(c.id));
  if (kept.length !== list.length) touched.customers = true;

  return { customers: kept, decks: outDecks, reviews: outReviews, touched };
}

/** 客戶名下有哪些東西（主檔畫面與首頁進度用） */
export function customerLinks(customerId, { decks = [], reviews = [] } = {}) {
  return {
    decks: decks.filter((d) => d.customerId === customerId),
    reviews: reviews.filter((r) => r.customerId === customerId),
  };
}

/* ---- 儲存 ---- */

export function loadCustomers() {
  try {
    const raw = JSON.parse(localStorage.getItem(CUSTOMERS_KEY) || '[]');
    return (Array.isArray(raw) ? raw : [])
      .filter((c) => c && typeof c === 'object')
      .map(normalizeCustomer)
      .filter((c) => c.name);
  } catch {
    return [];
  }
}

export function saveCustomers(list) {
  localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(list || []));
}

/** 簡報在儲存裡的原始格式（不做正規化，避免改到其他欄位） */
export function loadRawDecks() {
  try {
    const raw = JSON.parse(localStorage.getItem(DECKS_STORAGE_KEY) || '[]');
    return (Array.isArray(raw) ? raw : []).filter((d) => d && typeof d === 'object' && d.id);
  } catch {
    return [];
  }
}

function saveRawDecks(list) {
  localStorage.setItem(DECKS_STORAGE_KEY, JSON.stringify(list));
}

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CUSTOMERS_CHANGED_EVENT));
}

function loadAll() {
  return { customers: loadCustomers(), decks: loadRawDecks(), reviews: loadReviews() };
}

function saveAll({ customers, decks, reviews }, touched = { customers: true, decks: true, reviews: true }) {
  if (touched.decks) saveRawDecks(decks);
  if (touched.reviews) saveReviews(reviews);
  if (touched.customers) saveCustomers(customers);
  notify();
}

/** 啟動時與每次改動後呼叫：補上 customerId、建立缺的客戶。回傳最新客戶清單 */
export function syncCustomers() {
  try {
    const out = reconcile(loadAll());
    if (out.touched.decks || out.touched.reviews || out.touched.customers) saveAll(out, out.touched);
    return out.customers;
  } catch {
    return loadCustomers();
  }
}

/** 表單的姓名填好了：回傳這位客戶的 ID（沒有就建立）；姓名空白回傳 '' */
export function ensureCustomerId(name) {
  const r = resolveCustomer(loadCustomers(), name);
  if (!r.customer) return '';
  if (r.created) {
    saveCustomers(r.list);
    notify();
  }
  return r.customer.id;
}

/** 手動新增客戶 */
export function createCustomerNamed(name, extra = {}) {
  const list = loadCustomers();
  const clean = clip(name, NAME_LIMIT);
  const hit = findByName(list, clean);
  if (hit) return { ok: false, reason: 'duplicate', customer: hit };
  if (!nameKey(clean)) return { ok: false, reason: 'empty' };
  const customer = normalizeCustomer({ ...extra, name: clean, auto: false });
  saveCustomers([customer, ...list]);
  notify();
  return { ok: true, customer };
}

export function editCustomer(id, patch) {
  saveCustomers(updateCustomer(loadCustomers(), id, patch));
  notify();
}

/** 改名：同步更新所有掛在他底下的簡報與複盤的姓名 */
export function renameEverywhere(id, name) {
  const all = loadAll();
  const r = renameCustomer(all.customers, id, name);
  if (!r.ok) return r;
  const clean = r.list.find((c) => c.id === id).name;
  const decks = all.decks.map((d) => (d.customerId === id ? { ...d, input: { ...(d.input || {}), name: clean } } : d));
  const reviews = all.reviews.map((x) => (x.customerId === id ? { ...x, customer: clean } : x));
  saveAll({ customers: r.list, decks, reviews });
  return { ok: true };
}

/** 合併重複的客戶：fromId 名下的簡報、複盤、邀約全部移到 intoId */
export function mergeEverywhere(fromId, intoId) {
  const all = loadAll();
  const r = mergeCustomers(all.customers, fromId, intoId);
  if (!r.ok) return r;
  const name = r.into.name;
  const decks = all.decks.map((d) => (d.customerId === fromId ? { ...d, customerId: intoId, input: { ...(d.input || {}), name } } : d));
  const reviews = all.reviews.map((x) => (x.customerId === fromId ? { ...x, customerId: intoId, customer: name } : x));
  saveAll({ customers: r.list, decks, reviews });
  return { ok: true };
}

/** 刪除客戶：名下還有簡報或複盤時不能刪（請改用合併，或先刪掉那些紀錄），避免弄丟資料 */
export function deleteCustomer(id) {
  const all = loadAll();
  if (!all.customers.some((c) => c.id === id)) return { ok: false, reason: 'missing' };
  const links = customerLinks(id, all);
  if (links.decks.length || links.reviews.length) return { ok: false, reason: 'linked', ...{ decks: links.decks.length, reviews: links.reviews.length } };
  saveCustomers(removeCustomer(all.customers, id));
  notify();
  return { ok: true };
}

/** 把一通有邀約的電訪歸給客戶 */
export function assignInviteTo(customerId, key) {
  const list = loadCustomers();
  if (!list.some((c) => c.id === customerId)) return false;
  saveCustomers(addInvite(list, customerId, key));
  notify();
  return true;
}
