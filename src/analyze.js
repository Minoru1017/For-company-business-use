import { buildPurposeProfile } from './purpose-types.js';
import { DEEP_REASONING_META } from './purpose-reasoning.js';
import { detectKeyMoments } from './key-moments.js';
import { buildLayerHits, evaluateManualRules } from './manual-check.js';
import { RULES } from './rules.js';
import { isQuestion } from './speaker.js';
import { escapeHTML, fmt } from './utils.js';

function ev(s) {
  const text = s.text.length > 50 ? `${s.text.slice(0, 50)}…` : s.text;
  return `<span class="ev">[${fmt(s.start)}] ${escapeHTML(text)}</span>`;
}

export function runAnalysis(segs) {
  const S = segs.filter((s) => s.spk === 'S');
  const C = segs.filter((s) => s.spk === 'C');
  const sChars = S.reduce((a, s) => a + s.chars, 0);
  const cChars = C.reduce((a, s) => a + s.chars, 0);
  const custRatio = cChars / (sChars + cChars || 1);
  const totalDur = segs.length ? segs[segs.length - 1].end - segs[0].start : 0;
  const sQuestions = S.filter((s) => isQuestion(s.text));
  const good = [];
  const bad = [];
  const sug = [];

  if (custRatio >= 0.45) {
    good.push(`<b>客戶說話比例 ${Math.round(custRatio * 100)}%</b>——客戶願意開口，掌握「讓客戶多說」的原則`);
  } else if (custRatio >= 0.3) {
    bad.push(`客戶說話比例 ${Math.round(custRatio * 100)}%，偏低——業務講太多，客戶還沒被打開`);
    sug.push(
      '提高客戶開口量：每講完一段就停，丟開放式問題。<span class="q">「你目前遇到最想解決的一件事是什麼？」</span>問完就閉嘴等答案'
    );
  } else {
    bad.push(`<b>客戶說話比例僅 ${Math.round(custRatio * 100)}%</b>——幾乎是業務獨角戲，手冊第一條就是讓客戶主動說出問題`);
    sug.push(
      '下一通把前 5 分鐘目標設為「客戶說滿一半」：用<span class="q">「方便先了解一下你的狀況嗎？」</span>開場，之後每個問題只問一句、不補充'
    );
  }

  const shortReplies = C.filter((s) => s.chars <= 4).length;
  if (C.length && shortReplies / C.length > 0.5) {
    bad.push(`客戶有 ${shortReplies}/${C.length} 句是 4 字以內的短回應（嗯、好、對）——代表多在被動附和`);
    sug.push('把封閉問句改開放：不問<span class="q">「有在用 AI 嗎？」</span>改問<span class="q">「你平常都用 AI 做哪些事？」</span>');
  }

  const stepHit = {};
  RULES.steps.forEach((st) => {
    if (st.key === 'discovery') {
      stepHit[st.key] = sQuestions.length >= 3 ? sQuestions[0] : null;
      return;
    }
    stepHit[st.key] = S.find((s) => st.re.test(s.text)) || null;
  });

  const stepNames = { connect: '連結', discovery: '挖掘', clarify: '釐清', diagnose: '判斷', recommend: '對接', decision: '決策' };
  const doneSteps = Object.keys(stepHit).filter((k) => stepHit[k]);
  if (doneSteps.length >= 5) {
    good.push(`六步驟完成 <b>${doneSteps.length}/6</b>：${doneSteps.map((k) => stepNames[k]).join('、')}——「理解需求→判斷適配→幫助決策」骨架完整`);
  } else if (doneSteps.length >= 3) {
    good.push(`六步驟完成 ${doneSteps.length}/6（${doneSteps.map((k) => stepNames[k]).join('、')}）`);
  }

  Object.keys(stepHit).forEach((k) => {
    if (stepHit[k]) return;
    if (k === 'clarify') {
      bad.push('<b>Step 3 釐清未偵測到</b>——沒幫客戶看清「本質＋不改變的代價」（注意：是讓問題變清楚，不是製造恐懼）');
      sug.push('釐清句型（現況成本 vs 改變價值，引導客戶自己說）：<span class="q">「如果一直這樣下去，對你影響最大的是什麼？」</span>');
    }
    if (k === 'diagnose') {
      bad.push('<b>Step 4 判斷未偵測到</b>——沒做適配判斷（A 適合／B 部分適合／C 不適合）。手冊：這是顧問的核心價值，不是一定要賣');
      sug.push('判斷句型：<span class="q">「依照你剛說的＿＿、＿＿、＿＿，我評估我們的＿＿方案適合／部分適合／目前不適合你，因為＿＿。」</span>');
    }
    if (k === 'recommend') {
      bad.push('Step 5 對接未偵測到——適合的方案價值沒有對到他的問題');
      sug.push('對接公式＝精準對接不介紹全部：<span class="q">「你剛提到＿＿最卡，我們＿＿方案裡的＿＿就是處理這段，所以適合你，因為＿＿。」</span>');
    }
    if (k === 'decision') {
      bad.push('<b>Step 6 決策未偵測到</b>——沒有處理真實疑慮、協助做出清楚決定（不是逼單，但也不能沒收尾）');
      sug.push('決策收尾：<span class="q">「你目前最主要的考量是＿＿對嗎？我幫你比較一下兩個做法…那我們下一步約＿＿或＿＿，你方便哪個？」</span>');
    }
    if (k === 'connect') bad.push('Step 1 連結未偵測到——開場沒建立安全感，客戶不會說真話');
    if (k === 'discovery') bad.push(`Step 2 挖掘不足——業務問句僅 ${sQuestions.length} 句（現況/目標/問題/動機/限制要問到能判斷為止）`);
  });

  const fitASeg = S.find((s) => RULES.fitA.test(s.text));
  const fitCSeg = S.find((s) => RULES.fitC.test(s.text));
  const prodSeg = S.find((s) => RULES.products.test(s.text));
  if (fitASeg) good.push(`有做<b>適配判斷（A 適合）</b>並附理由——「照著 A、B、C 我認為＿＿方案適合，因為＿＿」的結構有出來 ${ev(fitASeg)}`);
  if (fitCSeg) good.push(`有做<b>「敢不賣」的判斷（C 不適合）</b>——坦白告知目前不建議，正是手冊說的顧問價值 ${ev(fitCSeg)}`);
  if (!fitASeg && !fitCSeg && stepHit.recommend) {
    bad.push('<b>有推方案但沒有明講適配結論與理由</b>——手冊要求推薦時說清楚「為什麼這個方案適合你」');
    sug.push('推薦前先給結論：<span class="q">「依照你的狀況我判斷是＿＿（高度適合／部分適合），因為＿＿，所以我只推薦＿＿，其他部分你目前不需要。」</span>');
  }
  if (prodSeg) good.push(`有對接到公司產品（企業 AI 落地培訓營／一對一諮詢）${ev(prodSeg)}`);

  const firstPitchIdx = segs.findIndex((s) => s.spk === 'S' && (RULES.steps[4].re.test(s.text) || RULES.products.test(s.text)));
  if (firstPitchIdx >= 0) {
    const qBefore = segs.slice(0, firstPitchIdx).filter((s) => s.spk === 'S' && isQuestion(s.text)).length;
    if (qBefore < 3) {
      bad.push(`<b>常見錯誤：急著介紹產品</b>——第一次提到方案前只問了 ${qBefore} 個問題（[${fmt(segs[firstPitchIdx].start)}] 就開始講方案）。手冊：先理解 → 再判斷 → 再建議`);
      sug.push('把方案往後挪：至少完成現況、問題、影響三層提問，再開口講方案。開場先用<span class="q">「你現在大概是什麼狀況？」</span>');
    } else {
      good.push(`沒有急著介紹產品——第一次提方案前已完成 ${qBefore} 個提問，符合「先理解再判斷再建議」`);
    }
  }

  const layerHits = buildLayerHits(segs);
  const deepest = layerHits.filter((L) => L.hit).length ? Math.max(...layerHits.filter((L) => L.hit).map((L) => L.n)) : 0;
  const convergeSeg = S.find((s) => RULES.converge.test(s.text));
  const convergeHint = convergeSeg
    ? `<span class="mk on">●</span> 完成標準驗證：[${fmt(convergeSeg.start)}]「${escapeHTML(convergeSeg.text)}」`
    : '<span class="mk off">○</span> 未偵測到完成標準——手冊：要能說出「<b>所以你真正想解決的是＿＿，因為＿＿；你真正需要的是＿＿，我理解對嗎？</b>」客戶說「對」才算挖到位';

  if (deepest >= 5) good.push('五層資訊<b>挖到 L5（未來）</b>——現況/問題/影響/動機/未來的資訊鏈完整，足以做適配判斷');
  else if (deepest >= 3) {
    bad.push(`五層資訊只到第 ${deepest} 層——手冊標準：不是問滿 5 層，而是<b>資訊完整到能判斷為止</b>，目前還不足以做 A/B/C 判斷`);
    layerHits.filter((L) => !L.hit).forEach((L) => sug.push(`${L.name} 補問：<span class="q">「${L.sug.split('：')[1] || L.sug}」</span>`));
  } else {
    bad.push(`<b>五層資訊僅到第 ${deepest} 層</b>——資訊不足就推方案，會變成「看到關鍵字就替客戶下結論」`);
    layerHits
      .filter((L) => !L.hit)
      .slice(0, 3)
      .forEach((L) => sug.push(L.sug.includes('：') ? `${L.name}：<span class="q">${L.sug.split('：')[1]}</span>` : L.sug));
  }
  if (convergeSeg) good.push(`有做<b>完成標準驗證</b>——確認了「真正想解決的＋因為＋真正需要的」${ev(convergeSeg)}`);
  else sug.push('挖掘收尾必說：<span class="q">「所以你真正想解決的是＿＿，因為＿＿；你真正需要的是＿＿，我理解對嗎？」</span>客戶說「對」，才進判斷');

  const purposeProfile = buildPurposeProfile(segs);

  if (purposeProfile.classified) {
    const types = purposeProfile.signals.map((t) => t.label).join('、');
    const dom = purposeProfile.dominant;
    good.push(
      `已判斷客戶學 AI 的目的類型：<b>${types}</b>（主導：<b>${dom.label}</b> — ${dom.purpose}）${dom.evidence ? ev(dom.evidence) : ''}`
    );
    if (purposeProfile.secondary) {
      good.push(`次要目的類型：<b>${purposeProfile.secondary.label}</b> — ${purposeProfile.secondary.purpose}`);
    }
    if (purposeProfile.matchedAmplify) {
      good.push(`強化語言符合「${dom.label}」類型 ${ev(purposeProfile.matchedAmplify)}`);
    } else {
      bad.push(`尚未用「${dom.label}」類型的語言做強化 — ${dom.amplify}`);
      sug.push(
        `${dom.label} 強化：<span class="q">「${dom.amplifyExample}」</span>（須引用客戶原話，不可自創恐懼）`
      );
    }
    if (purposeProfile.matchedPitch) {
      good.push(`對接話術符合「${dom.label}」類型 — 用客戶想聽的話 ${ev(purposeProfile.matchedPitch)}`);
    } else if (stepHit.recommend || prodSeg) {
      bad.push(`有推方案，但對接話術尚未對準「${dom.label}」類型`);
      sug.push(`${dom.label} 對接：<span class="q">「${dom.pitch}」</span>`);
    } else {
      sug.push(`${dom.label} 對接預備：<span class="q">「${dom.pitch}」</span>`);
    }
    if (purposeProfile.deepReasoning?.ambiguous) {
      bad.push(
        `「${purposeProfile.deepReasoning.ambiguousTypes.join('」與「')}」訊號都強——深層推理尚未收斂，勿急著選一邊強化`
      );
      sug.push(
        `收斂驗證：<span class="q">「所以你真正在意的是＿＿（補缺口／避風險／進圈子／被看重／有意義），我理解對嗎？」</span>`
      );
    } else if (purposeProfile.deepReasoning?.ready) {
      const chain = purposeProfile.deepReasoning.chains[0];
      if (chain?.confidence === 'low') {
        bad.push(`「${dom.label}」深層推理信心偏低——目前多為表面詞，需再問：${DEEP_REASONING_META[dom.key]?.deepQuestion || dom.probe}`);
      } else {
        good.push(`「${dom.label}」深層推理：${purposeProfile.deepReasoning.summary}`);
      }
    }
  } else {
    bad.push('尚未判斷客戶學 AI 的目的類型（要／怕／想／愛／爽）——挖掘還沒碰到客戶真正在意的點');
    sug.push(
      '用五層挖掘後，從客戶原話判斷目的類型，再分別強化、用他想聽的話對接。可先問：<span class="q">「你現在最缺的是什麼？」</span>或<span class="q">「你最擔心的是什麼？」</span>'
    );
  }

  const painUse = S.find((s) => RULES.painPattern.test(s.text));
  const gainUse = S.find((s) => RULES.gainPattern.test(s.text));
  if (painUse && !purposeProfile.matchedAmplify) good.push(`有使用通用強化句型「沒有…就會…」${ev(painUse)}`);
  if (gainUse && !purposeProfile.matchedAmplify) good.push(`有使用通用強化句型「如果能…就能…」${ev(gainUse)}`);

  const fearSegs = S.filter((s) => RULES.fearWords.test(s.text));
  if (fearSegs.length) bad.push(`<b>偵測到 ${fearSegs.length} 句可能屬「製造恐懼」的用語</b>——手冊底線：只能放大客戶自己說過的困擾，不能自己嚇客戶 ${ev(fearSegs[0])}`);
  else good.push('未偵測到恐嚇式話術——符合手冊底線「強化不是製造恐懼」');

  const fiveMiss = RULES.five.filter((F) => !segs.some((s) => F.re.test(s.text)));
  const fiveHit = RULES.five.length - fiveMiss.length;
  const hasFit = !!(fitASeg || fitCSeg || stepHit.diagnose);
  if (fiveHit >= 4 && hasFit) good.push(`五力檢核 <b>${fiveHit}/5 蒐集＋適配判斷完成</b>——前五項是蒐集資訊，第六項判斷才是顧問核心價值，這通有做到`);
  else if (fiveHit >= 4) good.push(`五力資訊蒐集 ${fiveHit}/5——資訊夠了，但別忘了第六項：明講適配判斷與理由`);
  else {
    bad.push(`五力指標只蒐集到 ${fiveHit}/5——資訊不完整，第六項「適配判斷」會變成瞎猜`);
    fiveMiss.forEach((F) => sug.push(`${F.sug.split('：')[0]}：<span class="q">${F.sug.split('：')[1]}</span>`));
  }

  const manualChecks = evaluateManualRules(segs, { layerHits, convergeSeg, sQuestions, purposeProfile });
  const keyMoments = detectKeyMoments(segs);

  const strip = (h) => h.replace(/<[^>]+>/g, '');
  const reportText = `【電訪分析報告】\n通話長度 ${fmt(totalDur)}｜客戶說話比例 ${Math.round(custRatio * 100)}%｜業務提問 ${sQuestions.length} 句\n六步驟：${RULES.steps.map((st) => `${st.name}${stepHit[st.key] ? '[●]' : '[○]'}`).join(' ')}\n五層挖掘：最深到 L${deepest}｜收斂驗證${convergeSeg ? '[●]' : '[○]'}\n目的類型：${purposeProfile.dominant ? purposeProfile.dominant.label : '未判斷'}｜手冊檢核：挖掘[${manualChecks.discovery.statusLabel}]｜強化[${manualChecks.amplification.statusLabel}]\n\n[WELL DONE] 做得好\n${good.map((g) => `・${strip(g)}`).join('\n')}\n\n[IMPROVE] 待加強\n${bad.map((b) => `・${strip(b)}`).join('\n')}\n\n[SCRIPTS] 建議怎麼聊\n${sug.map((s) => `・${strip(s)}`).join('\n')}`;

  return {
    stats: { totalDur, custRatio, sQuestions: sQuestions.length, sCount: S.length, cCount: C.length, avgCustChars: C.length ? cChars / C.length : 0 },
    stepHit,
    layerHits,
    deepest,
    convergeHint,
    manualChecks,
    purposeProfile,
    keyMoments,
    good,
    bad,
    sug,
    reportText,
  };
}
