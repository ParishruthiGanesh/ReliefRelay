/** Spoken numbers reach us as digits or as words, depending on the service. */

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};

/**
 * Rewrites number words into digits so one set of patterns handles both.
 *
 * `extraWords` carries the language's own number words; Devanagari, Tamil and
 * Telugu digits are normalised first because a speech service may return
 * either form.
 */
export function digitize(text: string, extraWords: Record<string, number> = {}): string {
  let out = normaliseDigits(text).toLowerCase();

  // Longest first, so "veinticinco" is not eaten by "cinco".
  for (const [word, value] of Object.entries(extraWords).sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(word.toLowerCase()).join(String(value));
  }

  // "twenty-five" / "twenty five" -> "25"
  for (const [tensWord, tensValue] of Object.entries(TENS)) {
    for (const [unitWord, unitValue] of Object.entries(UNITS)) {
      if (unitValue === 0 || unitValue > 9) continue;
      const re = new RegExp(`\\b${tensWord}[\\s-]${unitWord}\\b`, 'g');
      out = out.replace(re, String(tensValue + unitValue));
    }
    out = out.replace(new RegExp(`\\b${tensWord}\\b`, 'g'), String(tensValue));
  }
  for (const [word, value] of Object.entries(UNITS)) {
    out = out.replace(new RegExp(`\\b${word}\\b`, 'g'), String(value));
  }
  // "2 hundred" / "a hundred" -> 200 / 100
  out = out.replace(/\b(\d+)\s+hundred\b/g, (_m, n) => String(Number(n) * 100));
  out = out.replace(/\b(a|one)\s+hundred\b/g, '100');
  out = out.replace(/\b(\d+)\s+thousand\b/g, (_m, n) => String(Number(n) * 1000));
  return out;
}

/** Indic digit forms normalised to 0-9. */
export function normaliseDigits(text: string): string {
  const ranges: Array<[number, number]> = [
    [0x0966, 0x096f], // Devanagari
    [0x0be6, 0x0bef], // Tamil
    [0x0c66, 0x0c6f], // Telugu
  ];
  return text.replace(/[\u0966-\u096f\u0be6-\u0bef\u0c66-\u0c6f]/g, (char) => {
    const code = char.codePointAt(0)!;
    for (const [start, end] of ranges) {
      if (code >= start && code <= end) return String(code - start);
    }
    return char;
  });
}

export function firstNumber(text: string, extraWords: Record<string, number> = {}): number | null {
  const match = digitize(text, extraWords).match(/\b(\d{1,7})(?:\.(\d{1,2}))?\b/);
  if (!match) return null;
  const value = Number(match[2] ? `${match[1]}.${match[2]}` : match[1]);
  return Number.isFinite(value) ? value : null;
}
