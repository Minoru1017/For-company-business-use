export const DEFAULT_MODEL = 'gemini-2.0-flash';
export const FALLBACK_MODELS = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro'];

export const MANUAL_PROMPT = `你是電話業務教練，依據以下公司「顧問式銷售全流程」手冊，分析這通電訪逐字稿。核心理念：理解需求→判斷適配→幫助決策。我們賣的不是方案，而是「真正適合客戶的解決方案」。

【兩大產品核心】1.企業AI落地培訓營:適合需要把AI用在實際工作、把想法變成可運用成果的人(系統化教學/實戰任務產出/團隊共學)。2.真人業界/創業者一對一諮詢:適合有方向但卡關、需要針對個人情況給業界經驗與策略建議的人(精準診斷/可行解法/快速修正方向)。
【六步驟】(不是鐵軌是地圖,依客戶狀況彈性運用) 1連結Connect(建立安全感讓對方說真話,不是尬聊) 2挖掘Discovery(找到現況/目標/問題/動機/限制,開放式提問挖到本質,不是問滿5題) 3釐清Clarify(幫客戶看清本質與不改變的代價,現況成本vs改變價值,引導客戶自己說出來,不是製造恐懼) 4判斷Diagnose(需求×目標×條件×適配,結論必為A高度適合/B部分適合/C不適合,不是一定要賣) 5對接Recommend(把適合的方案價值對到他的問題,精準對接不介紹全部,講清楚為什麼適合,不是推銷商品) 6決策Decision(處理真實疑慮的真正原因,協助評估比較,給行動建議,不是逼單)。
【五層資訊】L1現況(現在到底發生什麼)→L2問題(哪裡不滿意/卡住)→L3影響(不處理會造成什麼)→L4動機(為什麼真的想改變/為什麼是現在)→L5未來(真正想變成什麼)。標準:不是問滿5層,而是資訊完整到能判斷為止。完成標準:能說出「所以你真正想解決的是___,因為___,如果沒有處理會___;你真正需要的是___,我理解對嗎?」客戶說「對」才算挖到位。
【適配判斷三結果】A高度適合:清楚推薦並講明理由「依照你的A、B、C,我認為___方案最適合你,因為___」。B部分適合:只推真正需要的,不硬賣不需要的。C不適合:坦白告知目前不建議並給替代建議(敢不賣也是顧問價值)。
【五力指標+適配】1背景(工作/行業/經驗) 2目標(想達成什麼) 3問題(真正卡住的最大痛點) 4動機(為什麼改變/為什麼現在) 5現實條件(預算/時間/能力/資源限制);前五項=蒐集資訊,第六項=適配判斷(顧問核心價值)。
【常見錯誤vs正確】急著介紹產品→先理解再判斷再建議;看到關鍵字就替客戶下結論→聽到後檢查提問驗證;為了成交放大恐懼→讓問題變清楚;流程變成背話術→彈性運用;不適合也硬推→真不賣才是專業。
【底線】不能教成「找痛點+放大恐懼+塞產品+解釋講→收錢」;要教成「理解→挖掘→釐清→判斷→推薦→幫助決策」。成交不代表判斷對了;顧問價值=知道客戶需要什麼、為什麼需要,敢給對他負責的建議。

請輸出繁體中文 JSON（不要 markdown 圍欄）：
{"good":[{"point":"做得好的具體描述","evidence":"引用原句(含時間)"}],
"bad":[{"point":"待加強的具體描述","rule":"違反或未達成的手冊規則","evidence":"引用原句或說明缺漏處"}],
"suggest":[{"scene":"什麼情境下","say":"建議的具體話術(可直接照念)"}],
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
  return j;
}

export function mergeAIResults(results) {
  const merged = { good: [], bad: [], suggest: [], summary: '' };
  for (const r of results) {
    merged.good.push(...(r.good || []));
    merged.bad.push(...(r.bad || []));
    merged.suggest.push(...(r.suggest || []));
    if (r.summary) merged.summary += (merged.summary ? ' ' : '') + r.summary;
  }
  return merged;
}

export async function listGeminiModels(apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
  );
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
  if (status === 401) return `API Key 無效或未授權（401）：${msg}`;
  if (status === 403) return `API Key 沒有權限使用此模型（403）：${msg}`;
  if (status === 404) return `模型不存在或 API 路徑錯誤（404）：${msg}。請按「驗證模型」確認可用清單。`;
  if (status === 429) return `官方額度已用完或請求過於頻繁（429）：${msg}`;
  if (status >= 500) return `Google 服務暫時異常（${status}）：${msg}。請稍後重試。`;
  return msg;
}

export async function callGemini({ apiKey, model, text, signal, fetchImpl = fetch }) {
  const res = await fetchImpl(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text }] }],
        generationConfig: { temperature: 0.3, responseMimeType: 'application/json' },
      }),
    }
  );
  const errBody = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(formatApiError(res.status, errBody));
    err.status = res.status;
    throw err;
  }
  const data = errBody;
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const usedTokens = data?.usageMetadata?.totalTokenCount || 0;
  return { raw, usedTokens, parsed: parseAIResponse(raw) };
}
