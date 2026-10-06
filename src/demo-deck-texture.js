/**
 * 「紫色潮流」的大理石流紋：用 SVG 雜訊濾鏡即時產生（不放二進位圖檔）。
 * HTML 直接當背景圖；匯出 PPTX 時在瀏覽器把同一份 SVG 畫成 JPEG 嵌進去。
 */
const MARBLE_W = 1200;
const MARBLE_H = 520;

export const MARBLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${MARBLE_W}" height="${MARBLE_H}" viewBox="0 0 ${MARBLE_W} ${MARBLE_H}" preserveAspectRatio="xMidYMid slice">
<filter id="m" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
<feTurbulence type="fractalNoise" baseFrequency="0.0016 0.0042" numOctaves="3" seed="11" result="n"/>
<feTurbulence type="fractalNoise" baseFrequency="0.004" numOctaves="2" seed="4" result="w"/>
<feDisplacementMap in="n" in2="w" scale="260" xChannelSelector="R" yChannelSelector="G"/>
<feColorMatrix type="matrix" values="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 0 0 0 1"/>
<feComponentTransfer><feFuncR type="table" tableValues="0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0"/><feFuncG type="table" tableValues="0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0"/><feFuncB type="table" tableValues="0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0"/></feComponentTransfer>
<feComponentTransfer><feFuncR type="linear" slope="3.2" intercept="-1.1"/><feFuncG type="linear" slope="3.2" intercept="-1.1"/><feFuncB type="linear" slope="3.2" intercept="-1.1"/></feComponentTransfer>
<feComponentTransfer><feFuncR type="table" tableValues="0.07 0.73"/><feFuncG type="table" tableValues="0.04 0.55"/><feFuncB type="table" tableValues="0.11 0.96"/></feComponentTransfer>
</filter>
<rect x="-300" y="-150" width="${MARBLE_W + 600}" height="${MARBLE_H + 300}" filter="url(#m)"/>
</svg>`;

export const MARBLE_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(MARBLE_SVG)}`;

/** 瀏覽器端把大理石紋畫成 JPEG data URL；非瀏覽器環境（測試）回傳空字串 */
export async function marbleJpeg() {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return '';
  try {
    const img = new Image();
    img.src = MARBLE_URL;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = MARBLE_W;
    canvas.height = MARBLE_H;
    canvas.getContext('2d').drawImage(img, 0, 0, MARBLE_W, MARBLE_H);
    return canvas.toDataURL('image/jpeg', 0.86);
  } catch {
    return '';
  }
}

export const MARBLE_RATIO = MARBLE_H / MARBLE_W;
