export function sanitize(s: string): string {
  const ESC = String.fromCharCode(0x1b);
  const BEL = String.fromCharCode(0x07);
  const ST = `${ESC}\\\\`;
  const csi = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g');
  // OSC: ESC ] then any chars (non-greedy), then terminator (BEL or ST)
  const osc = new RegExp(`${ESC}\\][\\s\\S]*?(?:${BEL}|${ST})`, 'g');
  // DCS: ESC P ... ST (Device Control String)
  const dcs = new RegExp(`${ESC}P[\\s\\S]*?(?:${BEL}|${ST})`, 'g');
  // APC: ESC _ ... ST (Application Program Command)
  const apc = new RegExp(`${ESC}_[\\s\\S]*?(?:${BEL}|${ST})`, 'g');
  const c1 = /[\u0080-\u009F]/g;
  // C0 controls except tab (0x09), LF (0x0A), CR (0x0D). The CSI/OSC/DCS/APC
  // branches already swallow many of these as part of the sequence, but
  // stragglers (BEL, NUL, etc.) must also be removed to keep terminal output
  // safe to render.
  // oxlint-disable-next-line no-control-regex
  const c0 = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
  return s
    .replace(dcs, '')
    .replace(apc, '')
    .replace(osc, '')
    .replace(csi, '')
    .replace(c1, '')
    .replace(c0, '')
    .replace(/\r\n|[\r\n]/g, ' ');
}
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    cp === 0x2329 ||
    cp === 0x232a ||
    (cp >= 0x2e80 && cp <= 0x303e) ||
    (cp >= 0x3041 && cp <= 0x33ff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  );
}

// Visual column width: CJK / full-width codepoints occupy two columns.
// Stays inline; no native Intl.Segmenter to keep startup time small.
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    w += isWide(cp) ? 2 : 1;
  }
  return w;
}
