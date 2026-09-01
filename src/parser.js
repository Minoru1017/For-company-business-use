import { countChars, tsToSec } from './utils.js';

export function parse(text) {
  const out = [];
  const re =
    /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*\n([\s\S]*?)(?=\n\s*\n|\n\d+\s*\n|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const t = m[9].replace(/\n/g, ' ').trim();
    if (t) {
      out.push({
        start: tsToSec(m[1], m[2], m[3], m[4]),
        end: tsToSec(m[5], m[6], m[7], m[8]),
        text: t,
      });
    }
  }
  if (out.length) return out;

  const lines = text.split('\n');
  const re2 = /^\[?(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]?\s*(.+)$/;
  const tmp = [];
  for (const line of lines) {
    const mm = line.trim().match(re2);
    if (mm && mm[4]) tmp.push({ start: tsToSec(mm[1] || 0, mm[2], mm[3], 0), text: mm[4].trim() });
  }
  for (let i = 0; i < tmp.length; i++) {
    tmp[i].end = i + 1 < tmp.length ? tmp[i + 1].start : tmp[i].start + 5;
    out.push(tmp[i]);
  }
  return out;
}

export function applyBuiltinSpeakerLabels(segs) {
  segs.forEach((s) => {
    const sp = s.text.match(/^(?:Speaker|說話者|发言人)\s*(\d+)\s*[:：]\s*(.*)$/i);
    if (sp) {
      s.spk = sp[1] === '0' ? 'S' : 'C';
      s.text = sp[2];
      s.labeled = true;
    }
  });
  return segs;
}

export function enrichSegments(segs) {
  segs.forEach((s) => {
    s.chars = countChars(s.text);
    s.dur = Math.max(0.5, s.end - s.start);
    if (!s.spk) s.spk = 'S';
  });
  return segs;
}
