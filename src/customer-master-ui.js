/**
 * DEMO 簡報模式裡的「客戶主檔」：所有客戶一覽（名下有幾通邀約、幾份簡報、複盤與錄影分析到哪），
 * 可新增、編輯（改名會同步到名下的簡報與複盤）、合併重複的客戶，並把還沒歸戶的邀約電訪歸給客戶。
 */
import {
  CUSTOMERS_CHANGED_EVENT,
  assignInviteTo,
  createCustomerNamed,
  customerLinks,
  deleteCustomer,
  editCustomer,
  loadCustomers,
  loadRawDecks,
  mergeEverywhere,
  renameEverywhere,
  unassignedInvites,
} from './customers.js';
import { REVIEWS_CHANGED_EVENT, loadReviews, outcomeLabel } from './demo-review.js';
import { escapeHTML } from './utils.js';
import { BRANDS, customersInBrand, inBrand, otherBrandId } from './brands.js';

const DATALIST_ID = 'ccCustomers';

/** 全站共用的客戶名單（姓名欄位的下拉建議），避免同一個人打出兩種寫法 */
export function mountCustomerDatalist() {
  let el = document.getElementById(DATALIST_ID);
  if (!el) {
    el = document.createElement('datalist');
    el.id = DATALIST_ID;
    document.body.appendChild(el);
  }
  const fill = () => {
    el.innerHTML = loadCustomers()
      .map((c) => `<option value="${escapeHTML(c.name)}"></option>`)
      .join('');
  };
  fill();
  window.addEventListener(CUSTOMERS_CHANGED_EVENT, fill);
  return DATALIST_ID;
}

const REASONS = { empty: '請輸入客戶姓名', duplicate: '已經有同名的客戶了，請改用合併', missing: '找不到這位客戶' };

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {()=>Array} opts.getInviteItems  所有「有邀約」的電訪（invitedReflectionEntries 的結果）
 * @param {()=>void} opts.beforeChange  改動前先把畫面上還沒存的簡報／複盤存起來
 * @param {()=>void} opts.afterChange  改動後重新載入簡報與複盤
 * @param {(c:object)=>void} opts.onOpen  開啟這位客戶的簡報或複盤
 * @param {(c:object)=>void} opts.onNewDeck  為這位客戶新增簡報
 * @param {(msg:string)=>void} [opts.showToast]
 */
export function mountCustomerMaster(container, { getInviteItems = () => [], beforeChange = () => {}, afterChange = () => {}, onOpen = () => {}, onNewDeck = () => {}, showToast } = {}) {
  const toast = (m) => showToast?.(m);
  const state = { editing: null, q: '' };

  container.innerHTML = `
    <details class="card cm" open>
      <summary class="cm-head"><h3>客戶主檔 <small id="cmCount"></small></h3></summary>
      <p class="hint cm-lead">一位客戶一個檔案：電訪邀約、DEMO 簡報、DEMO 後複盤、錄影分析都掛在他底下。表單裡填姓名會自動歸戶；改名、合併請在這裡做。</p>
      <div class="cm-tools">
        <input type="search" class="field" id="cmSearch" placeholder="搜尋客戶姓名、電話、備註">
        <button type="button" class="btn slog-mini" id="cmAdd">＋ 新增客戶</button>
      </div>
      <ul class="cm-list" id="cmList"></ul>
      <div class="cm-invites" id="cmInvites"></div>
    </details>`;

  const q = (sel) => container.querySelector(sel);
  const els = { count: q('#cmCount'), list: q('#cmList'), invites: q('#cmInvites'), search: q('#cmSearch') };

  function tagsFor(c, decks, reviews) {
    const links = customerLinks(c.id, { decks, reviews });
    const rev = [...links.reviews].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const tags = [];
    tags.push(`<span class="cm-tag${c.invites.length ? ' on' : ''}">邀約 ${c.invites.length}</span>`);
    tags.push(`<span class="cm-tag${links.decks.length ? ' on' : ''}">簡報 ${links.decks.length}</span>`);
    tags.push(`<span class="cm-tag${rev?.outcome ? ' on' : ''}">${rev?.outcome ? escapeHTML(outcomeLabel(rev.outcome)) : '尚無 DEMO 結果'}</span>`);
    if (rev?.analysis) tags.push('<span class="cm-tag on">已分析錄影</span>');
    return { html: tags.join(''), links };
  }

  function rowHtml(c, others, decks, reviews) {
    const { html, links } = tagsFor(c, decks, reviews);
    if (state.editing === c.id) {
      return `<li class="cm-item editing" data-id="${escapeHTML(c.id)}">
        <div class="cm-edit">
          <label class="dk-field short"><span>姓名</span><input type="text" class="field" data-cm="name" value="${escapeHTML(c.name)}" maxlength="80"></label>
          <label class="dk-field short"><span>電話</span><input type="text" class="field" data-cm="phone" value="${escapeHTML(c.phone)}" maxlength="40"></label>
          <label class="dk-field wide"><span>備註</span><input type="text" class="field" data-cm="note" value="${escapeHTML(c.note)}" maxlength="400" placeholder="例：二手車行行政，想試聽"></label>
        </div>
        <div class="cm-actions">
          <button type="button" class="btn primary slog-mini" data-act="save">儲存</button>
          <button type="button" class="btn slog-mini" data-act="cancel">取消</button>
        </div>
      </li>`;
    }
    const meta = [c.phone, c.note].filter(Boolean).join(' · ');
    return `<li class="cm-item" data-id="${escapeHTML(c.id)}">
      <div class="cm-main">
        <b>${escapeHTML(c.name)}</b>
        <span class="cm-tags">${html}</span>
        ${meta ? `<small>${escapeHTML(meta)}</small>` : ''}
      </div>
      <div class="cm-actions">
        <button type="button" class="btn slog-mini" data-act="open">開啟</button>
        <button type="button" class="btn slog-mini" data-act="deck" title="用這位客戶的資料新增一份簡報">＋ 簡報</button>
        <button type="button" class="btn slog-mini" data-act="edit">編輯</button>
        ${others.length ? `<select class="field cm-merge" data-act="merge" aria-label="合併到其他客戶"><option value="">合併到…</option>${others.map((o) => `<option value="${escapeHTML(o.id)}">${escapeHTML(o.name)}</option>`).join('')}</select>` : ''}
        <button type="button" class="dk-deck-del" data-act="delete" title="${links.decks.length || links.reviews.length ? '名下還有簡報或複盤，請改用合併' : '刪除這位客戶'}" aria-label="刪除">×</button>
      </div>
    </li>`;
  }

  function render() {
    const allDecks = loadRawDecks();
    const allReviews = loadReviews();
    const all = loadCustomers();
    const customers = customersInBrand(all, { decks: allDecks, reviews: allReviews });
    const decks = inBrand(allDecks);
    const reviews = inBrand(allReviews);
    const hiddenCount = all.length - customers.length;
    const needle = state.q.trim().toLowerCase();
    const shown = needle ? customers.filter((c) => [c.name, c.phone, c.note].join('\n').toLowerCase().includes(needle)) : customers;
    els.count.textContent = [customers.length ? `${customers.length} 位` : '', hiddenCount ? `（另有 ${hiddenCount} 位只在${BRANDS[otherBrandId()].name}）` : '']
      .filter(Boolean)
      .join(' ');
    els.list.innerHTML = shown.length
      ? shown
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((c) =>
            rowHtml(
              c,
              customers.filter((o) => o.id !== c.id),
              decks,
              reviews
            )
          )
          .join('')
      : `<li class="hint">${customers.length ? '沒有符合的客戶。' : '還沒有客戶。在簡報或複盤填客戶姓名就會自動建立，也可以按「新增客戶」。'}</li>`;

    const open = unassignedInvites(getInviteItems(), customers);
    els.invites.hidden = !open.length;
    els.invites.innerHTML = open.length
      ? `<h4>尚未歸戶的電訪邀約 <small>${open.length} 通</small></h4>
         <ul class="cm-invite-list">${open
           .map(
             (it) => `<li data-key="${escapeHTML(it.key)}">
               <span>${escapeHTML(it.label)}</span>
               <select class="field" data-invite aria-label="歸給哪位客戶">
                 <option value="">歸給…</option>
                 ${customers.map((c) => `<option value="${escapeHTML(c.id)}">${escapeHTML(c.name)}</option>`).join('')}
                 <option value="__new">＋ 新客戶…</option>
               </select>
             </li>`
           )
           .join('')}</ul>`
      : '';
  }

  function changed() {
    afterChange();
    render();
  }

  q('#cmAdd').addEventListener('click', () => {
    const name = window.prompt('新客戶姓名（建議隱去全名）：');
    if (name == null) return;
    beforeChange();
    const r = createCustomerNamed(name);
    if (!r.ok) return toast(REASONS[r.reason] || '無法新增');
    state.editing = r.customer.id;
    changed();
    toast(`已新增客戶：${r.customer.name}`);
  });

  els.search.addEventListener('input', () => {
    state.q = els.search.value;
    render();
  });

  els.list.addEventListener('click', (e) => {
    const li = e.target.closest('[data-id]');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!li || !act || act === 'merge') return;
    const id = li.dataset.id;
    const customer = loadCustomers().find((c) => c.id === id);
    if (!customer) return;
    if (act === 'open') return onOpen(customer);
    if (act === 'deck') return onNewDeck(customer);
    if (act === 'edit') {
      state.editing = id;
      return render();
    }
    if (act === 'cancel') {
      state.editing = null;
      return render();
    }
    if (act === 'save') {
      const val = (k) => li.querySelector(`[data-cm="${k}"]`).value;
      beforeChange();
      if (val('name').trim() !== customer.name) {
        const r = renameEverywhere(id, val('name'));
        if (!r.ok) return toast(REASONS[r.reason] || '無法改名');
      }
      editCustomer(id, { phone: val('phone'), note: val('note') });
      state.editing = null;
      changed();
      return toast('已儲存客戶資料');
    }
    if (act === 'delete') {
      if (!window.confirm(`刪除客戶「${customer.name}」？`)) return;
      beforeChange();
      const r = deleteCustomer(id);
      if (!r.ok) {
        return toast(r.reason === 'linked' ? `名下還有 ${r.decks} 份簡報、${r.reviews} 筆複盤，不能直接刪除——請改用「合併到…」，或先刪掉那些紀錄` : REASONS[r.reason] || '無法刪除');
      }
      changed();
    }
  });

  els.list.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-act="merge"]');
    if (!sel || !sel.value) return;
    const li = sel.closest('[data-id]');
    const customers = loadCustomers();
    const from = customers.find((c) => c.id === li.dataset.id);
    const into = customers.find((c) => c.id === sel.value);
    sel.value = '';
    if (!from || !into) return;
    if (!window.confirm(`把「${from.name}」併入「${into.name}」？\n他名下的簡報、複盤、邀約都會移到「${into.name}」，名字統一改成「${into.name}」。`)) return;
    beforeChange();
    const r = mergeEverywhere(from.id, into.id);
    if (!r.ok) return toast('合併失敗');
    changed();
    toast(`已合併到「${into.name}」`);
  });

  els.invites.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-invite]');
    if (!sel || !sel.value) return;
    const key = sel.closest('[data-key]').dataset.key;
    let id = sel.value;
    beforeChange();
    if (id === '__new') {
      const name = window.prompt('新客戶姓名（建議隱去全名）：');
      sel.value = '';
      if (name == null) return;
      const r = createCustomerNamed(name);
      if (!r.ok && !r.customer) return toast(REASONS[r.reason] || '無法新增');
      id = r.customer.id;
    }
    if (assignInviteTo(id, key)) {
      changed();
      toast('已歸戶這通邀約');
    }
  });

  window.addEventListener(CUSTOMERS_CHANGED_EVENT, render);
  window.addEventListener(REVIEWS_CHANGED_EVENT, render);
  render();

  return { refresh: render };
}
