import { runAnalysis } from './analyze.js';
import { drawChart } from './chart.js';
import {
  buildTranscript,
  callGemini,
  chunkTranscript,
  DEFAULT_MODEL,
  extractSuggestedModel,
  FALLBACK_MODELS,
  isDeprecatedModel,
  listGeminiModels,
  MANUAL_PROMPT,
  mergeAIResults,
  pickPreferredModel,
} from './gemini.js';
import { initDrill } from './drill.js';
import {
  buildNextCallChecklist,
  buildSummaryMessage,
  copyText,
  downloadText,
  exportBaseName,
  reportTextToMarkdown,
  segsToSrt,
} from './export.js';
import { clearHistory, deleteHistory, formatSavedAt, getHistory, listHistory, saveHistory, updateHistoryReport } from './history.js';
import {
  bridgeSupports,
  checkLocalBridge,
  initLocalTranscribe,
  openBridgeFolder,
  saveReportToBridge,
} from './local-transcribe.js';
import { initModeChooser, resolveMode } from './mode.js';
import { bindLabelCollapseHandlers, createLabelController } from './labels.js';
import { applyBuiltinSpeakerLabels, enrichSegments, parse, parseVibeJson } from './parser.js';
import { bumpUsage, checkQuotaBefore, getLimit, getUsage, quotaPercent, saveUsage } from './quota.js';
import { labeledRatio } from './speaker-labels.js';
import { appendAIReportSection } from './report-format.js';
import { SAMPLE_TRANSCRIPT_NAME, SAMPLE_TRANSCRIPT_SRT } from './sample-transcript.js';
import { autoGuess } from './speaker.js';
import { animateStats, bindUI, renderAnalysisUI, showQuotaModal, showToast } from './ui.js';
import { $, escapeHTML, fmt } from './utils.js';

let segs = [];
let reportText = '';
let aiAbort = null;
let labelCtrl = null;
let lastResult = null;
let aiSummary = '';
let sourceName = 'transcript.srt';
let currentHistoryId = null;

const keyStorage = {
  get remember() {
    return localStorage.getItem('gemini_remember_key') === '1';
  },
  load() {
    if (this.remember) return localStorage.getItem('gemini_key') || '';
    return sessionStorage.getItem('gemini_key') || '';
  },
  save(value) {
    if (this.remember) localStorage.setItem('gemini_key', value);
    else {
      sessionStorage.setItem('gemini_key', value);
      localStorage.removeItem('gemini_key');
    }
  },
  clearPersisted() {
    localStorage.removeItem('gemini_key');
    sessionStorage.removeItem('gemini_key');
  },
};

function renderQuota() {
  const u = getUsage();
  const lim = getLimit($('quotaLimit').value);
  const pct = quotaPercent(u.count, lim);
  $('quotaText').textContent = u.count;
  $('quotaBar').style.width = `${pct}%`;
  $('quotaBar').style.background = pct >= 95 ? 'var(--bad)' : pct >= 80 ? 'var(--warn)' : 'var(--ok)';
  $('quotaEst').textContent = u.tokens ? `累計約 ${(u.tokens / 1000).toFixed(1)}K tokens` : '';
}

function bindUpload() {
  $('drop').onclick = () => $('file').click();
  $('drop').ondragover = (e) => {
    e.preventDefault();
    $('drop').classList.add('drag');
  };
  $('drop').ondragleave = () => $('drop').classList.remove('drag');
  $('drop').ondrop = (e) => {
    e.preventDefault();
    $('drop').classList.remove('drag');
    if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]);
  };
  $('file').onchange = () => $('file').files[0] && loadFile($('file').files[0]);
  document.querySelectorAll('[data-load-sample]').forEach((btn) => {
    btn.onclick = () => {
      if (loadTranscriptText(SAMPLE_TRANSCRIPT_SRT, SAMPLE_TRANSCRIPT_NAME)) {
        $('labelCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
  });
}

function loadTranscriptText(text, filename = 'transcript.srt') {
  const isVibe = /\.vibe\.json$/i.test(filename);
  try {
    if (isVibe) {
      segs = parseVibeJson(text);
    } else {
      segs = parse(text);
      applyBuiltinSpeakerLabels(segs);
    }
  } catch {
    $('fname').textContent = isVibe
      ? '無法解析 Vibe 檔案，請確認是 transcript.vibe.json'
      : '無法解析，請用 Vibe 的 .vibe.json、SRT/VTT 或含 [mm:ss] 的 TXT';
    return false;
  }
  if (!segs.length) {
    $('fname').textContent = '無法解析，請用 Vibe 的 .vibe.json、SRT/VTT 或含 [mm:ss] 的 TXT';
    return false;
  }
  if (labeledRatio(segs) < 0.5) autoGuess(segs);
  return finishLoad(filename, isVibe ? 'Vibe' : '逐字稿');
}

function finishLoad(filename, src) {
  enrichSegments(segs);
  sourceName = filename || 'transcript.srt';
  currentHistoryId = null;
  lastResult = null;
  aiSummary = '';
  $('fname').textContent = `已載入（${segs.length} 句，來源：${src}）`;
  labelCtrl = createLabelController({ segs, onToast: showToast });
  labelCtrl.resetFocus();
  labelCtrl.renderLabels();
  showToast(`已載入 ${segs.length} 句逐字稿`);
  $('labelCard').hidden = false;
  $('result').hidden = true;
  return true;
}

/** 從「最近分析」回看：逐字稿與標記都已存好，直接載入並重跑分析。 */
function loadFromHistory(id) {
  const item = getHistory(id);
  if (!item) return showToast('找不到這筆紀錄（可能已被清除）');
  segs = item.segs.map((s) => ({ ...s }));
  if (!finishLoad(item.source, '最近分析')) return;
  currentHistoryId = item.id;
  $('analyze').click();
}

function loadFile(f) {
  const r = new FileReader();
  const isVibe = /\.vibe\.json$/i.test(f.name);
  r.onload = () => loadTranscriptText(r.result, f.name);
  r.readAsText(f, 'utf-8');
}

function bindLabels() {
  $('autoGuess').onclick = () => {
    if (labeledRatio(segs) > 0 && !confirm('已有發言者標籤，自動猜測會覆蓋現有標記。確定繼續？')) return;
    autoGuess(segs);
    labelCtrl?.resetFocus();
    labelCtrl?.renderLabels();
  };
  $('flipAll').onclick = () => {
    segs.forEach((s) => {
      s.spk = s.spk === 'S' ? 'C' : 'S';
    });
    labelCtrl?.renderLabels();
  };
  $('analyze').onclick = () => {
    const result = runAnalysis(segs);
    reportText = result.reportText;
    lastResult = result;
    aiSummary = '';
    renderAnalysisUI(result);
    drawChart(segs, result.keyMoments);
    $('result').hidden = false;
    const entry = saveHistory({
      id: currentHistoryId,
      source: sourceName,
      segs,
      result,
      reportText,
      mode: resolveMode(),
    });
    currentHistoryId = entry.id;
    renderHistory();
    refreshExportBar();
    showToast('分析完成');
    window.scrollTo({ top: $('result').offsetTop - 10, behavior: 'smooth' });
  };
}

// ---------- 產出直接進工作流 ----------

function flashLabel(btn, text, ms = 1500) {
  const original = btn.dataset.label || btn.textContent;
  btn.dataset.label = original;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = original), ms);
}

async function copyWithFeedback(btn, text, toast) {
  if (!text) return showToast('請先完成分析');
  const ok = await copyText(text);
  showToast(ok ? toast : '無法寫入剪貼簿，請手動選取複製');
  if (ok) flashLabel(btn, '已複製 ✓');
}

function exportContext() {
  return { source: sourceName, date: new Date(), aiSummary };
}

function summaryText() {
  return lastResult ? buildSummaryMessage(lastResult, exportContext()) : '';
}

function markdownText() {
  return reportText ? reportTextToMarkdown(reportText, { ...exportContext(), summaryMessage: summaryText() }) : '';
}

function refreshExportBar() {
  const group = $('exportBridgeGroup');
  if (group) group.hidden = !bridgeSupports('report-save');
}

function bindExports() {
  $('copyReport').onclick = () => copyWithFeedback($('copyReport'), reportText, '完整報告已複製到剪貼簿');
  $('copySummary').onclick = () => copyWithFeedback($('copySummary'), summaryText(), '摘要已複製，直接貼到 LINE／Slack');
  $('copyChecklist').onclick = () =>
    copyWithFeedback(
      $('copyChecklist'),
      lastResult ? buildNextCallChecklist(lastResult, exportContext()) : '',
      '「下一通要問」清單已複製'
    );
  $('downloadMd').onclick = () => {
    if (!reportText) return showToast('請先完成分析');
    const name = downloadText(`${exportBaseName(sourceName)}-報告.md`, markdownText(), 'text/markdown;charset=utf-8');
    showToast(`已下載 ${name}`);
  };
  $('downloadSrt').onclick = () => {
    if (!segs.length) return showToast('請先載入逐字稿');
    const name = downloadText(`${exportBaseName(sourceName)}-已標記.srt`, segsToSrt(segs), 'application/x-subrip;charset=utf-8');
    showToast(`已下載 ${name}（含業務／客戶標記）`);
  };
  $('printReport').onclick = () => {
    if (!reportText) return showToast('請先完成分析');
    document.body.classList.add('printing');
    const done = () => document.body.classList.remove('printing');
    window.addEventListener('afterprint', done, { once: true });
    setTimeout(() => {
      window.print();
      setTimeout(done, 1000);
    }, 50);
  };
  $('saveToBridge').onclick = async () => {
    if (!reportText) return showToast('請先完成分析');
    const base = exportBaseName(sourceName);
    try {
      const md = await saveReportToBridge(`${base}-報告.md`, markdownText());
      await saveReportToBridge(`${base}-已標記.srt`, segsToSrt(segs));
      showToast(`已存到助手 output：${md.filename}（＋已標記 .srt）`);
      flashLabel($('saveToBridge'), '已存檔 ✓');
    } catch (e) {
      showToast(`存檔失敗：${e?.message || '無法連線本機助手'}`);
    }
  };
  $('openOutputFolder').onclick = async () => {
    try {
      await openBridgeFolder('output');
      showToast('已開啟 output 資料夾');
    } catch (e) {
      showToast(e?.message || '無法連線本機助手');
    }
  };
}

// ---------- 最近分析 ----------

function renderHistory() {
  const sec = $('historySection');
  const list = $('historyList');
  if (!sec || !list) return;
  const items = listHistory();
  sec.hidden = !items.length;
  const count = $('historyCount');
  if (count) count.textContent = `${items.length} 筆`;
  list.innerHTML = items
    .map((h) => {
      const s = h.summary || {};
      const meta = [
        `${fmt(s.totalDur || 0)}`,
        `客戶 ${Math.round((s.custRatio || 0) * 100)}%`,
        `六步驟 ${s.steps ?? 0}/6`,
        `L${s.deepest ?? 0}`,
        s.dominant ? `「${s.dominant}」` : '',
      ]
        .filter(Boolean)
        .join('・');
      return `<li class="history-item ${h.id === currentHistoryId ? 'current' : ''}" data-id="${escapeHTML(h.id)}">
        <div class="history-main">
          <span class="history-src">${escapeHTML(h.source || 'transcript')}</span>
          <span class="history-meta">${escapeHTML(meta)}</span>
        </div>
        <span class="history-time">${escapeHTML(formatSavedAt(h.savedAt))}</span>
        <span class="history-actions">
          <button type="button" class="btn" data-act="open">回看</button>
          <button type="button" class="btn" data-act="copy">複製報告</button>
          <button type="button" class="btn history-del" data-act="del" aria-label="刪除">✕</button>
        </span>
      </li>`;
    })
    .join('');
  list.querySelectorAll('[data-act]').forEach((btn) => {
    btn.onclick = async (e) => {
      e.stopPropagation();
      const id = btn.closest('.history-item')?.dataset.id;
      if (!id) return;
      if (btn.dataset.act === 'open') loadFromHistory(id);
      if (btn.dataset.act === 'del') {
        deleteHistory(id);
        if (currentHistoryId === id) currentHistoryId = null;
        renderHistory();
        showToast('已刪除這筆紀錄');
      }
      if (btn.dataset.act === 'copy') {
        const item = getHistory(id);
        const ok = item?.reportText ? await copyText(item.reportText) : false;
        showToast(ok ? '這筆報告已複製' : '這筆紀錄沒有報告內容');
      }
    };
  });
}

function bindHistory() {
  $('historyClear')?.addEventListener('click', () => {
    if (!listHistory().length) return;
    if (!confirm('清空所有最近分析紀錄？（只影響這台電腦的瀏覽器）')) return;
    clearHistory();
    currentHistoryId = null;
    renderHistory();
    showToast('已清空最近分析');
  });
  renderHistory();
}

function loadModelPreference() {
  const saved = localStorage.getItem('gemini_model');
  if (saved && isDeprecatedModel(saved)) {
    localStorage.removeItem('gemini_model');
    $('aiModel').value = DEFAULT_MODEL;
    return DEFAULT_MODEL;
  }
  $('aiModel').value = saved || DEFAULT_MODEL;
  return $('aiModel').value;
}

function saveModelPreference(model) {
  $('aiModel').value = model;
  localStorage.setItem('gemini_model', model);
}

async function callGeminiResilient({ apiKey, model, text, signal }) {
  try {
    return await callGemini({ apiKey, model, text, signal });
  } catch (e) {
    if (e.status !== 404) throw e;
    const suggested = extractSuggestedModel(e.message);
    const next = suggested && suggested !== model ? suggested : DEFAULT_MODEL;
    if (next === model) throw e;
    saveModelPreference(next);
    showToast(`模型已切換為 ${next}，重新請求中…`);
    return callGemini({ apiKey, model: next, text, signal });
  }
}

function bindApiKey() {
  $('rememberKey').checked = keyStorage.remember;
  $('apiKey').value = keyStorage.load();
  loadModelPreference();

  $('rememberKey').onchange = () => {
    localStorage.setItem('gemini_remember_key', $('rememberKey').checked ? '1' : '0');
    if (!$('rememberKey').checked) {
      keyStorage.clearPersisted();
      sessionStorage.setItem('gemini_key', $('apiKey').value.trim());
    } else {
      keyStorage.save($('apiKey').value.trim());
    }
  };

  $('apiKey').onchange = () => keyStorage.save($('apiKey').value.trim());
  $('quotaLimit').value = localStorage.getItem('gemini_limit') || 250;
  $('quotaLimit').onchange = () => {
    localStorage.setItem('gemini_limit', getLimit($('quotaLimit').value));
    renderQuota();
  };

  $('verifyModel').onclick = async () => {
    const key = $('apiKey').value.trim();
    if (!key) {
      $('aiStatus').textContent = '請先貼上 API Key 才能驗證模型';
      return;
    }
    $('verifyModel').disabled = true;
    $('aiStatus').textContent = '正在向 Google 查詢可用模型…';
    try {
      const models = await listGeminiModels(key);
      const flash = models.filter((m) => /flash/i.test(m));
      const list = document.getElementById('modelList');
      list.innerHTML = '';
      (flash.length ? flash : models).slice(0, 12).forEach((m) => {
        const opt = document.createElement('option');
        opt.value = m;
        list.appendChild(opt);
      });
      const current = $('aiModel').value.trim();
      const pick = pickPreferredModel(models, current);
      if (pick !== current) {
        saveModelPreference(pick);
        $('aiStatus').textContent = `模型「${current}」不可用，已改為 ${pick}。共找到 ${models.length} 個模型。`;
      } else {
        $('aiStatus').textContent = `模型驗證成功：${current} 可用（共 ${models.length} 個模型）。`;
      }
    } catch (e) {
      $('aiStatus').textContent = `模型驗證失敗：${e.message}`;
    } finally {
      $('verifyModel').disabled = false;
    }
  };
}

function renderAIResults(j) {
  $('aiGood').innerHTML =
    (j.good || []).map((g) => `<li>${escapeHTML(g.point)}<span class="ev">${escapeHTML(g.evidence || '')}</span></li>`).join('') || '<li>（無）</li>';
  $('aiBad').innerHTML =
    (j.bad || [])
      .map(
        (b) =>
          `<li>${escapeHTML(b.point)}${b.rule ? `（規則：${escapeHTML(b.rule)}）` : ''}<span class="ev">${escapeHTML(b.evidence || '')}</span></li>`
      )
      .join('') || '<li>（無）</li>';
  $('aiSug').innerHTML =
    (j.suggest || [])
      .map((s) => `<li>${s.scene ? `${escapeHTML(s.scene)}：` : ''}<span class="q">「${escapeHTML(s.say)}」</span></li>`)
      .join('') || '<li>（無）</li>';
  const prEl = $('aiPurposeReasoning');
  if (prEl) {
    const pr = j.purpose_reasoning || [];
    prEl.hidden = !pr.length;
    prEl.innerHTML = pr.length
      ? `<h4 style="margin:12px 0 8px;font-family:var(--disp)">深層推理（要～爽）</h4>${pr
          .map(
            (p) =>
              `<div class="reason-chain"><h5>${escapeHTML(p.role || '')} · ${escapeHTML(p.type || '')}</h5>
              <div class="reason-step"><span class="reason-title">表面</span><div class="reason-quote">「${escapeHTML(p.surface_quote || '')}」</div></div>
              <div class="reason-step"><span class="reason-title">深層目的</span><div class="reason-insight">${escapeHTML(p.deep_motive || '')}</div></div>
              <div class="reason-step"><span class="reason-title">為何不是其他類型</span><div class="reason-insight">${escapeHTML(p.why_not_other || '')}</div></div>
              <div class="reason-step"><span class="reason-title">強化</span><div class="reason-example">「${escapeHTML(p.amplify_line || '')}」</div></div>
              <div class="reason-step"><span class="reason-title">對接</span><div class="reason-example">「${escapeHTML(p.pitch_line || '')}」</div></div></div>`
          )
          .join('')}`
      : '';
  }
  $('aiOut').hidden = false;
}

function setAIProgress(current, total, message) {
  const wrap = $('aiProgress');
  wrap.hidden = false;
  $('aiProgressText').textContent = message;
  $('aiProgressBar').style.width = total ? `${Math.round((current / total) * 100)}%` : '0%';
}

function hideAIProgress() {
  $('aiProgress').hidden = true;
  $('aiProgressBar').style.width = '0%';
}

async function runAIAnalysis() {
  const key = $('apiKey').value.trim();
  if (!key) {
    $('aiStatus').textContent = '請先貼上你自己的 API Key（aistudio.google.com/apikey 免費申請）';
    return;
  }
  if (!segs.length) {
    $('aiStatus').textContent = '請先載入逐字稿並完成分析';
    return;
  }
  if (!$('aiConsent').checked) {
    $('aiStatus').textContent = '請先勾選「我已去識別化並同意傳送至 Google 分析」';
    return;
  }

  const u = getUsage();
  const lim = getLimit($('quotaLimit').value);
  const quota = checkQuotaBefore(u.count, lim);
  if (!quota.ok) {
    showQuotaModal(
      '今日估算額度已達上限',
      `本機估算今日已使用 <b>${u.count} / ${lim}</b> 次。<br>若官方額度確實用完，可等明日重置（太平洋時間午夜），或升級付費方案。`
    );
    return;
  }
  if (quota.level === 'critical') {
    showQuotaModal('免費額度即將用完', `本機估算今日已使用 <b>${u.count} / ${lim}</b> 次（${Math.round(quota.pct)}%）。`);
  }

  const transcript = buildTranscript(segs, fmt);
  const chunks = chunkTranscript(transcript);
  let model = $('aiModel').value.trim() || DEFAULT_MODEL;
  if (isDeprecatedModel(model)) model = DEFAULT_MODEL;
  saveModelPreference(model);

  aiAbort = new AbortController();
  $('aiBtn').disabled = true;
  $('aiCancel').hidden = false;
  setAIProgress(0, chunks.length, `準備分析（共 ${chunks.length} 段）…`);

  let totalTokens = 0;
  const partials = [];
  const startedAt = Date.now();
  try {
    for (let i = 0; i < chunks.length; i++) {
      if (aiAbort.signal.aborted) throw new Error('已取消分析');
      const prefix = chunks.length > 1 ? `【第 ${i + 1}/${chunks.length} 段逐字稿】\n` : '';
      // 以已完成段的平均耗時推估剩餘；第一段前只能給經驗值
      const perChunk = i ? (Date.now() - startedAt) / i : 0;
      const remainSec = i ? Math.ceil((perChunk * (chunks.length - i)) / 1000) : null;
      const eta = remainSec == null ? '（每段通常 10～40 秒）' : `（約還需 ${remainSec >= 60 ? `${Math.ceil(remainSec / 60)} 分` : `${remainSec} 秒`}）`;
      setAIProgress(i, chunks.length, `AI 分析中：第 ${i + 1} / ${chunks.length} 段…${eta}`);
      const { parsed, usedTokens } = await callGeminiResilient({
        apiKey: key,
        model,
        text: MANUAL_PROMPT + prefix + chunks[i],
        signal: aiAbort.signal,
      });
      totalTokens += usedTokens;
      partials.push(parsed);
    }
    const j = chunks.length > 1 ? mergeAIResults(partials) : partials[0];
    bumpUsage(totalTokens);
    renderQuota();
    renderAIResults(j);
    $('aiStatus').textContent = `AI 分析完成 — ${j.summary || ''}`;
    showToast(chunks.length > 1 ? `AI 深度分析完成（${chunks.length} 段合併）` : 'AI 深度分析完成');
    reportText += appendAIReportSection('', j);
    aiSummary = j.summary || '';
    if (currentHistoryId) updateHistoryReport(currentHistoryId, reportText);
  } catch (e) {
    if (e.status === 429) {
      showQuotaModal(
        '官方回報：額度已用完（429）',
        'Google 回應本 Key 的免費額度已耗盡。可等幾分鐘後重試、等明日重置，或升級付費方案。'
      );
    }
    $('aiStatus').textContent = e.name === 'AbortError' || e.message === '已取消分析' ? '已取消 AI 分析' : `分析失敗：${e.message}`;
  } finally {
    $('aiBtn').disabled = false;
    $('aiCancel').hidden = true;
    hideAIProgress();
    aiAbort = null;
    const u2 = getUsage();
    const lim2 = getLimit($('quotaLimit').value);
    if (checkQuotaBefore(u2.count, lim2).level === 'warn') {
      $('aiStatus').textContent += `｜注意：今日估算用量已達 ${quotaPercent(u2.count, lim2)}%`;
    }
  }
}

function bindAI() {
  $('aiBtn').onclick = runAIAnalysis;
  $('aiCancel').onclick = () => aiAbort?.abort();
}

function init() {
  bindUI();
  bindUpload();
  bindLabels();
  bindExports();
  bindHistory();
  bindApiKey();
  bindAI();
  labelCtrl = createLabelController({ segs, onToast: showToast });
  bindLabelCollapseHandlers(() => labelCtrl.collapseLabels());
  renderQuota();

  FALLBACK_MODELS.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    $('modelList').appendChild(opt);
  });

  initModeChooser({
    onModeChange: (mode) => {
      if (mode === 'demo') window.__refreshBridge?.();
    },
  });

  // 助手在線時，報告可直接存進 output 資料夾；狀態每 8 秒由 local-transcribe 更新
  checkLocalBridge().then(refreshExportBar);
  setInterval(refreshExportBar, 8000);

  initLocalTranscribe({
    onTranscriptReady: (text, filename) => {
      if (loadTranscriptText(text, filename)) {
        $('labelCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    },
    showToast,
    getMode: resolveMode,
  });

  initDrill({
    // 陪練逐字稿已含說話者標籤，直接跑分析並跳到結果
    onTranscriptReady: (text, filename) => {
      if (loadTranscriptText(text, filename)) $('analyze').click();
    },
    showToast,
    getApiKey: () => $('apiKey').value.trim(),
    setApiKey: (value) => {
      $('apiKey').value = value;
      keyStorage.save(value);
    },
    getModel: () => {
      const m = $('aiModel').value.trim() || DEFAULT_MODEL;
      return isDeprecatedModel(m) ? DEFAULT_MODEL : m;
    },
    onGeminiUsed: (tokens) => {
      bumpUsage(tokens);
      renderQuota();
    },
  });
}

init();
