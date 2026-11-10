export const SLOT_COUNT = 16;
export const WORKSPACE_KEY = 'workHomepage';
export const DEFAULT_AREAS = Object.freeze([
  { id: 'work', name: '工作' },
  { id: 'interest', name: '興趣' },
  { id: 'entertainment', name: '影視' },
]);
export const MAX_AREAS = 8;

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
    favicon: '',
  };
}

export function normalizeSlot(rawSlot = {}) {
  const url = normalizeWebUrl(rawSlot.url);
  const thumbnail = String(rawSlot.thumbnail ?? '');
  const favicon = String(rawSlot.favicon ?? '');
  return {
    url,
    title: url ? cleanText(rawSlot.title, 60) || new URL(url).hostname : '',
    group: url ? cleanText(rawSlot.group, 24) : '',
    routine: url ? cleanText(rawSlot.routine, 24) : '',
    step: url ? Math.max(0, Math.min(99, Number.parseInt(rawSlot.step, 10) || 0)) : 0,
    thumbnail:
      url && /^data:image\/(?:jpeg|png|webp);base64,/.test(thumbnail) ? thumbnail : '',
    favicon:
      url && /^(?:data:image\/(?:x-icon|vnd\.microsoft\.icon|png|jpeg|webp|svg\+xml);base64,|https?:\/\/)/.test(
        favicon,
      )
        ? favicon
        : '',
  };
}

export function normalizeWorkspace(rawWorkspace = {}) {
  const sourceSlots = Array.isArray(rawWorkspace.slots) ? rawWorkspace.slots : [];
  const slots = Array.from({ length: SLOT_COUNT }, (_, index) =>
    normalizeSlot(sourceSlots[index]),
  );
  return { slots };
}

function normalizeAreaId(value) {
  return String(value ?? '').trim().replace(/[^a-z\d-]/gi, '').slice(0, 36);
}

function normalizeAreaName(value) {
  return cleanText(value, 12);
}

export function normalizeHomepage(rawHomepage = {}) {
  const rawAreas = Array.isArray(rawHomepage.areas) ? rawHomepage.areas : [];
  const seenIds = new Set();
  const areas = rawAreas
    .map((area) => {
      const id = normalizeAreaId(area?.id);
      const name = normalizeAreaName(area?.name);
      if (!id || !name || seenIds.has(id)) return null;
      seenIds.add(id);
      return { id, name, ...normalizeWorkspace(area) };
    })
    .filter(Boolean)
    .slice(0, MAX_AREAS);

  DEFAULT_AREAS.forEach((defaultArea, index) => {
    if (seenIds.has(defaultArea.id)) return;
    const legacyWorkspace =
      defaultArea.id === 'work' && !rawAreas.length
        ? normalizeWorkspace(rawHomepage)
        : normalizeWorkspace();
    areas.splice(Math.min(index, areas.length), 0, { ...defaultArea, ...legacyWorkspace });
    seenIds.add(defaultArea.id);
  });

  const activeAreaId = areas.some((area) => area.id === rawHomepage.activeAreaId)
    ? rawHomepage.activeAreaId
    : 'work';
  return { version: 2, activeAreaId, areas: areas.slice(0, MAX_AREAS) };
}

export function getAreaWorkspace(homepage, areaId) {
  const normalized = normalizeHomepage(homepage);
  const area = normalized.areas.find((item) => item.id === areaId) ?? normalized.areas[0];
  return normalizeWorkspace(area);
}

export function updateAreaWorkspace(homepage, areaId, workspace) {
  const normalized = normalizeHomepage(homepage);
  return {
    ...normalized,
    activeAreaId: areaId,
    areas: normalized.areas.map((area) =>
      area.id === areaId ? { id: area.id, name: area.name, ...normalizeWorkspace(workspace) } : area,
    ),
  };
}

export function createHomepageArea(homepage, name) {
  const normalized = normalizeHomepage(homepage);
  const cleanName = normalizeAreaName(name);
  if (!cleanName || normalized.areas.length >= MAX_AREAS) return normalized;
  const baseId =
    cleanName
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z\d]+/g, '-')
      .replace(/^-|-$/g, '') || `area-${Date.now().toString(36)}`;
  let id = baseId;
  let suffix = 2;
  while (normalized.areas.some((area) => area.id === id)) id = `${baseId}-${suffix++}`;
  return {
    ...normalized,
    activeAreaId: id,
    areas: [...normalized.areas, { id, name: cleanName, ...normalizeWorkspace() }],
  };
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
