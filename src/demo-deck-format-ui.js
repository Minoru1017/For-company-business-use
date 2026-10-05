/**
 * DEMO 簡報編輯器的格式列：選取投影片上的文字／圖塊／圖片後，調整字體、字級、文字顏色、
 * 圖塊顏色、背景顏色，並匯入、拖曳、縮放圖片。格式存在 slide.fmt，圖片位置存在 slide.images。
 */
import {
  FONT_OPTIONS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  MAX_SLIDE_IMAGES,
  normColor,
} from './demo-deck.js';
import { compressImageFile, newImageId, putDeckImage } from './demo-deck-images.js';
import { escapeHTML } from './utils.js';

const SLIDE_PT = 960;

function rgbToHex(rgb, fallback = '#000000') {
  const m = String(rgb || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m || (m[4] != null && Number(m[4]) === 0)) return fallback;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

export function formatBarHtml() {
  const fonts = FONT_OPTIONS.map((f) => `<option value="${escapeHTML(f.key)}">${escapeHTML(f.label)}</option>`).join('');
  return `
    <div class="dk-fmt" id="dkFmt">
      <span class="dk-fmt-group" data-g="text">
        <span class="dk-fmt-label">文字</span>
        <select class="field" data-f="font" title="字體">${fonts}</select>
        <button type="button" class="dk-fmt-btn" data-f="size-" title="縮小字級">A−</button>
        <input type="number" class="field dk-fmt-size" data-f="size" min="${FONT_SIZE_MIN}" max="${FONT_SIZE_MAX}" step="1" title="字級（pt，和 PowerPoint 相同）">
        <button type="button" class="dk-fmt-btn" data-f="size+" title="放大字級">A+</button>
        <label class="dk-swatch" title="文字顏色"><span>色</span><input type="color" data-f="color"></label>
        <button type="button" class="dk-fmt-btn" data-f="text-reset" title="清除這段文字的格式">清除</button>
      </span>
      <span class="dk-fmt-group" data-g="block">
        <span class="dk-fmt-label">圖塊</span>
        <label class="dk-swatch" title="圖塊顏色"><span>填色</span><input type="color" data-f="fill"></label>
        <button type="button" class="dk-fmt-btn" data-f="block-reset" title="恢復預設圖塊顏色">清除</button>
      </span>
      <span class="dk-fmt-group" data-g="slide">
        <span class="dk-fmt-label">本頁</span>
        <label class="dk-swatch" title="背景顏色"><span>背景</span><input type="color" data-f="bg"></label>
        <button type="button" class="dk-fmt-btn" data-f="bg-reset" title="恢復預設背景">清除</button>
      </span>
      <span class="dk-fmt-group" data-g="deck">
        <span class="dk-fmt-label">整份字體</span>
        <select class="field" data-f="deck-font" title="整份簡報的預設字體">${fonts}</select>
      </span>
      <span class="dk-fmt-group" data-g="image">
        <button type="button" class="dk-fmt-btn" data-f="img-add" title="也可以直接貼上（Ctrl+V）或把圖片拖到投影片上">＋ 匯入圖片</button>
        <input type="file" accept="image/*" multiple hidden data-f="img-file">
        <button type="button" class="dk-fmt-btn" data-f="img-bg" hidden>設為背景</button>
        <button type="button" class="dk-fmt-btn" data-f="img-front" hidden>移到最上層</button>
        <button type="button" class="dk-fmt-btn danger" data-f="img-del" hidden>刪除圖片</button>
      </span>
      <span class="dk-fmt-hint" data-f="hint"></span>
    </div>`;
}

/**
 * @param {HTMLElement} bar  formatBarHtml() 的容器
 * @param {HTMLElement} stage 編輯中的投影片容器
 * @param {{getDeck:()=>object|null, getIndex:()=>number, images:Map<string,string>, onChange:()=>void, toast:(m:string)=>void, keyTarget:HTMLElement}} deps
 */
export function mountDeckFormatBar(bar, stage, { getDeck, getIndex, images, onChange, toast, keyTarget }) {
  const sel = { path: '', block: '', img: -1 };
  const f = (name) => bar.querySelector(`[data-f="${name}"]`);
  const group = (g) => bar.querySelector(`[data-g="${g}"]`);
  const slide = () => getDeck()?.slides[getIndex()] || null;
  const rel = (path) => String(path || '').replace(/^slides\.\d+\./, '');
  const fmtOf = (s) => {
    if (!s.fmt) s.fmt = { bg: '', text: {}, blocks: {} };
    return s.fmt;
  };
  const slideEl = () => stage.querySelector('.dk-slide');
  const pathEl = () => (sel.path ? stage.querySelector(`[data-path="${CSS.escape(sel.path)}"]`) : null);
  const blockEl = () => (sel.block ? stage.querySelector(`[data-block="${CSS.escape(sel.block)}"]`) : null);
  const imgEl = () => (sel.img >= 0 ? stage.querySelector(`[data-img="${sel.img}"]`) : null);

  function setGroupEnabled(g, on) {
    group(g).classList.toggle('off', !on);
    group(g).querySelectorAll('input, select, button').forEach((el) => {
      if (el.dataset.f !== 'img-add') el.disabled = !on;
    });
  }

  function sync() {
    const s = slide();
    const deck = getDeck();
    const el = pathEl();
    const st = s && sel.path ? s.fmt?.text?.[rel(sel.path)] : null;
    setGroupEnabled('text', !!el);
    if (el) {
      const cs = getComputedStyle(el);
      const w = slideEl()?.getBoundingClientRect().width || 1;
      f('font').value = st?.font || '';
      f('size').value = st?.size || Math.round((parseFloat(cs.fontSize) / w) * SLIDE_PT);
      f('color').value = st?.color || rgbToHex(cs.color);
    }
    const b = blockEl();
    setGroupEnabled('block', !!b);
    if (b) f('fill').value = s?.fmt?.blocks?.[sel.block]?.fill || rgbToHex(getComputedStyle(b).backgroundColor, '#ffffff');
    setGroupEnabled('slide', !!s);
    if (s) f('bg').value = s.fmt?.bg || rgbToHex(getComputedStyle(slideEl() || document.body).backgroundColor, '#ffffff');
    setGroupEnabled('deck', !!deck);
    f('deck-font').value = deck?.theme?.font || '';
    const im = s?.images?.[sel.img];
    ['img-bg', 'img-front', 'img-del'].forEach((n) => (f(n).hidden = !im));
    if (im) {
      f('img-bg').textContent = im.bg ? '取消背景' : '設為背景';
      f('img-front').hidden = im.bg;
    }
    f('hint').textContent = im
      ? im.bg
        ? '背景圖片：可取消背景或刪除'
        : '拖曳移動、拉右下角縮放；Delete 刪除'
      : el
        ? ''
        : '點投影片上的文字或圖塊來調整格式';
  }

  function paintSelection() {
    stage.querySelectorAll('.dk-sel, .dk-sel-block, .dk-sel-img').forEach((n) => n.classList.remove('dk-sel', 'dk-sel-block', 'dk-sel-img'));
    pathEl()?.classList.add('dk-sel');
    blockEl()?.classList.add('dk-sel-block');
    imgEl()?.classList.add('dk-sel-img');
  }

  function afterRender() {
    const s = slide();
    if (sel.img >= 0 && !s?.images?.[sel.img]) sel.img = -1;
    if (sel.path && !pathEl()) sel.path = '';
    if (sel.block && !blockEl()) sel.block = '';
    paintSelection();
    sync();
  }

  function clear() {
    sel.path = '';
    sel.block = '';
    sel.img = -1;
  }

  function commit() {
    onChange();
  }

  function editText(fn) {
    const s = slide();
    if (!s || !sel.path) return;
    const fmt = fmtOf(s);
    const key = rel(sel.path);
    const next = { ...(fmt.text[key] || {}) };
    fn(next);
    Object.keys(next).forEach((k) => (next[k] === '' || next[k] == null) && delete next[k]);
    if (Object.keys(next).length) fmt.text[key] = next;
    else delete fmt.text[key];
    commit();
  }

  function setSize(pt) {
    const n = Math.round(Number(pt));
    if (!Number.isFinite(n)) return;
    editText((st) => (st.size = Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, n))));
  }

  /* ---- 圖片 ---- */
  async function importFiles(files) {
    const s = slide();
    const list = [...(files || [])].filter((x) => /^image\//.test(x.type));
    if (!s || !list.length) return;
    let added = 0;
    for (const file of list) {
      if ((s.images || []).length >= MAX_SLIDE_IMAGES) {
        toast(`每頁最多 ${MAX_SLIDE_IMAGES} 張圖片`);
        break;
      }
      try {
        const { dataUrl, ratio } = await compressImageFile(file);
        const id = newImageId();
        await putDeckImage(id, dataUrl);
        images.set(id, dataUrl);
        const w = 40;
        const hPct = w * ratio * (16 / 9);
        if (!s.images) s.images = [];
        s.images.push({ id, x: 30 + added * 3, y: Math.max(2, (100 - hPct) / 2) + added * 3, w, ratio, bg: false });
        sel.img = s.images.length - 1;
        sel.path = '';
        sel.block = '';
        added++;
      } catch (e) {
        toast(`圖片匯入失敗：${e?.message || e}`);
      }
    }
    if (added) {
      commit();
      toast(`已加入 ${added} 張圖片`);
    }
  }

  function imageAction(kind) {
    const s = slide();
    const im = s?.images?.[sel.img];
    if (!im) return;
    if (kind === 'del') {
      s.images.splice(sel.img, 1);
      sel.img = -1;
    } else if (kind === 'bg') {
      if (!im.bg && s.images.some((x) => x.bg)) s.images.forEach((x) => (x.bg = false));
      im.bg = !im.bg;
    } else if (kind === 'front') {
      s.images.splice(sel.img, 1);
      s.images.push(im);
      sel.img = s.images.length - 1;
    }
    commit();
  }

  function startDrag(e, el, resize) {
    const s = slide();
    const idx = Number(el.dataset.img);
    const im = s?.images?.[idx];
    const box = slideEl()?.getBoundingClientRect();
    if (!im || im.bg || !box) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, ix: im.x, iy: im.y, iw: im.w };
    let moved = false;
    const move = (ev) => {
      const dx = ((ev.clientX - start.x) / box.width) * 100;
      const dy = ((ev.clientY - start.y) / box.height) * 100;
      if (Math.abs(dx) + Math.abs(dy) > 0.2) moved = true;
      if (resize) {
        im.w = Math.min(100, Math.max(3, Math.round((start.iw + dx) * 10) / 10));
        el.style.width = `${im.w}%`;
      } else {
        im.x = Math.min(100, Math.max(-50, Math.round((start.ix + dx) * 10) / 10));
        im.y = Math.min(100, Math.max(-50, Math.round((start.iy + dy) * 10) / 10));
        el.style.left = `${im.x}%`;
        el.style.top = `${im.y}%`;
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) commit();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---- 事件 ---- */
  stage.addEventListener('pointerdown', (e) => {
    const img = e.target.closest('[data-img]');
    if (img) {
      sel.img = Number(img.dataset.img);
      sel.path = '';
      sel.block = '';
      paintSelection();
      sync();
      if (!img.classList.contains('bg')) startDrag(e, img, !!e.target.closest('[data-img-resize]'));
      keyTarget?.focus({ preventScroll: true });
      return;
    }
    const p = e.target.closest('[data-path]');
    const b = e.target.closest('[data-block]');
    sel.img = -1;
    sel.path = p?.dataset.path || '';
    sel.block = b?.dataset.block || '';
    paintSelection();
    sync();
  });
  stage.addEventListener('focusin', (e) => {
    const p = e.target.closest('[data-path]');
    if (!p || p.dataset.path === sel.path) return;
    sel.path = p.dataset.path;
    sel.block = p.closest('[data-block]')?.dataset.block || '';
    sel.img = -1;
    paintSelection();
    sync();
  });

  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-f]');
    if (!b || b.disabled) return;
    const s = slide();
    switch (b.dataset.f) {
      case 'size-':
        return setSize(Number(f('size').value || 16) - 2);
      case 'size+':
        return setSize(Number(f('size').value || 16) + 2);
      case 'text-reset':
        return editText((st) => Object.keys(st).forEach((k) => delete st[k]));
      case 'block-reset':
        if (s && sel.block) delete fmtOf(s).blocks[sel.block];
        return commit();
      case 'bg-reset':
        if (s) fmtOf(s).bg = '';
        return commit();
      case 'img-add':
        return f('img-file').click();
      case 'img-bg':
        return imageAction('bg');
      case 'img-front':
        return imageAction('front');
      case 'img-del':
        return imageAction('del');
      default:
    }
  });
  // 按格式列不要讓投影片上的文字失去選取
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) e.preventDefault();
  });

  f('font').addEventListener('change', () => editText((st) => (st.font = f('font').value)));
  f('size').addEventListener('change', () => setSize(f('size').value));
  f('color').addEventListener('input', () => editText((st) => (st.color = normColor(f('color').value))));
  f('fill').addEventListener('input', () => {
    const s = slide();
    const fill = normColor(f('fill').value);
    if (!s || !sel.block || !fill) return;
    fmtOf(s).blocks[sel.block] = { fill };
    commit();
  });
  f('bg').addEventListener('input', () => {
    const s = slide();
    if (!s) return;
    fmtOf(s).bg = normColor(f('bg').value);
    commit();
  });
  f('deck-font').addEventListener('change', () => {
    const deck = getDeck();
    if (!deck) return;
    deck.theme = { ...(deck.theme || {}), font: f('deck-font').value };
    commit();
  });
  f('img-file').addEventListener('change', () => {
    const files = [...f('img-file').files];
    f('img-file').value = '';
    importFiles(files);
  });

  stage.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) {
      e.preventDefault();
      stage.classList.add('dk-drop');
    }
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('dk-drop'));
  stage.addEventListener('drop', (e) => {
    stage.classList.remove('dk-drop');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    importFiles(e.dataTransfer.files);
  });
  keyTarget?.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((x) => /^image\//.test(x.type));
    if (!files.length) return;
    e.preventDefault();
    importFiles(files);
  });
  keyTarget?.addEventListener('keydown', (e) => {
    if (sel.img < 0 || (e.key !== 'Delete' && e.key !== 'Backspace')) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="plaintext-only"]')) return;
    e.preventDefault();
    imageAction('del');
  });

  sync();
  return { afterRender, clear, importFiles };
}
