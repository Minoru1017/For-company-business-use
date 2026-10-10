/**
 * 主管早會面板的畫面：HTML 骨架與逐字稿／重點／專案方向／過去早會清單的 HTML（純字串，不碰 DOM）。
 */
import { POINT_CATEGORIES, defaultMeetingTitle, formatClock } from './meeting-notes.js';
import { escapeHTML } from './utils.js';

export function dateKeyOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function meetingNotesTemplate() {
  return `
  <div class="brief">
    <div class="card brief-rec">
      <div class="brief-rec-head">
        <div>
          <h2 class="brief-h">即時語音紀錄</h2>
          <p class="hint brief-lead">早會開始前按「開始錄音」，主管講的話會即時轉成文字；結束後萃取重點、勾選確認，再套用成這套工具的方向。</p>
        </div>
        <span class="brief-status" id="bfStatus">待命</span>
      </div>
      <p class="hint brief-consent">語音辨識由瀏覽器提供（Chrome／Edge 會把聲音送到瀏覽器供應商處理），逐字稿與重點只存在這台電腦。不支援的瀏覽器可在下方直接貼上文字。</p>
      <div class="brief-mic-check" id="bfMicCheck">
        <span class="brief-mic-check-dot" aria-hidden="true"></span>
        <span id="bfMicText">按「開始錄音」後會先檢查麥克風，第一次使用請在瀏覽器跳出的視窗按「允許」。</span>
        <button type="button" class="btn slog-mini" id="bfMicRetry" hidden>重新檢查</button>
      </div>
      <div class="brief-input-settings">
        <label>錄音來源
          <select class="field" id="bfMicDevice"><option value="">Windows／瀏覽器預設麥克風</option></select>
        </label>
        <button type="button" class="btn slog-mini" id="bfMicDevices">重新載入裝置</button>
        <label>收音模式
          <select class="field" id="bfAudioPreset">
            <option value="standard">一般近距離</option>
            <option value="distant">遠距離主管</option>
            <option value="raw">原始收音</option>
            <option value="custom">自訂</option>
          </select>
        </label>
      </div>
      <div class="brief-processing-options" id="bfProcessingOptions">
        <label><input type="checkbox" id="bfNoiseSuppression"> 降噪</label>
        <label><input type="checkbox" id="bfEchoCancellation"> 回音消除</label>
        <label><input type="checkbox" id="bfAutoGain"> 自動增益</label>
      </div>
      <p class="hint brief-input-hint">主管離裝置較遠時選「遠距離主管」：關閉降噪與回音消除、保留自動增益，避免較小的人聲被當成背景音濾掉。三項也可自行勾選調整。</p>
      <div class="brief-level" id="bfLevel" hidden>
        <span class="brief-level-label">MIC</span>
        <span class="brief-level-track"><span id="bfLevelFill"></span></span>
        <span class="brief-level-text" id="bfLevelText">等待聲音</span>
      </div>
      <div class="brief-rec-controls">
        <button type="button" class="brief-rec-btn" id="bfToggle"><span class="brief-rec-dot" aria-hidden="true"></span><span id="bfToggleLabel">開始錄音</span></button>
        <span class="brief-timer" id="bfTimer">00:00</span>
        <span class="brief-save-state" id="bfSaveState">尚未錄音</span>
        <input type="text" class="field brief-title" id="bfTitle" placeholder="${escapeHTML(defaultMeetingTitle())}" maxlength="60">
        <button type="button" class="btn" id="bfFinish" disabled>結束並整理</button>
      </div>
      <div class="brief-live" id="bfLive" hidden><span class="brief-live-dot" aria-hidden="true"></span><span id="bfInterim" class="brief-interim">聆聽中…</span></div>
      <ol class="brief-lines" id="bfLines"></ol>
      <div class="brief-audio-review" id="bfAudioReview" hidden>
        <div class="brief-audio-review-head">
          <div><strong>本次早會錄音</strong><span class="hint" id="bfAudioMeta"></span></div>
          <a class="btn slog-mini" id="bfAudioDownload" download="主管早會.webm">下載備份</a>
        </div>
        <audio id="bfAudio" controls preload="metadata"></audio>
        <div class="row brief-audio-actions">
          <button type="button" class="primary" id="bfAudioTranscribe">用 Gemini 轉成逐字稿</button>
          <span class="hint" id="bfAudioStatus">若即時文字沒有出現，可用實際錄下的音訊補轉；按下後錄音會送到 Google Gemini。</span>
        </div>
      </div>
      <p class="hint brief-unsupported" id="bfUnsupported" hidden>這個瀏覽器不支援即時語音辨識（建議用 Chrome 或 Edge）。你仍可在下方貼上逐字稿再萃取重點。</p>
    </div>

    <div class="card brief-transcript" id="bfTranscriptCard" hidden>
      <h2 class="brief-h">逐字稿 <span class="slog-count" id="bfLineCount"></span></h2>
      <p class="hint">辨識錯字可直接修；萃取會以這裡的文字為準。</p>
      <textarea class="field brief-text" id="bfText" rows="8" placeholder="貼上或修正主管講話內容…"></textarea>
      <div class="row brief-actions">
        <button type="button" class="primary" id="bfExtract">萃取重點（本機規則）</button>
        <button type="button" class="btn" id="bfExtractAI">AI 萃取重點</button>
        <span class="hint brief-extract-hint" id="bfExtractHint">本機規則只抓「指示語氣、數字目標、話術」句子；AI 會用 Gemini 改寫成清楚的指示。</span>
      </div>
      <div class="row brief-key-row" id="bfKeyRow" hidden>
        <input type="password" class="field" id="bfApiKey" placeholder="貼上 Gemini API Key（與其他模式共用）" autocomplete="off" style="flex:1;min-width:220px">
        <span class="hint" id="bfKeyHint"></span>
      </div>
    </div>

    <div class="card brief-points" id="bfPointsCard" hidden>
      <div class="brief-points-head">
        <h2 class="brief-h">重點 <span class="slog-count" id="bfPointCount"></span></h2>
        <p class="hint">勾選要採用的、可直接改字；「做法」是業務今天能做的一步。</p>
      </div>
      <p class="brief-theme" id="bfTheme" hidden></p>
      <ul class="brief-point-list" id="bfPointList"></ul>
      <div class="row brief-actions">
        <button type="button" class="btn" id="bfAddPoint">＋ 新增一點</button>
        <button type="button" class="primary" id="bfApply">確認並套用到專案方向</button>
        <span class="hint" id="bfApplyHint">套用後：首頁與各模式頁首會顯示；電訪 AI 分析、症狀 AI 診斷會對齊這些方向。</span>
      </div>
    </div>

    <div class="card brief-directives">
      <h2 class="brief-h">目前專案方向 <span class="slog-count" id="bfDirCount"></span></h2>
      <p class="hint">這些是你確認過的主管指示。封存後不再帶進 AI，也不在頁首顯示。</p>
      <ul class="brief-dir-list" id="bfDirList"></ul>
    </div>

    <div class="card brief-history">
      <h2 class="brief-h">過去早會 <span class="slog-count" id="bfHistCount"></span></h2>
      <ul class="brief-hist-list" id="bfHistList"></ul>
    </div>
  </div>`;
}

export function linesHtml(lines) {
  return (lines || [])
    .map((l) => `<li><span class="brief-line-t">${formatClock(l.t)}</span><span class="brief-line-text">${escapeHTML(l.text)}</span></li>`)
    .join('');
}

const SOURCE_LABELS = { ai: 'AI', manual: '手動' };

export function pointsHtml(points) {
  const pts = points || [];
  const catOpts = (cur) =>
    Object.entries(POINT_CATEGORIES)
      .map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.label}</option>`)
      .join('');
  return pts.length
    ? pts
        .map(
          (p) => `<li class="brief-point ${p.selected ? 'on' : ''}" data-id="${escapeHTML(p.id)}">
          <label class="brief-point-check"><input type="checkbox" data-sel ${p.selected ? 'checked' : ''}></label>
          <div class="brief-point-body">
            <div class="brief-point-row">
              <select class="field brief-point-cat" data-cat>${catOpts(p.category)}</select>
              <input type="text" class="field brief-point-text" data-text value="${escapeHTML(p.text)}" placeholder="重點（一句話）">
              <span class="brief-point-src">${SOURCE_LABELS[p.source] || '規則'}</span>
              <button type="button" class="btn slog-mini danger" data-del title="刪除">✕</button>
            </div>
            <input type="text" class="field brief-point-action" data-action value="${escapeHTML(p.action || '')}" placeholder="做法：業務今天可以怎麼做（選填）">
          </div>
        </li>`
        )
        .join('')
    : '<li class="hint brief-empty">尚無重點。按上方「萃取重點」或「＋ 新增一點」。</li>';
}

export function directivesHtml(list) {
  return list?.length
    ? list
        .map(
          (d) => `<li class="brief-dir ${d.archived ? 'archived' : ''}" data-id="${escapeHTML(d.id)}">
          <span class="brief-dir-cat">${escapeHTML(POINT_CATEGORIES[d.category]?.label || '')}</span>
          <div class="brief-dir-body">
            <span class="brief-dir-text">${escapeHTML(d.text)}</span>
            ${d.action ? `<span class="brief-dir-act">做法：${escapeHTML(d.action)}</span>` : ''}
            <span class="brief-dir-meta">${escapeHTML(d.date || '')}${d.meetingTitle ? ` · ${escapeHTML(d.meetingTitle)}` : ''}${d.archived ? ' · 已封存' : ''}</span>
          </div>
          <span class="brief-dir-actions">
            <button type="button" class="btn slog-mini" data-archive="${d.archived ? '0' : '1'}">${d.archived ? '恢復' : '封存'}</button>
            <button type="button" class="btn slog-mini danger" data-remove>刪除</button>
          </span>
        </li>`
        )
        .join('')
    : '<li class="hint brief-empty">尚未套用任何方向。錄完早會、萃取重點並確認後會出現在這裡。</li>';
}

export function historyHtml(list, currentId = '') {
  return list?.length
    ? list
        .map((m) => {
          const dur = m.endedAt && m.startedAt ? Math.round((m.endedAt - m.startedAt) / 60000) : null;
          const cur = currentId && currentId === m.id;
          return `<li class="brief-hist ${cur ? 'current' : ''}" data-id="${escapeHTML(m.id)}">
            <div class="brief-hist-main">
              <span class="brief-hist-title">${escapeHTML(m.title)}</span>
              <span class="brief-hist-meta">${escapeHTML(dateKeyOf(m.startedAt))}${dur != null ? ` · ${dur} 分` : ''} · ${m.lines?.length || 0} 段 · ${m.points?.length || 0} 點${m.applied ? ' · <b>已套用</b>' : ''}</span>
            </div>
            <span class="brief-hist-actions">
              <button type="button" class="btn slog-mini" data-open>開啟</button>
              <button type="button" class="btn slog-mini danger" data-del>刪除</button>
            </span>
          </li>`;
        })
        .join('')
    : '<li class="hint brief-empty">還沒有紀錄。</li>';
}
