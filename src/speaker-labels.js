/** Match leading speaker tag in a line or cue. */
const SPEAKER_PREFIX_RE =
  /^(?:Speaker|說話者|发言人|發言者)\s*(\d+)\s*(?:[:：]\s*|\]\s*|[-–—]\s*|\s+)?(.*)$/i;
const SPEAKER_BRACKET_RE = /^\[(?:Speaker|說話者|发言人|發言者)\s*(\d+)\]\s*(.*)$/i;
/** WhisperX diarization: [SPEAKER_00], SPEAKER_01:, etc. */
const WHISPERX_SPEAKER_RE = /^\[?SPEAKER[_\s-]?(\d+)\]?\s*:?\s*(.*)$/i;

export function parseSpeakerLine(line) {
  const t = String(line || '').trim();
  if (!t) return null;
  let m = t.match(SPEAKER_BRACKET_RE);
  if (m) return { id: +m[1], rest: m[2].trim() };
  m = t.match(WHISPERX_SPEAKER_RE);
  if (m) return { id: +m[1], rest: m[2].trim() };
  m = t.match(SPEAKER_PREFIX_RE);
  if (m) return { id: +m[1], rest: m[2].trim() };
  return null;
}

/** Map speaker ids to S/C: lowest id in file → 業務, others → 客戶 (supports 0/1 or 1/2). */
export function assignSpeakerRoles(segs) {
  const ids = segs.map((s) => s.speakerId).filter((id) => id != null);
  if (!ids.length) return segs;
  const salesId = Math.min(...ids);
  segs.forEach((s) => {
    if (s.speakerId == null) return;
    s.spk = s.speakerId === salesId ? 'S' : 'C';
    s.labeled = true;
    delete s.speakerId;
  });
  return segs;
}

export function splitCueBody(body) {
  const lines = String(body)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { text: '' };

  // Line 1 = speaker label only, rest = transcript
  if (lines.length >= 2) {
    const head = parseSpeakerLine(lines[0]);
    if (head && !head.rest) {
      return { speakerId: head.id, text: lines.slice(1).join(' ') };
    }
  }

  const head = parseSpeakerLine(lines[0]);
  if (head) {
    const rest = [head.rest, ...lines.slice(1)].filter(Boolean).join(' ');
    return { speakerId: head.id, text: rest };
  }

  return { text: lines.join(' ') };
}

export function labeledRatio(segs) {
  if (!segs.length) return 0;
  return segs.filter((s) => s.labeled).length / segs.length;
}
