import { assignSpeakerRoles, splitCueBody } from './speaker-labels.js';
import { countChars, tsToSec } from './utils.js';

export function parseVibeJson(raw) {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!data || !Array.isArray(data.segments)) return [];
  const segs = data.segments
    .filter((s) => s && String(s.text || '').trim())
    .map((s) => {
      const seg = {
        start: (s.start ?? 0) / 1000,
        end: (s.stop ?? s.end ?? s.start ?? 0) / 1000,
        text: String(s.text).trim(),
      };
      if (s.speaker != null && s.speaker !== '') seg.speakerId = Number(s.speaker);
      return seg;
    });
  return assignSpeakerRoles(segs);
}

export function parse(text) {
  const out = [];
  const re =
    /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*\n([\s\S]*?)(?=\n\s*\n|\n\d+\s*\n|$)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const { speakerId, text: cueText } = splitCueBody(m[9]);
    if (!cueText) continue;
    const seg = {
      start: tsToSec(m[1], m[2], m[3], m[4]),
      end: tsToSec(m[5], m[6], m[7], m[8]),
      text: cueText,
    };
    if (speakerId != null) seg.speakerId = speakerId;
    out.push(seg);
  }
  if (out.length) return assignSpeakerRoles(out);

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
    if (s.labeled) return;
    const { speakerId, text } = splitCueBody(s.text);
    if (speakerId != null) {
      s.speakerId = speakerId;
      s.text = text;
    }
  });
  return assignSpeakerRoles(segs);
}

export function enrichSegments(segs) {
  segs.forEach((s) => {
    s.chars = countChars(s.text);
    s.dur = Math.max(0.5, s.end - s.start);
    if (!s.spk) s.spk = 'S';
  });
  return segs;
}
