export const DEFAULT_MODEL = 'gemini-3.6-flash';
export const FALLBACK_MODELS = ['gemini-3.6-flash', 'gemini-3.6-flash-lite', 'gemini-3.6-pro'];
/** When primary model returns 503/429, try these in order (flash-lite often has spare capacity). */
export const CAPACITY_FALLBACK_ORDER = ['gemini-3.6-flash-lite', 'gemini-3.6-pro', 'gemini-3.6-flash'];

const RETRY_DELAYS_MS = [2000, 5000, 12000];

/** Models Google has deprecated for new users (prefix match). */
const DEPRECATED_PREFIXES = ['gemini-1.5-', 'gemini-2.0-', 'gemini-2.5-'];

export function isDeprecatedModel(model) {
  const m = String(model || '').trim().toLowerCase();
  return DEPRECATED_PREFIXES.some((p) => m.startsWith(p));
}

/** Pick best available model; prefer 3.6 flash, then any flash, then default. */
export function pickPreferredModel(models, current) {
  const list = models || [];
  if (current && list.includes(current) && !isDeprecatedModel(current)) return current;
  const prefer = [DEFAULT_MODEL, 'gemini-3.6-flash-lite', 'gemini-3.6-pro', ...FALLBACK_MODELS];
  for (const p of prefer) {
    if (list.includes(p)) return p;
  }
  const flash = list.find((m) => /flash/i.test(m) && !isDeprecatedModel(m));
  if (flash) return flash;
  return list.find((m) => !isDeprecatedModel(m)) || DEFAULT_MODEL;
}

/**
 * 送出前先檢查 API Key 字串本身；回傳問題描述，沒問題回傳空字串。
 * AI Studio 新式 Key 為「AQ.」開頭且很長，最常見的 401 就是複製時被截斷。
 */
export function describeApiKeyProblem(rawKey) {
  const key = String(rawKey ?? '');
  const trimmed = key.trim();
  if (!trimmed) return '請先貼上 Gemini API Key';
  if (/^bearer\s+/i.test(trimmed)) return 'Key 前面不要加「Bearer」，只貼 Key 本身';
  if (/^["'`]|["'`]$/.test(trimmed)) return 'Key 前後不要有引號，請只貼 Key 本身';
  if (/\s/.test(trimmed)) return 'Key 中間有空格或換行，請回 AI Studio 用「複製」按鈕整串重貼';
  if (/[^\x21-\x7e]/.test(trimmed)) return 'Key 含有全形或非英數字元（例如「。」），請重新複製貼上';
  if (/^AQ\./.test(trimmed)) {
    // 實際 AI Studio 發出的 AQ. Key 約 53 字元（例：AQ.Ab8…）
    if (trimmed.length < 40) return `這把「AQ.」Key 只有 ${trimmed.length} 個字元，看起來被截斷了，請整串重新複製`;
    return '';
  }
  if (/^AIza/.test(trimmed)) {
    if (trimmed.length < 35) return `這把 Key 只有 ${trimmed.length} 個字元，看起來不完整，請整串重新複製`;
    return '';
  }
  return 'Gemini API Key 應以「AQ.」或「AIza」開頭，請確認貼的是 aistudio.google.com/apikey 產生的 Key';
}

/** Parse Google error text e.g. "use models/gemini-3.6-flash" */
export function extractSuggestedModel(message) {
  const m = String(message || '').match(/models\/(gemini-[\w.-]+)/i);
  return m ? m[1] : null;
}

export const MANUAL_PROMPT = `你是電話業務教練，依據以下公司「顧問式銷售全流程」手冊，分析這通電訪逐字稿。核心理念：理解需求→判斷適配→幫助決策。我們賣的不是方案，而是「真正適合客戶的解決方案」。

【兩大產品核心】1.企業AI落地培訓營:適合需要把AI用在實際工作、把想法變成可運用成果的人(系統化教學/實戰任務產出/團隊共學)。2.真人業界/創業者一對一諮詢:適合有方向但卡關、需要針對個人情況給業界經驗與策略建議的人(精準診斷/可行解法/快速修正方向)。
【六步驟】(不是鐵軌是地圖,依客戶狀況彈性運用) 1連結Connect(建立安全感讓對方說真話,不是尬聊) 2挖掘Discovery(找到現況/目標/問題/動機/限制,開放式提問挖到本質,不是問滿5題) 3釐清Clarify(幫客戶看清本質與不改變的代價,現況成本vs改變價值,引導客戶自己說出來,不是製造恐懼) 4判斷Diagnose(需求×目標×條件×適配,結論必為A高度適合/B部分適合/C不適合,不是一定要賣) 5對接Recommend(把適合的方案價值對到他的問題,精準對接不介紹全部,講清楚為什麼適合,不是推銷商品) 6決策Decision(處理真實疑慮的真正原因,協助評估比較,給行動建議,不是逼單)。
【五層資訊】L1現況(現在到底發生什麼)→L2問題(哪裡不滿意/卡住)→L3影響(不處理會造成什麼)→L4動機(為什麼真的想改變/為什麼是現在)→L5未來(真正想變成什麼)。標準:不是問滿5層,而是資訊完整到能判斷為止。完成標準:能說出「所以你真正想解決的是___,因為___,如果沒有處理會___;你真正需要的是___,我理解對嗎?」客戶說「對」才算挖到位。
【適配判斷三結果】A高度適合:清楚推薦並講明理由「依照你的A、B、C,我認為___方案最適合你,因為___」。B部分適合:只推真正需要的,不硬賣不需要的。C不適合:坦白告知目前不建議並給替代建議(敢不賣也是顧問價值)。
【五字口訣＝五種學AI目的分級】要什麼(補缺口)→怕什麼(避風險)→想什麼(進圈子)→愛什麼(被看重)→爽什麼(意義影響力/自我證明)。流程:先判斷主導分級→依該分級往下挖五層(每種分級路徑不同,例爽什麼:爽什麼→你怎樣爽→如何爽→爽的意義→真的爽歪歪)→分別強化→用客戶想聽的話對接。勿硬導向其他分級(例:學員是爽什麼勿硬問最深恐懼)。
【常見錯誤vs正確】急著介紹產品→先理解再判斷再建議;看到關鍵字就替客戶下結論→聽到後檢查提問驗證;為了成交放大恐懼→讓問題變清楚;流程變成背話術→彈性運用;不適合也硬推→真不賣才是專業。
【底線】不能教成「找痛點+放大恐懼+塞產品+解釋講→收錢」;要教成「理解→挖掘→釐清→判斷→推薦→幫助決策」。成交不代表判斷對了;顧問價值=知道客戶需要什麼、為什麼需要,敢給對他負責的建議。

【五字口訣深層推理】每種類型須推敲:①表面陳述(客戶字面)②深層目的(學AI真正為了什麼)③常見誤判(為何不是其他類型)④收斂驗證⑤分別強化⑥對接話術。輸出JSON時加 purpose_reasoning 陣列(每種主導/次要類型一筆,含 surface_quote/deep_motive/why_not_other/verify_question/amplify_line/pitch_line)。

請輸出繁體中文 JSON（不要 markdown 圍欄）：
{"good":[{"point":"做得好的具體描述","evidence":"引用原句(含時間)"}],
"bad":[{"point":"待加強的具體描述","rule":"違反或未達成的手冊規則","evidence":"引用原句或說明缺漏處"}],
"suggest":[{"scene":"什麼情境下","say":"建議的具體話術(可直接照念)"}],
"purpose_reasoning":[{"type":"要什麼|怕什麼|想什麼|愛什麼|爽什麼","role":"主導|次要","surface_quote":"","deep_motive":"","why_not_other":"","verify_question":"","amplify_line":"","pitch_line":""}],
"summary":"三句以內的總評"}

每個陣列 3-6 條，聚焦最重要的。逐字稿如下（S=業務, C=客戶）：\n`;

export function buildTranscript(segs, fmt) {
  return segs.map((s) => `[${fmt(s.start)}] ${s.spk === 'S' ? 'S' : 'C'}: ${s.text}`).join('\n');
}

export function chunkTranscript(transcript, maxChars = 12000) {
  if (transcript.length <= maxChars) return [transcript];
  const lines = transcript.split('\n');
  const chunks = [];
  let cur = '';
  for (const line of lines) {
    if (cur.length + line.length + 1 > maxChars && cur) {
      chunks.push(cur);
      cur = line;
    } else {
      cur += (cur ? '\n' : '') + line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function parseAIResponse(raw) {
  const cleaned = raw.replace(/^```json\s*|```\s*$/g, '').trim();
  const j = JSON.parse(cleaned);
  if (!j || typeof j !== 'object') throw new Error('AI 回傳格式不正確');
  for (const key of ['good', 'bad', 'suggest']) {
    if (j[key] != null && !Array.isArray(j[key])) throw new Error(`AI 回傳欄位 ${key} 應為陣列`);
  }
  if (j.purpose_reasoning != null && !Array.isArray(j.purpose_reasoning)) {
    throw new Error('AI 回傳欄位 purpose_reasoning 應為陣列');
  }
  return j;
}

export function mergeAIResults(results) {
  const merged = { good: [], bad: [], suggest: [], purpose_reasoning: [], reflection_crosscheck: null, summary: '' };
  for (const r of results) {
    merged.good.push(...(r.good || []));
    merged.bad.push(...(r.bad || []));
    merged.suggest.push(...(r.suggest || []));
    merged.purpose_reasoning.push(...(r.purpose_reasoning || []));
    if (r.reflection_crosscheck) merged.reflection_crosscheck = r.reflection_crosscheck;
    if (r.summary) merged.summary += (merged.summary ? ' ' : '') + r.summary;
  }
  return merged;
}

function geminiHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
  };
}

export async function listGeminiModels(apiKey, fetchImpl = fetch) {
  const res = await fetchImpl('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: geminiHeaders(apiKey),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `無法取得模型清單（HTTP ${res.status}）`);
  }
  const data = await res.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .sort();
}

export function formatApiError(status, errBody) {
  const msg = errBody?.error?.message || `HTTP ${status}`;
  if (status === 401) {
    // Google 的 401 文字會提到 OAuth，實際上用 API Key 時幾乎都是 Key 字串不完整／複製錯
    return `API Key 無效或未授權（401）：Google 不接受這把 Key。新式 Key 以「AQ.」開頭且很長，請回 aistudio.google.com/apikey 用「複製」按鈕整串重貼（不要手打、前後不要有空格或引號），或重新建立一把 Key 後按「驗證模型」測試。原始訊息：${msg}`;
  }
  if (status === 400 && /api key not valid/i.test(msg)) {
    return `API Key 無效（400）：這把 Key 不存在或已被刪除，請到 aistudio.google.com/apikey 重新複製或建立。原始訊息：${msg}`;
  }
  if (status === 403) return `API Key 沒有權限使用此模型（403）：${msg}`;
  if (status === 404) {
    const hint = extractSuggestedModel(msg);
    return hint
      ? `模型不可用（404）：${msg}。已建議改用 ${hint}，請按「驗證模型」或重新分析。`
      : `模型不存在或 API 路徑錯誤（404）：${msg}。請按「驗證模型」確認可用清單。`;
  }
  if (status === 429) return `官方額度已用完或請求過於頻繁（429）：${msg}`;
  if (status === 503) {
    return `Google 服務暫時忙碌（503）：${msg}。系統會自動等待重試並改試 flash-lite / pro。`;
  }
  if (status >= 500) return `Google 服務暫時異常（${status}）：${msg}。請稍後重試。`;
  return msg;
}

export function isRetryableGeminiStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503;
}

/** Models to attempt when capacity errors persist (deduped, primary first). */
export function modelsToTryForCapacity(primary) {
  const seen = new Set();
  const out = [];
  for (const m of [primary, ...CAPACITY_FALLBACK_ORDER, ...FALLBACK_MODELS]) {
    const name = String(m || '').trim();
    if (!name || seen.has(name) || isDeprecatedModel(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function sleepMs(ms, signal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });
}

/** Retry the same model on transient Google errors (503 high demand, 429, 5xx). */
export async function callGeminiWithRetry({
  apiKey,
  model,
  text,
  parts,
  generationConfig,
  signal,
  fetchImpl = fetch,
  parse = parseAIResponse,
  onRetry,
}) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await callGemini({ apiKey, model, text, parts, generationConfig, signal, fetchImpl, parse });
    } catch (e) {
      lastErr = e;
      if (!isRetryableGeminiStatus(e.status) || attempt >= RETRY_DELAYS_MS.length) throw e;
      const delayMs = RETRY_DELAYS_MS[attempt];
      onRetry?.({ attempt: attempt + 1, maxAttempts: RETRY_DELAYS_MS.length, delayMs, status: e.status, model });
      await sleepMs(delayMs, signal);
    }
  }
  throw lastErr;
}

/**
 * 404 → suggested model; 503/429/5xx → retry then alternate models.
 * Returns { raw, usedTokens, parsed, modelUsed }.
 */
export async function callGeminiResilient({
  apiKey,
  model,
  text,
  parts,
  generationConfig,
  signal,
  fetchImpl = fetch,
  parse = parseAIResponse,
  onRetry,
  onModelSwitch,
}) {
  const queue = modelsToTryForCapacity(model);
  let lastErr;
  for (let i = 0; i < queue.length; i++) {
    const tryModel = queue[i];
    if (i > 0) onModelSwitch?.(tryModel, model);
    try {
      const result = await callGeminiWithRetry({
        apiKey,
        model: tryModel,
        text,
        parts,
        generationConfig,
        signal,
        fetchImpl,
        parse,
        onRetry: (info) => onRetry?.({ ...info, model: tryModel }),
      });
      return { ...result, modelUsed: tryModel };
    } catch (e) {
      lastErr = e;
      if (e.status === 404) {
        const suggested = extractSuggestedModel(e.message);
        if (suggested && !queue.includes(suggested)) queue.push(suggested);
        continue;
      }
      if (isRetryableGeminiStatus(e.status)) continue;
      throw e;
    }
  }
  if (lastErr) {
    lastErr.message = `${lastErr.message}（已依序嘗試：${queue.join(' → ')}）`;
  }
  throw lastErr;
}

/** Build the request body; `parts` (multimodal, e.g. inline audio + prompt) overrides plain `text`. */
export function buildGeminiRequestBody({ text, parts, generationConfig }) {
  const contentParts = Array.isArray(parts) && parts.length ? parts : [{ text: String(text ?? '') }];
  return {
    contents: [{ parts: contentParts }],
    generationConfig: { temperature: 0.3, responseMimeType: 'application/json', ...(generationConfig || {}) },
  };
}

export async function callGemini({
  apiKey,
  model,
  text,
  parts,
  generationConfig,
  signal,
  fetchImpl = fetch,
  parse = parseAIResponse,
}) {
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: geminiHeaders(apiKey),
      signal,
      body: JSON.stringify(buildGeminiRequestBody({ text, parts, generationConfig })),
    }
  );
  const errBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(formatApiError(res.status, errBody));
    err.status = res.status;
    throw err;
  }
  const data = errBody;
  const candidate = data?.candidates?.[0];
  const raw = (candidate?.content?.parts || [])
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .join('');
  const usedTokens = data?.usageMetadata?.totalTokenCount || 0;
  const finishReason = candidate?.finishReason || '';
  return { raw, usedTokens, finishReason, parsed: parse(raw, { finishReason }) };
}
