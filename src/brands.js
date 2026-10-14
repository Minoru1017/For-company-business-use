/**
 * 兩個品牌：原本的「AI未來學院」與新的「NOVA超星計劃」。
 * 簡報、DEMO 後複盤各自帶 brand 欄位，畫面只顯示目前品牌的資料；
 * 換品牌之前建的資料沒有 brand 欄位，一律算 AI未來學院。
 */

export const BRAND_STORAGE_KEY = 'callCoachBrand';
export const BRAND_CHANGED_EVENT = 'callcoach:brand';

export const LEGACY_BRAND = 'aifa';
export const DEFAULT_BRAND = 'nova';

export const BRANDS = {
  aifa: {
    id: 'aifa',
    name: 'AI未來學院',
    short: 'AI未來學院',
    productPlaceholder: 'AI 未來學院初階計畫',
    courseNotesKey: 'call_coach_demo_deck_course_v1',
  },
  nova: {
    id: 'nova',
    name: 'NOVA超星計劃',
    short: 'NOVA',
    productPlaceholder: 'NOVA超星計劃初階方案',
    courseNotesKey: 'call_coach_demo_deck_course_nova_v1',
  },
};

export const BRAND_IDS = Object.keys(BRANDS);

export function normalizeBrandId(id, fallback = LEGACY_BRAND) {
  return BRANDS[id] ? id : fallback;
}

export function brandInfo(id) {
  return BRANDS[normalizeBrandId(id)];
}

/** 紀錄屬於哪個品牌（舊資料沒有欄位→AI未來學院） */
export function brandOf(record) {
  return normalizeBrandId(record?.brand);
}

export function getBrandId() {
  try {
    return normalizeBrandId(localStorage.getItem(BRAND_STORAGE_KEY), DEFAULT_BRAND);
  } catch {
    return DEFAULT_BRAND;
  }
}

export function currentBrand() {
  return BRANDS[getBrandId()];
}

export function setBrandId(id) {
  const next = normalizeBrandId(id, DEFAULT_BRAND);
  const prev = getBrandId();
  try {
    localStorage.setItem(BRAND_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  if (next !== prev && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BRAND_CHANGED_EVENT, { detail: { brand: next } }));
  }
  return next;
}

export function onBrandChange(fn) {
  if (typeof window === 'undefined') return () => {};
  const h = (e) => fn(e.detail?.brand || getBrandId());
  window.addEventListener(BRAND_CHANGED_EVENT, h);
  return () => window.removeEventListener(BRAND_CHANGED_EVENT, h);
}

export function inBrand(list, id = getBrandId()) {
  return (Array.isArray(list) ? list : []).filter((r) => brandOf(r) === id);
}

/** 客戶主檔兩個品牌共用：名下有這個品牌的紀錄、或還沒有任何紀錄的客戶才顯示 */
export function customersInBrand(customers, { decks = [], reviews = [] } = {}, id = getBrandId()) {
  const owner = new Map();
  [...decks, ...reviews].forEach((r) => {
    if (!r?.customerId) return;
    const set = owner.get(r.customerId) || new Set();
    set.add(brandOf(r));
    owner.set(r.customerId, set);
  });
  return (Array.isArray(customers) ? customers : []).filter((c) => !owner.has(c.id) || owner.get(c.id).has(id));
}

/** 另一個品牌還有幾筆（畫面提示用） */
export function otherBrandCount(list, id = getBrandId()) {
  return (Array.isArray(list) ? list : []).length - inBrand(list, id).length;
}

export function otherBrandId(id = getBrandId()) {
  return BRAND_IDS.find((b) => b !== id) || LEGACY_BRAND;
}

export function brandSwitchHTML(id = getBrandId(), cls = '') {
  return `<div class="brand-switch${cls ? ` ${cls}` : ''}" role="group" aria-label="切換品牌">${BRAND_IDS.map(
    (b) =>
      `<button type="button" class="brand-switch-btn${b === id ? ' on' : ''}" data-brand-set="${b}" aria-pressed="${b === id}">${BRANDS[b].name}</button>`
  ).join('')}</div>`;
}

/** 任何頁面上的 [data-brand-set] 按鈕都能切換；切換後同步所有切換器與 body[data-brand] */
export function initBrandSwitches(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  const paint = (id) => {
    root.querySelectorAll('[data-brand-set]').forEach((btn) => {
      const on = btn.dataset.brandSet === id;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', String(on));
    });
    root.querySelectorAll('[data-brand-name]').forEach((el) => {
      el.textContent = BRANDS[id].name;
    });
    if (root.body) root.body.dataset.brand = id;
  };
  root.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-brand-set]');
    if (btn) setBrandId(btn.dataset.brandSet);
  });
  onBrandChange(paint);
  paint(getBrandId());
}
