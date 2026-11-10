export const MIN_SPLIT_RATIO = 0.24;
export const MAX_SPLIT_RATIO = 0.76;
export const DEFAULT_SPLIT_RATIO = 0.5;

export function clampSplitRatio(ratio) {
  const value = Number(ratio);
  if (!Number.isFinite(value)) return DEFAULT_SPLIT_RATIO;
  return Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, value));
}

export function createViewerState() {
  return {
    open: false,
    mode: 'single',
    activePane: 'left',
    splitRatio: DEFAULT_SPLIT_RATIO,
    left: null,
    right: null,
  };
}

export function pageFromSlot(slot = {}) {
  const url = String(slot.url ?? '').trim();
  if (!url) return null;
  return {
    title: String(slot.title ?? '').trim() || url,
    url,
  };
}

/** Decide where the next page should land when a slot is opened. */
export function assignOpenTarget(state, page, preferredPane = '') {
  const next = {
    ...state,
    left: state.left ? { ...state.left } : null,
    right: state.right ? { ...state.right } : null,
  };
  next.open = true;

  if (!page) return next;

  if (preferredPane === 'right' || (state.mode === 'split' && preferredPane !== 'left')) {
    next.mode = 'split';
    next.right = page;
    next.activePane = 'right';
    if (!next.left) next.left = state.left;
    return next;
  }

  if (preferredPane === 'left') {
    next.left = page;
    next.activePane = 'left';
    if (state.mode === 'split') next.mode = 'split';
    return next;
  }

  if (!state.open || !state.left) {
    next.mode = 'single';
    next.left = page;
    next.right = null;
    next.activePane = 'left';
    return next;
  }

  if (state.mode === 'single') {
    next.mode = 'split';
    next.right = page;
    next.activePane = 'right';
    return next;
  }

  if (state.activePane === 'right') {
    next.right = page;
    next.activePane = 'right';
  } else {
    next.left = page;
    next.activePane = 'left';
  }
  return next;
}

export function setViewerMode(state, mode) {
  const next = {
    ...state,
    left: state.left ? { ...state.left } : null,
    right: state.right ? { ...state.right } : null,
    mode: mode === 'split' ? 'split' : 'single',
  };
  if (next.mode === 'single') {
    next.right = null;
    next.activePane = 'left';
  } else if (!next.right && next.left) {
    next.activePane = 'right';
  }
  return next;
}

export function closeViewerPane(state, pane) {
  const next = {
    ...state,
    left: state.left ? { ...state.left } : null,
    right: state.right ? { ...state.right } : null,
  };
  if (pane === 'right') {
    next.right = null;
    next.mode = 'single';
    next.activePane = 'left';
    if (!next.left) next.open = false;
    return next;
  }
  if (pane === 'left') {
    if (next.right) {
      next.left = next.right;
      next.right = null;
      next.mode = 'single';
      next.activePane = 'left';
      return next;
    }
    next.left = null;
    next.open = false;
    next.mode = 'single';
    return next;
  }
  return createViewerState();
}

export function ratioFromPointer(clientX, bounds) {
  if (!bounds || bounds.width <= 0) return DEFAULT_SPLIT_RATIO;
  return clampSplitRatio((clientX - bounds.left) / bounds.width);
}
