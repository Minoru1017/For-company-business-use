/** Formatted plain-text report for copy / export. */

export function stripReportHtml(html) {
  return String(html || '').replace(/<[^>]+>/g, '');
}

function bulletLines(items, strip) {
  if (!items?.length) return ['  （無）'];
  return items.map((item, i) => `  ${i + 1}. ${strip(item)}`);
}

function trustLines(trust, fmt) {
  const t = trust.trajectory || {};
  const lines = [`  信任檢核：${trust.statusLabel}`];
  if (t.levels?.length) {
    const labels = ['敷衍', '事實', '困擾', '私人'];
    lines.push(
      `  客戶揭露層級：${labels[t.startLevel] || '—'} → ${labels[t.peak] || '—'}（敷衍→事實→困擾→私人）${
        t.breakthrough ? `，信任突破於 ${fmt(t.breakthrough.start)}` : '，尚無信任突破'
      }`
    );
  }
  if (trust.wavering?.detected) {
    lines.push(`  搖擺型客戶（需求可有可無、不缺錢時間）：${trust.wavering.handled ? '已用想／愛／爽試探或敢判 C [●]' : '未試探動機 [○]'}`);
  }
  return lines;
}

export function formatReportText({
  stats,
  stepHit,
  deepest,
  convergeSeg,
  purposeProfile,
  manualChecks,
  good,
  bad,
  sug,
  fmt,
  RULES,
}) {
  const hr = '═'.repeat(44);
  const lines = [
    hr,
    '  電訪分析報告',
    hr,
    '',
    '■ 通話摘要',
    `  通話長度：${fmt(stats.totalDur)}`,
    `  客戶說話比例：${Math.round(stats.custRatio * 100)}%`,
    `  業務提問：${stats.sQuestions} 句`,
    `  業務句數：${stats.sCount}｜客戶句數：${stats.cCount}`,
    '',
    '■ 六步驟檢核',
    ...RULES.steps.map(
      (st) => `  ${st.name}${stepHit[st.key] ? ' [●]' : ' [○]'}`
    ),
    '',
    '■ 五層挖掘與收斂',
    `  最深層級：L${deepest}`,
    `  收斂驗證：${convergeSeg ? '已完成 [●]' : '尚未完成 [○]'}`,
    '',
    '■ 目的類型與手冊檢核',
    `  主導類型：${purposeProfile.dominant ? purposeProfile.dominant.label : '未判斷'}`,
    `  挖掘檢核：${manualChecks.discovery.statusLabel}`,
    `  強化檢核：${manualChecks.amplification.statusLabel}`,
    ...(manualChecks.trust ? trustLines(manualChecks.trust, fmt) : []),
    '',
    '■ 做得好',
    ...bulletLines(good, stripReportHtml),
    '',
    '■ 待加強',
    ...bulletLines(bad, stripReportHtml),
    '',
    '■ 建議怎麼聊',
    ...bulletLines(sug, stripReportHtml),
    '',
    hr,
  ];
  return lines.join('\n');
}

export function appendAIReportSection(reportText, aiResult) {
  const j = aiResult || {};
  const hr = '─'.repeat(44);
  const lines = [
    '',
    hr,
    '  AI 深度分析',
    hr,
    '',
    '■ 總評',
    `  ${j.summary || '（無）'}`,
    '',
    '■ 做得好',
    ...(j.good?.length
      ? j.good.map((g, i) => `  ${i + 1}. ${g.point || ''}`)
      : ['  （無）']),
    '',
    '■ 待加強',
    ...(j.bad?.length
      ? j.bad.map((b, i) => {
          const rule = b.rule ? `（${b.rule}）` : '';
          return `  ${i + 1}. ${b.point || ''}${rule}`;
        })
      : ['  （無）']),
    '',
    '■ 建議怎麼聊',
    ...(j.suggest?.length
      ? j.suggest.map((s, i) => `  ${i + 1}. ${s.say || ''}`)
      : ['  （無）']),
    '',
    hr,
  ];
  return `${reportText}\n${lines.join('\n')}`;
}
