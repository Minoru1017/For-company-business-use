export const SLOT_COUNT = 16;
export const WORKSPACE_KEY = 'workHomepage';

function cleanText(value, maxLength) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

export function normalizeWebUrl(value) {
  const input = String(value ?? '').trim();
  if (!input) return '';
  const candidate = /^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`;

  try {
    const parsed = new URL(candidate);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

export function createEmptySlot() {
  return {
    url: '',
    title: '',
    group: '',
    routine: '',
    step: 0,
    thumbnail: '',
  };
}

export function normalizeSlot(rawSlot = {}) {
  const url = normalizeWebUrl(rawSlot.url);
  const thumbnail = String(rawSlot.thumbnail ?? '');
  return {
    url,
    title: url ? cleanText(rawSlot.title, 60) || new URL(url).hostname : '',
    group: url ? cleanText(rawSlot.group, 24) : '',
    routine: url ? cleanText(rawSlot.routine, 24) : '',
    step: url ? Math.max(0, Math.min(99, Number.parseInt(rawSlot.step, 10) || 0)) : 0,
    thumbnail:
      url && /^data:image\/(?:jpeg|png|webp);base64,/.test(thumbnail) ? thumbnail : '',
  };
}

export function normalizeWorkspace(rawWorkspace = {}) {
  const sourceSlots = Array.isArray(rawWorkspace.slots) ? rawWorkspace.slots : [];
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) =>
    normalizeSlot(sourceSlots[index]),
  );
  return { slots };
}

export function addPageToFirstEmptySlot(workspace, page) {
  const normalized = normalizeWorkspace(workspace);
  const index = normalized.slots.findIndex((slot) => !slot.url);
  if (index < 0) return { workspace: normalized, index: -1 };

  normalized.slots[index] = normalizeSlot(page);
  return { workspace: normalized, index };
}

export function moveSlot(workspace, fromIndex, toIndex) {
  const normalized = normalizeWorkspace(workspace);
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= SLOT_COUNT ||
    toIndex >= SLOT_COUNT ||
    fromIndex === toIndex
  ) {
    return normalized;
  }

  const [slot] = normalized.slots.splice(fromIndex, 1);
  normalized.slots.splice(toIndex, 0, slot);
  return normalized;
}

export function getWorkspaceGroups(workspace) {
  return [
    ...new Set(
      normalizeWorkspace(workspace)
        .slots.map((slot) => slot.group)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export function getWorkspaceRoutines(workspace) {
  return [
    ...new Set(
      normalizeWorkspace(workspace)
        .slots.map((slot) => slot.routine)
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export function getRoutineSlots(workspace, routine) {
  return normalizeWorkspace(workspace)
    .slots.map((slot, index) => ({ ...slot, position: index + 1 }))
    .filter((slot) => slot.url && slot.routine === routine)
    .sort((a, b) => {
      const stepA = a.step || Number.MAX_SAFE_INTEGER;
      const stepB = b.step || Number.MAX_SAFE_INTEGER;
      return stepA - stepB || a.position - b.position;
    });
}

export function getRoutinePlan(workspace, routine) {
  const slots = routine ? getRoutineSlots(workspace, routine) : [];
  return {
    slots,
    summary: slots.length
      ? `將依序開啟 ${slots.length} 個網站：${slots.map((slot) => slot.title).join(' → ')}`
      : '編輯網站時，可填寫流程名稱與步驟順位。',
  };
}
