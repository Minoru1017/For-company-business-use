const salesHints =
  /我是|我們的|我們有|課程|方案|請問|方便|跟您|幫您|建議您|安排|了解一下|想問|好奇|請教/;

export function isQuestion(t) {
  return /[?？]|嗎$|嗎[。,，]|呢$|呢[。,，]/.test(t);
}

export function autoGuess(segs) {
  segs.forEach((s) => {
    let score = 0;
    if (salesHints.test(s.text)) score += 2;
    if (isQuestion(s.text)) score += 1;
    if (s.text.length <= 6) score -= 1;
    s.spk = score >= 1 ? 'S' : 'C';
  });
  return segs;
}
