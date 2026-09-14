// Arabic character shaping and Bidirectional (RTL) text visual reordering for terminal output.

const ARABIC_FORMS: Record<number, [number, number, number, number]> = {
  0x0621: [0xfe80, 0xfe80, 0xfe80, 0xfe80], // Hamza
  0x0622: [0xfe81, 0xfe82, 0xfe81, 0xfe82], // Alef with Madda
  0x0623: [0xfe83, 0xfe84, 0xfe83, 0xfe84], // Alef with Hamza Above
  0x0624: [0xfe85, 0xfe86, 0xfe85, 0xfe86], // Waw with Hamza Above
  0x0625: [0xfe87, 0xfe88, 0xfe87, 0xfe88], // Alef with Hamza Below
  0x0626: [0xfe89, 0xfe8a, 0xfe8b, 0xfe8c], // Yeh with Hamza Above
  0x0627: [0xfe8d, 0xfe8e, 0xfe8d, 0xfe8e], // Alef
  0x0628: [0xfe8f, 0xfe90, 0xfe91, 0xfe92], // Beh
  0x0629: [0xfe93, 0xfe94, 0xfe93, 0xfe94], // Teh Marbuta
  0x062a: [0xfe95, 0xfe96, 0xfe97, 0xfe98], // Teh
  0x062b: [0xfe99, 0xfe9a, 0xfe9b, 0xfe9c], // Theh
  0x062c: [0xfe9d, 0xfe9e, 0xfe9f, 0xfea0], // Jeem
  0x062d: [0xfea1, 0xfea2, 0xfea3, 0xfea4], // Hah
  0x062e: [0xfea5, 0xfea6, 0xfea7, 0xfea8], // Khah
  0x062f: [0xfea9, 0xfeaa, 0xfea9, 0xfeaa], // Dal
  0x0630: [0xfeab, 0xfeac, 0xfeab, 0xfeac], // Thal
  0x0631: [0xfead, 0xfeae, 0xfead, 0xfeae], // Reh
  0x0632: [0xfeaf, 0xfeb0, 0xfeaf, 0xfeb0], // Zain
  0x0633: [0xfeb1, 0xfeb2, 0xfeb3, 0xfeb4], // Seen
  0x0634: [0xfeb5, 0xfeb6, 0xfeb7, 0xfeb8], // Sheen
  0x0635: [0xfeb9, 0xfeba, 0xfebb, 0xfebc], // Sad
  0x0636: [0xfebd, 0xfebe, 0xfebf, 0xfec0], // Dad
  0x0637: [0xfec1, 0xfec2, 0xfec3, 0xfec4], // Tah
  0x0638: [0xfec5, 0xfec6, 0xfec7, 0xfec8], // Zah
  0x0639: [0xfec9, 0xfeca, 0xfecb, 0xfecc], // Ain
  0x063a: [0xfecd, 0xfece, 0xfecf, 0xfed0], // Ghain
  0x0641: [0xfed1, 0xfed2, 0xfed3, 0xfed4], // Feh
  0x0642: [0xfed5, 0xfed6, 0xfed7, 0xfed8], // Qaf
  0x0643: [0xfed9, 0xfeda, 0xfedb, 0xfedc], // Kaf
  0x0644: [0xfedd, 0xfede, 0xfedf, 0xfee0], // Lam
  0x0645: [0xfee1, 0xfee2, 0xfee3, 0xfee4], // Meem
  0x0646: [0xfee5, 0xfee6, 0xfee7, 0xfee8], // Noon
  0x0647: [0xfee9, 0xfeea, 0xfeeb, 0xfeec], // Heh
  0x0648: [0xfeed, 0xfeee, 0xfeed, 0xfeee], // Waw
  0x0649: [0xfeef, 0xfef0, 0xfeef, 0xfef0], // Alef Maksura
  0x064a: [0xfef1, 0xfef2, 0xfef3, 0xfef4], // Yeh
  // Extended Persian/Urdu and Quranic letters
  0x0671: [0xfb50, 0xfb51, 0xfb50, 0xfb51], // Alef Wasla
  0x067e: [0xfb56, 0xfb57, 0xfb58, 0xfb59], // Peh
  0x0686: [0xfb7a, 0xfb7b, 0xfb7c, 0xfb7d], // Tcheh
  0x0698: [0xfb8a, 0xfb8b, 0xfb8a, 0xfb8b], // Jeh
  0x06af: [0xfb92, 0xfb93, 0xfb94, 0xfb95], // Gaf
};

// 0 = none, 1 = right-only (forward in reading direction), 2 = dual
const ARABIC_CONNECTIVITY: Record<number, number> = {
  0x0621: 0,
  0x0622: 1,
  0x0623: 1,
  0x0624: 1,
  0x0625: 1,
  0x0627: 1,
  0x0629: 1,
  0x062f: 1,
  0x0630: 1,
  0x0631: 1,
  0x0632: 1,
  0x0648: 1,
  0x0649: 1,
  0x0671: 1,
  0x0698: 1,
  0x0626: 2,
  0x0628: 2,
  0x062a: 2,
  0x062b: 2,
  0x062c: 2,
  0x062d: 2,
  0x062e: 2,
  0x0633: 2,
  0x0634: 2,
  0x0635: 2,
  0x0636: 2,
  0x0637: 2,
  0x0638: 2,
  0x0639: 2,
  0x063a: 2,
  0x0641: 2,
  0x0642: 2,
  0x0643: 2,
  0x0644: 2,
  0x0645: 2,
  0x0646: 2,
  0x0647: 2,
  0x064a: 2,
  0x067e: 2,
  0x0686: 2,
  0x06af: 2,
};

const LAM_ALEF_LIGATURES: Record<number, [number, number]> = {
  0x0622: [0xfef5, 0xfef6], // Lam + Alef with Madda
  0x0623: [0xfef7, 0xfef8], // Lam + Alef with Hamza Above
  0x0625: [0xfef9, 0xfefa], // Lam + Alef with Hamza Below
  0x0627: [0xfefb, 0xfefc], // Lam + Alef
  0x0671: [0xfefb, 0xfefc], // Lam + Alef Wasla
};

function isTashkeel(code: number): boolean {
  return (code >= 0x064b && code <= 0x065f) || code === 0x0670;
}

export function shapeArabic(text: string): string {
  const codes: number[] = [];
  for (const ch of text) {
    codes.push(ch.charCodeAt(0));
  }
  const n = codes.length;
  const result: string[] = [];

  for (let i = 0; i < n; i++) {
    const code = codes[i]!;
    if (isTashkeel(code)) {
      result.push(String.fromCharCode(code));
      continue;
    }

    // Check Lam-Alef ligature
    if (code === 0x0644 && i + 1 < n) {
      let nextIdx = i + 1;
      while (nextIdx < n && isTashkeel(codes[nextIdx]!)) nextIdx++;
      if (nextIdx < n) {
        const nextCode = codes[nextIdx]!;
        const lig = LAM_ALEF_LIGATURES[nextCode];
        if (lig) {
          let prevIdx = i - 1;
          while (prevIdx >= 0 && isTashkeel(codes[prevIdx]!)) prevIdx--;
          const prevCode = prevIdx >= 0 ? codes[prevIdx]! : 0;
          const connectsPrev = prevCode && ARABIC_CONNECTIVITY[prevCode] === 2;
          result.push(String.fromCharCode(connectsPrev ? lig[1] : lig[0]));
          i = nextIdx;
          continue;
        }
      }
    }

    const forms = ARABIC_FORMS[code];
    if (!forms) {
      result.push(String.fromCharCode(code));
      continue;
    }

    let prevIdx = i - 1;
    while (prevIdx >= 0 && isTashkeel(codes[prevIdx]!)) prevIdx--;
    const prevCode = prevIdx >= 0 ? codes[prevIdx]! : 0;

    let nextIdx = i + 1;
    while (nextIdx < n && isTashkeel(codes[nextIdx]!)) nextIdx++;
    const nextCode = nextIdx < n ? codes[nextIdx]! : 0;

    const connectsPrev = prevCode && ARABIC_CONNECTIVITY[prevCode] === 2;
    const connectsNext =
      nextCode &&
      (ARABIC_CONNECTIVITY[nextCode] === 1 || ARABIC_CONNECTIVITY[nextCode] === 2) &&
      ARABIC_CONNECTIVITY[code] === 2;

    let formIndex = 0; // isolated
    if (connectsPrev && connectsNext) formIndex = 3; // medial
    else if (connectsPrev) formIndex = 1; // final
    else if (connectsNext) formIndex = 2; // initial

    result.push(String.fromCharCode(forms[formIndex]!));
  }
  return result.join('');
}

const RTL_REGEX = /[\u0590-\u083F]|[\u08A0-\u08FF]|[\uFB1D-\uFDFF]|[\uFE70-\uFEFC]/;

export function isRtl(text: string): boolean {
  return RTL_REGEX.test(text);
}

function mirrorBracket(ch: string): string {
  if (ch === '(') return ')';
  if (ch === ')') return '(';
  if (ch === '[') return ']';
  if (ch === ']') return '[';
  if (ch === '{') return '}';
  if (ch === '}') return '{';
  if (ch === '<') return '>';
  if (ch === '>') return '<';
  return ch;
}

export function processRtlText(text: string): string {
  if (!RTL_REGEX.test(text)) return text;

  // 1. Shape Arabic characters
  const shaped = shapeArabic(text);

  // 2. Segment into RTL runs vs LTR runs
  const tokens: Array<{ text: string; isRtl: boolean }> = [];
  let currentRun = '';
  let isCurrentRtl = false;

  const chars = Array.from(shaped);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const rtl = RTL_REGEX.test(ch);
    if (rtl) {
      if (!isCurrentRtl && currentRun.length > 0) {
        tokens.push({ text: currentRun, isRtl: false });
        currentRun = '';
      }
      isCurrentRtl = true;
      currentRun += ch;
    } else if (
      isCurrentRtl &&
      (ch === ' ' ||
        ch === '!' ||
        ch === '?' ||
        ch === '.' ||
        ch === ',' ||
        ch === '(' ||
        ch === ')')
    ) {
      let hasRtlAhead = false;
      for (let j = i + 1; j < chars.length; j++) {
        const nextChar = chars[j]!;
        if (RTL_REGEX.test(nextChar)) {
          hasRtlAhead = true;
          break;
        }
        if (/[A-Za-z0-9]/.test(nextChar)) {
          break;
        }
      }
      if (hasRtlAhead) {
        currentRun += mirrorBracket(ch);
      } else {
        tokens.push({ text: currentRun, isRtl: true });
        currentRun = ch;
        isCurrentRtl = false;
      }
    } else {
      if (isCurrentRtl && currentRun.length > 0) {
        tokens.push({ text: currentRun, isRtl: true });
        currentRun = '';
      }
      isCurrentRtl = false;
      currentRun += ch;
    }
  }
  if (currentRun.length > 0) {
    tokens.push({ text: currentRun, isRtl: isCurrentRtl });
  }

  const segmenter = new Intl.Segmenter('ar', { granularity: 'grapheme' });
  return tokens
    .map((tok) =>
      tok.isRtl
        ? Array.from(segmenter.segment(tok.text), (s) => s.segment)
            .toReversed()
            .join('')
        : tok.text,
    )
    .join('');
}

export function visualLength(text: string): number {
  let len = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0;
    // Tashkeel and combining diacritics occupy 0 character cells
    if (
      (code >= 0x0300 && code <= 0x036f) ||
      (code >= 0x064b && code <= 0x065f) ||
      code === 0x0670
    ) {
      continue;
    }
    // CJK and fullwidth characters occupy 2 character cells
    if (
      (code >= 0x1100 && code <= 0x11ff) ||
      (code >= 0x2e80 && code <= 0x9fff) ||
      (code >= 0xff01 && code <= 0xff60)
    ) {
      len += 2;
    } else {
      len += 1;
    }
  }
  return len;
}
