/**
 * 有邀約開發 → DEMO 用簡報。
 * 每一頁都必須回應「這位客戶喜歡的、或他想知道的事」，並記下依據（why），
 * 版型參考資深同事的簡報：深藍章節頁、淺底卡片頁、流程作品頁、月份學習路徑頁。
 * 資料只存本機 localStorage。
 */

export const DECKS_STORAGE_KEY = 'call_coach_demo_decks_v1';
export const COURSE_NOTES_STORAGE_KEY = 'call_coach_demo_deck_course_v1';

export const SLIDE_TYPES = ['cover', 'section', 'cards', 'grid', 'flow', 'plan', 'quote', 'qa', 'closing'];

export const SLIDE_TYPE_LABELS = {
  cover: '封面',
  section: '章節',
  cards: '重點卡片',
  grid: '方向（2×2）',
  flow: '作品流程',
  plan: '學習路徑',
  quote: '你說過的話',
  qa: '你在意的問題',
  closing: '收尾',
};

/** 有編號的內容頁（「05 ｜ 節奏」），其餘只顯示 kicker */
export const NUMBERED_TYPES = new Set(['cards', 'grid', 'quote', 'qa']);

export const INPUT_FIELDS = [
  { key: 'name', label: '學員姓名', placeholder: '劉○○（建議隱去全名）', short: true },
  { key: 'demoAt', label: 'DEMO 時間', placeholder: '1006 20:30', short: true },
  { key: 'background', label: '背景科系＆職業', placeholder: '自由業，Uber 外送員、兼職跑物流', short: true },
  { key: 'product', label: '有興趣的方案／購買領域', placeholder: 'AI 未來學院初階計畫', short: true },
  { key: 'goals', label: '學習目標（短、中、長期）', placeholder: '想用 AI＋自媒體做 BGM cover，表達自己；未來工作生活更自由' },
  { key: 'traits', label: '學員特質／個性', placeholder: '好聊天；習慣慢慢來' },
  { key: 'story', label: '故事背景／動機', placeholder: '這個想法想了五年還沒開始；AI、自媒體、音樂都是新手' },
  { key: 'concerns', label: '他擔心、想知道的事', placeholder: '學不會怎麼辦？要花多少時間？工具一直變怎麼辦？' },
  { key: 'availability', label: '學習時間／裝置', placeholder: '平日晚上 1 小時；筆電 Windows' },
  { key: 'raw', label: '開發紀錄、問卷原文（直接貼）', placeholder: '把開發時的筆記、問卷回覆、CRM 備註整段貼上——AI 會從這裡找客戶的原話', rows: 8 },
];

const LIMITS = { short: 60, title: 40, text: 160, long: 400, notes: 600 };

function str(v, max = LIMITS.text) {
  return String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, max);
}

function strList(list, max, itemMax = LIMITS.short) {
  return (Array.isArray(list) ? list : [])
    .map((x) => str(typeof x === 'object' && x ? x.text ?? x.title ?? '' : x, itemMax))
    .filter(Boolean)
    .slice(0, max);
}

/** 字體選單：key 同時是 PPTX fontFace；公司電腦是 Windows，以 Windows 內建字為主 */
export const FONT_OPTIONS = [
  { key: '', label: '預設（正黑體）', css: '"Noto Sans TC","Microsoft JhengHei","PingFang TC",sans-serif' },
  { key: 'Microsoft JhengHei', label: '微軟正黑體', css: '"Microsoft JhengHei","Noto Sans TC","PingFang TC",sans-serif' },
  { key: 'PMingLiU', label: '新細明體', css: '"PMingLiU","MingLiU","Noto Serif TC","Songti TC",serif' },
  { key: 'DFKai-SB', label: '標楷體', css: '"DFKai-SB","BiauKai","Kaiti TC",serif' },
  { key: 'Noto Serif TC', label: '思源宋體', css: '"Noto Serif TC","PMingLiU","Songti TC",serif' },
  { key: 'Arial', label: 'Arial', css: 'Arial,"Microsoft JhengHei",sans-serif' },
  { key: 'Georgia', label: 'Georgia', css: 'Georgia,"PMingLiU",serif' },
  { key: 'Impact', label: 'Impact', css: 'Impact,"Microsoft JhengHei",sans-serif' },
];
const FONT_KEYS = new Set(FONT_OPTIONS.map((f) => f.key));

export function fontCss(key) {
  return (FONT_OPTIONS.find((f) => f.key === key) || FONT_OPTIONS[0]).css;
}

/** 字級以 PPTX 的 pt 存（寬螢幕投影片寬 960pt），HTML 換算成 cqw */
export const FONT_SIZE_MIN = 8;
export const FONT_SIZE_MAX = 96;
export const ptToCqw = (pt) => Math.round((pt / 9.6) * 1000) / 1000;

export const MAX_SLIDE_IMAGES = 12;
const FMT_KEY_RE = /^[a-z]+(\.\d+(\.[a-z]+)?)?$/i;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function normColor(v) {
  const s = String(v || '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : '';
}

function normFont(v) {
  const s = String(v || '');
  return s && FONT_KEYS.has(s) ? s : '';
}

function normTextStyle(st) {
  const out = {};
  const color = normColor(st?.color);
  const size = Number(st?.size);
  const font = normFont(st?.font);
  if (color) out.color = color;
  if (Number.isFinite(size) && size > 0) out.size = clamp(Math.round(size), FONT_SIZE_MIN, FONT_SIZE_MAX);
  if (font) out.font = font;
  return Object.keys(out).length ? out : null;
}

export function normalizeFmt(f) {
  const text = {};
  const blocks = {};
  Object.entries(f?.text && typeof f.text === 'object' ? f.text : {})
    .slice(0, 80)
    .forEach(([k, v]) => {
      const st = FMT_KEY_RE.test(k) ? normTextStyle(v) : null;
      if (st) text[k] = st;
    });
  Object.entries(f?.blocks && typeof f.blocks === 'object' ? f.blocks : {})
    .slice(0, 40)
    .forEach(([k, v]) => {
      const fill = FMT_KEY_RE.test(k) ? normColor(v?.fill) : '';
      if (fill) blocks[k] = { fill };
    });
  return { bg: normColor(f?.bg), text, blocks };
}

export function normalizeImages(list) {
  return (Array.isArray(list) ? list : [])
    .filter((im) => /^img_[\w-]{4,40}$/.test(String(im?.id || '')))
    .slice(0, MAX_SLIDE_IMAGES)
    .map((im) => {
      const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
      const w = clamp(n(im.w, 40), 3, 100);
      return {
        id: im.id,
        x: clamp(n(im.x, 30), -50, 100),
        y: clamp(n(im.y, 30), -50, 100),
        w,
        ratio: clamp(n(im.ratio, 0.75), 0.05, 20),
        bg: !!im.bg,
      };
    });
}

export function imageIdsInDecks(records) {
  const ids = new Set();
  (records || []).forEach((r) => r?.deck?.slides?.forEach((s) => s.images?.forEach((im) => ids.add(im.id))));
  return ids;
}

function rid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function normalizeSlide(s = {}) {
  const type = SLIDE_TYPES.includes(s?.type) ? s.type : 'cards';
  const base = {
    id: str(s.id, 40) || rid('s'),
    type,
    kicker: str(s.kicker, LIMITS.short),
    title: str(s.title, LIMITS.title + 20),
    subtitle: str(s.subtitle),
    notes: str(s.notes, LIMITS.notes),
    why: str(s.why, LIMITS.long),
    fmt: normalizeFmt(s.fmt),
    images: normalizeImages(s.images),
  };
  switch (type) {
    case 'cover':
      return { ...base, meta: str(s.meta, LIMITS.short) };
    case 'cards':
      return {
        ...base,
        cards: (Array.isArray(s.cards) ? s.cards : [])
          .map((c) => ({ label: str(c?.label, 20), title: str(c?.title, LIMITS.title), text: str(c?.text) }))
          .filter((c) => c.title || c.text)
          .slice(0, 4),
        banner: str(s.banner),
      };
    case 'grid':
      return {
        ...base,
        items: (Array.isArray(s.items) ? s.items : [])
          .map((c) => ({ label: str(c?.label, 20), title: str(c?.title, LIMITS.title), tags: str(c?.tags), flow: str(c?.flow), muted: !!c?.muted }))
          .filter((c) => c.title)
          .slice(0, 4),
      };
    case 'flow':
      return {
        ...base,
        chipsLabel: str(s.chipsLabel, 20) || '常見情況',
        chips: strList(s.chips, 5, 20),
        stepsLabel: str(s.stepsLabel, 20) || '可以怎麼做',
        steps: strList(s.steps, 5, 24),
        gainLabel: str(s.gainLabel, 20) || '累積什麼能力',
        gain: str(s.gain),
        mapLabel: str(s.mapLabel, 20) || '可以對應的方向',
        map: str(s.map),
      };
    case 'plan':
      return {
        ...base,
        focusLabel: str(s.focusLabel, 20) || '學習重點',
        focus: strList(s.focus, 5, 20),
        goalLabel: str(s.goalLabel, 20) || '這個月的目標',
        goal: str(s.goal),
        alsoLabel: str(s.alsoLabel, 20) || '同時開始',
        also: str(s.also),
      };
    case 'quote':
      return {
        ...base,
        quotes: (Array.isArray(s.quotes) ? s.quotes : [])
          .map((q) => (typeof q === 'string' ? { text: str(q), who: '' } : { text: str(q?.text), who: str(q?.who, 30) }))
          .filter((q) => q.text)
          .slice(0, 3),
        confirm: str(s.confirm),
      };
    case 'qa':
      return {
        ...base,
        items: (Array.isArray(s.items) ? s.items : [])
          .map((x) => ({ q: str(x?.q), a: str(x?.a, LIMITS.long) }))
          .filter((x) => x.q)
          .slice(0, 4),
      };
    case 'closing':
      return { ...base, confirm: str(s.confirm), steps: strList(s.steps, 4, 60) };
    default:
      return base;
  }
}

/** keepEmpty：本機存檔要保留使用者清空標題的頁；AI 回傳才過濾空頁 */
export function normalizeDeck(d = {}, { keepEmpty = false } = {}) {
  const slides = (Array.isArray(d?.slides) ? d.slides : [])
    .map(normalizeSlide)
    .filter((s) => keepEmpty || s.title || s.type === 'quote' || s.images.length);
  if (!slides.length) throw new Error('簡報沒有任何頁面');
  return {
    title: str(d.title, LIMITS.title + 20) || slides[0].title || 'DEMO 簡報',
    customer: str(d.customer, 30),
    theme: { font: normFont(d.theme?.font) },
    slides,
  };
}

export function parseDeckResponse(raw) {
  const cleaned = String(raw || '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
    .trim();
  let j;
  try {
    j = JSON.parse(cleaned);
  } catch {
    throw new Error('AI 回傳的不是完整 JSON，請再按一次產生');
  }
  return normalizeDeck(j);
}

/** 依投影片位置算出「05」這種內容頁編號；非編號頁回 0 */
export function slideNumbers(slides) {
  let n = 0;
  return (slides || []).map((s) => (NUMBERED_TYPES.has(s.type) ? ++n : 0));
}

export function hasCustomerInput(input = {}) {
  return INPUT_FIELDS.some((f) => str(input[f.key]).length > 0);
}

export function formatInputForPrompt(input = {}) {
  return INPUT_FIELDS.map((f) => `${f.label}：${str(input[f.key], 6000) || '（未填）'}`).join('\n');
}

const SKELETON = `第一部分「為什麼現在開始」（副標：先弄清楚方向，再決定怎麼學）
→ 節奏頁「先不要急著決定『十年後要做什麼』」：目前最重要的三件事（三張卡片）＋一句深藍橫幅結論
→ 工作方向頁「未來可以接觸哪些工作？」：2×2 方向卡（標籤＋三個例子＋「做什麼→做什麼」流程），技術門檻高的標成 muted「當成後續發展方向」
第二部分「N 個作品」（副標：不是學 AI，而是學會解決問題）
→ 每個作品一頁：常見情況（chips）→ 可以怎麼做（3–4 步流程，最後一步是成果）→ 累積什麼能力 → 可以對應的方向
→ 學習路徑「第 1 個月｜轉職準備期」：學習重點（chips）、這個月的目標、同時開始`;

export function buildDeckPrompt(input = {}, { courseNotes = '' } = {}) {
  const course = str(courseNotes, 6000);
  return `你是資深 AI 學院課程顧問，要幫業務把「有邀約的開發紀錄」做成 DEMO 時給客戶看的簡報。
這份簡報唯一的標準：每一頁都是這位客戶「喜歡的」或「想知道的」事——從他自己說過的話出發，不是公司的產品型錄。

【客戶資料（業務的開發紀錄）】
${formatInputForPrompt(input)}

【公司實際教的課程／方案重點】
${course || '（未提供——課程細節只能寫通用描述，不可編造課名、堂數、價格、師資或保證；並在 notes 提醒業務「請對照實際課綱」）'}

【參考：資深同事的簡報骨架（照這個節奏，但內容換成這位客戶的）】
${SKELETON}

【規則】
1. 每頁的 why 寫「這頁回應客戶的哪句話／哪個在意點」，盡量用「」引用原話。找不到依據的頁就不要做。
2. 只能用資料中有的客戶事實；不知道的不要編，改在 notes 寫「DEMO 時補問：…」。
3. 不承諾收入、接案、就業或轉職成功；不製造恐懼；不貶低客戶（不要寫「不學無術」「沒執行力」「耍廢」這類標籤，換成他聽得進去、願意點頭的說法，例如「想了很久，差的是第一步」）。
4. 客戶擔心或想知道的事，一定要有一頁 qa 正面回答；做不到的事要誠實寫。
5. 依客戶程度調整：新手用生活化例子、避免術語；進階者用專業詞、不要教基礎操作。
6. 作品要貼近客戶的興趣與背景（例：想做音樂翻唱自媒體的外送員→作品就是他自己的頻道內容；製造業工程師→品質異常報告自動化）。
7. notes 是給業務的講稿：這頁要說的一兩句話＋一個要問客戶的開放式問題（讓他自己說出來）。
8. 共 10–16 頁。文字要精簡：title ≤ 20 字、卡片 text ≤ 36 字、chips 每個 ≤ 8 字、流程每步 ≤ 8 字。
9. 第二頁之後要有一頁 quote「你說過的話」：2–3 句客戶原話＋confirm 收斂確認句。
10. 最後一頁 closing：confirm「所以你真正想要的是…，我理解對嗎？」＋ steps 下一步（2–3 個具體、他做得到的行動）。

輸出繁體中文 JSON（不要 markdown 圍欄）：
{"title":"簡報標題","customer":"客戶稱呼","slides":[
 {"type":"cover","title":"","subtitle":"","meta":"DEMO 日期或一句話","notes":"","why":""},
 {"type":"section","kicker":"第一部分","title":"","subtitle":"","notes":"","why":""},
 {"type":"quote","kicker":"你說過的話","title":"","quotes":[{"text":"客戶原話","who":"出處，如 開發通話"}],"confirm":"","notes":"","why":""},
 {"type":"cards","kicker":"節奏","title":"","subtitle":"","cards":[{"label":"第一","title":"","text":""}],"banner":"","notes":"","why":""},
 {"type":"grid","kicker":"方向","title":"","subtitle":"","items":[{"label":"方向一","title":"","tags":"例子、例子、例子","flow":"做什麼 → 做什麼 → 做什麼","muted":false}],"notes":"","why":""},
 {"type":"flow","kicker":"作品 一","title":"","subtitle":"","chipsLabel":"常見情況","chips":[""],"stepsLabel":"可以怎麼做","steps":[""],"gainLabel":"累積什麼能力","gain":"","mapLabel":"可以對應的方向","map":"","notes":"","why":""},
 {"type":"plan","kicker":"第 1 個月 ｜ 階段名","title":"","focus":[""],"goal":"","also":"","notes":"","why":""},
 {"type":"qa","kicker":"你在意的問題","title":"","items":[{"q":"","a":""}],"notes":"","why":""},
 {"type":"closing","title":"","subtitle":"","confirm":"","steps":[""],"notes":"","why":""}
]}
type 只能用上面九種，可重複使用（例如多個 flow、多個 plan）。`;
}

const TODO = '【待補】';

function lines(text) {
  return String(text || '')
    .split(/\n|[。！？!?；;]/)
    .map((s) => s.replace(/^[\s\d.、*•\-－:：]+/, '').trim())
    .filter((s) => s.length >= 4);
}

/** 沒有 AI 時的本機範本：照同事的骨架，把填好的欄位放進去，缺的標【待補】 */
export function templateDeck(input = {}) {
  const name = str(input.name, 30);
  const who = name || '你';
  const goalLines = lines(input.goals);
  const storyLines = lines(input.story);
  const rawLines = lines(input.raw);
  const quotes = [...goalLines, ...storyLines, ...rawLines].slice(0, 3);
  const concernLines = lines(input.concerns);
  const mainGoal = goalLines[0] || `${TODO}他最想完成的事`;
  return normalizeDeck({
    title: `${who}的 AI 學習藍圖`,
    customer: name,
    slides: [
      {
        type: 'cover',
        title: `${who}的 AI 學習藍圖`,
        subtitle: '先弄清楚方向，再決定怎麼學',
        meta: [str(input.demoAt, 30), str(input.product, 40)].filter(Boolean).join(' ・ '),
        notes: '開場先確認今天的目的：一起看方向，最後判斷適不適合。',
        why: '封面',
      },
      { type: 'section', kicker: '第一部分', title: '為什麼現在開始', subtitle: '先弄清楚方向，再決定怎麼學', notes: '', why: '先對齊動機再談課程' },
      {
        type: 'quote',
        kicker: '你說過的話',
        title: '這是你在電話裡跟我說的',
        quotes: quotes.length ? quotes.map((t) => ({ text: t, who: '開發通話' })) : [{ text: `${TODO}客戶原話`, who: '' }],
        confirm: `所以你真正想要的是「${mainGoal}」，我理解對嗎？`,
        notes: '一句一句念給他聽，停下來問：「這樣說對嗎？還有要補充的嗎？」',
        why: '用客戶自己的話開場，讓他感覺被聽懂',
      },
      {
        type: 'cards',
        kicker: '節奏',
        title: '先不要急著決定「十年後要做什麼」',
        subtitle: '目前最重要的，是先完成三件事',
        cards: [
          { label: '第一', title: '打好基本功', text: str(input.availability) ? `用你有的時間：${str(input.availability, 40)}` : `${TODO}依他的時間安排` },
          { label: '第二', title: '做出第一個作品', text: `圍繞「${mainGoal}」` },
          { label: '第三', title: '用作品打開下一步', text: '有成果之後，能選的方向反而更多' },
        ],
        banner: '先有第一個作品，之後的選擇會更多。',
        notes: '問他：「如果一個月後你已經做出第一個作品，你最想拿給誰看？」',
        why: str(input.traits) ? `客戶特質：${str(input.traits, 80)}` : '降低開始的門檻',
      },
      { type: 'section', kicker: '第二部分', title: '你的第一個作品', subtitle: '不是學 AI，而是學會解決你自己的問題', notes: '', why: '' },
      {
        type: 'flow',
        kicker: '作品 一',
        title: mainGoal.slice(0, 24),
        subtitle: str(input.background) ? `從你現在的狀況出發：${str(input.background, 40)}` : '',
        chips: [`${TODO}情境一`, `${TODO}情境二`, `${TODO}情境三`],
        steps: ['想法', 'AI 協助製作', '調整成你的風格', '發布成果'],
        gain: `${TODO}這個作品練到的能力`,
        map: str(input.product) || `${TODO}對應的方向`,
        notes: '依他的興趣把情境與流程改成他的例子，DEMO 時現場示範第一步。',
        why: `客戶目標：${mainGoal}`,
      },
      {
        type: 'plan',
        kicker: '第 1 個月 ｜ 起步期',
        title: '先建立基本能力＋完成第一個作品',
        focus: ['AI 基本觀念', '工具上手', '第一個作品'],
        goal: '完成第一個可以展示的作品。',
        also: '找出自己最想深入的方向。',
        notes: '請對照實際課綱調整每月重點。',
        why: str(input.availability) ? `學習時間：${str(input.availability, 60)}` : '',
      },
      {
        type: 'qa',
        kicker: '你在意的問題',
        title: '你可能想問的事',
        items: (concernLines.length ? concernLines : [`${TODO}他擔心的事`]).slice(0, 4).map((q) => ({ q, a: `${TODO}誠實回答（課程做不到的要直說）` })),
        notes: '每題先問「這是你最在意的嗎？」再回答。',
        why: '客戶擔心的事要正面回答',
      },
      {
        type: 'closing',
        title: '接下來，我們可以這樣開始',
        subtitle: '',
        confirm: `所以你真正想要的是「${mainGoal}」，我理解對嗎？`,
        steps: ['確認開始時間', '完成第一週的小作品', '一起檢視成果、調整方向'],
        notes: '客戶說「對」之後，再給二選一的開始時間。',
        why: '收斂確認＋具體下一步',
      },
    ],
  });
}

/** 從自寫複盤挑出「有邀約」的通話，帶入簡報的開發紀錄 */
export function invitedReflectionEntries(days = []) {
  const out = [];
  (days || []).forEach((day) => {
    (day?.entries || []).forEach((e) => {
      if (e?.inviteResult !== 'invited') return;
      const label = `${day.dateKey} · ${e.callTitle || e.linkedSource || `第 ${Number(e.slot) + 1} 通`}`;
      const text = [
        `【${label}】`,
        e.customerInfo && `客戶資訊：${e.customerInfo}`,
        e.iDid && `我做了什麼：${e.iDid}`,
        e.customerSaid && `客戶回應：${e.customerSaid}`,
        e.customerMind && `客戶當下可能在想：${e.customerMind}`,
      ]
        .filter(Boolean)
        .join('\n');
      out.push({ key: `${day.dateKey}#${e.slot}`, dateKey: day.dateKey, label, text });
    });
  });
  return out;
}

/** 編輯器用：依 "slides.3.cards.1.text" 寫回 */
export function setByPath(obj, path, value) {
  const keys = String(path).split('.');
  let cur = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = /^\d+$/.test(keys[i]) ? Number(keys[i]) : keys[i];
    if (cur == null || typeof cur !== 'object' || !(k in cur)) return false;
    cur = cur[k];
  }
  const last = /^\d+$/.test(keys[keys.length - 1]) ? Number(keys[keys.length - 1]) : keys[keys.length - 1];
  if (cur == null || typeof cur !== 'object') return false;
  if (Array.isArray(cur) && typeof last === 'number' && last >= cur.length) return false;
  cur[last] = value;
  return true;
}

export function moveSlide(deck, index, dir) {
  const to = index + dir;
  if (!deck?.slides || to < 0 || to >= deck.slides.length || index < 0 || index >= deck.slides.length) return index;
  const [s] = deck.slides.splice(index, 1);
  deck.slides.splice(to, 0, s);
  return to;
}

export function deckFileName(record = {}) {
  const base = str(record.input?.name, 20) || str(record.deck?.customer, 20) || 'DEMO';
  const when = str(record.input?.demoAt, 20).replace(/[^\w\u4e00-\u9fff-]+/g, '');
  return `${base}${when ? `_${when}` : ''}_DEMO簡報.pptx`.replace(/[\\/:*?"<>|\s]+/g, '_');
}

/* ---- 本機儲存 ---- */

export function emptyInput() {
  return Object.fromEntries(INPUT_FIELDS.map((f) => [f.key, '']));
}

export function newDeckRecord() {
  const now = Date.now();
  return { id: rid('deck'), createdAt: now, updatedAt: now, input: emptyInput(), deck: null, source: '' };
}

export function loadDecks() {
  try {
    const raw = JSON.parse(localStorage.getItem(DECKS_STORAGE_KEY) || '[]');
    return (Array.isArray(raw) ? raw : [])
      .filter((r) => r && r.id)
      .map((r) => {
        let deck = null;
        try {
          deck = r.deck ? normalizeDeck(r.deck, { keepEmpty: true }) : null;
        } catch {
          deck = null;
        }
        return { ...newDeckRecord(), ...r, input: { ...emptyInput(), ...(r.input || {}) }, deck };
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    return [];
  }
}

export function saveDecks(list) {
  localStorage.setItem(DECKS_STORAGE_KEY, JSON.stringify(list || []));
}

export function loadCourseNotes() {
  try {
    return localStorage.getItem(COURSE_NOTES_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveCourseNotes(text) {
  try {
    localStorage.setItem(COURSE_NOTES_STORAGE_KEY, String(text || ''));
  } catch {
    /* ignore */
  }
}
