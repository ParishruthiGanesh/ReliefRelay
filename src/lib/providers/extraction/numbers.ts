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

/** Rewrites number words into digits so one set of patterns handles both. */
export function digitize(text: string): string {
  let out = text.toLowerCase();

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

export function firstNumber(text: string): number | null {
  const match = digitize(text).match(/\b(\d{1,7})(?:\.(\d{1,2}))?\b/);
  if (!match) return null;
  const value = Number(match[2] ? `${match[1]}.${match[2]}` : match[1]);
  return Number.isFinite(value) ? value : null;
}
