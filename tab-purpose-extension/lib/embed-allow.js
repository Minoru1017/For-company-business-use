/** Rule IDs reserved for allowing homepage iframes to embed third-party sites. */
export const EMBED_ALLOW_RULE_ID = 91001;

export function buildEmbedAllowRules(extensionId) {
  const initiator = String(extensionId ?? '').trim();
  if (!initiator) return [];

  return [
    {
      id: EMBED_ALLOW_RULE_ID,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
          { header: 'content-security-policy-report-only', operation: 'remove' },
        ],
      },
      condition: {
        resourceTypes: ['sub_frame'],
        initiatorDomains: [initiator],
      },
    },
  ];
}

export async function installEmbedAllowRules(api = globalThis.chrome) {
  const rules = buildEmbedAllowRules(api?.runtime?.id);
  if (!rules.length || !api?.declarativeNetRequest?.updateDynamicRules) {
    return { installed: false, ruleIds: [] };
  }

  const existing = await api.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing
    .map((rule) => rule.id)
    .filter((id) => id === EMBED_ALLOW_RULE_ID);

  await api.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules: rules,
  });

  return { installed: true, ruleIds: rules.map((rule) => rule.id) };
}
