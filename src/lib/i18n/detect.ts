import { isSupported, type SupportedLanguage } from './messages';

/**
 * Which language someone just spoke or typed.
 *
 * Script ranges are decisive — Devanagari, Tamil and Telugu text is not going
 * to be anything else. Latin-script languages share an alphabet, so those are
 * decided on common words and only when the evidence is reasonably clear.
 *
 * A null result means "not confident", and the caller keeps whatever language
 * is already in use rather than guessing. Switching someone's language on a
 * weak signal is worse than leaving it alone.
 */

const SCRIPTS: Array<{ language: SupportedLanguage; re: RegExp }> = [
  { language: 'hi', re: /[ऀ-ॿ]/ },
  { language: 'ta', re: /[஀-௿]/ },
  { language: 'te', re: /[ఀ-౿]/ },
];

/** Words that are common in the language and rare in the others listed here. */
const LATIN_MARKERS: Array<{ language: SupportedLanguage; words: string[] }> = [
  {
    language: 'es',
    words: [
      'necesitamos', 'necesito', 'agua', 'comida', 'ayuda', 'personas', 'estamos',
      'por favor', 'refugio', 'familia', 'potable', 'somos', 'tenemos', 'niños',
      'escuela', 'puente', 'inundación', 'cuántos', 'dónde',
    ],
  },
  {
    language: 'en',
    words: [
      'we need', 'i need', 'water', 'food', 'people', 'help', 'shelter', 'please',
      'we are', 'there are', 'school', 'bridge', 'flood', 'drinking',
    ],
  },
];

export interface DetectionResult {
  language: SupportedLanguage | null;
  /** 'script' is certain; 'words' is a judgement; null means not confident. */
  basis: 'script' | 'words' | null;
  /** Set when the text is not in a script any catalogue covers. */
  unsupportedScript: boolean;
}

export function detectLanguage(text: string): DetectionResult {
  const trimmed = text.trim();
  if (trimmed.length < 2) return { language: null, basis: null, unsupportedScript: false };

  for (const { language, re } of SCRIPTS) {
    if (re.test(trimmed)) return { language, basis: 'script', unsupportedScript: false };
  }

  // A script we have no catalogue for at all — Arabic, Bengali, Han and so on.
  // Worth reporting, because the honest answer is "a model can handle this,
  // the built-in catalogues cannot".
  const unsupportedScript =
    /[؀-ۿঀ-৿฀-๿぀-ヿ一-鿿가-힯Ѐ-ӿ]/.test(
      trimmed,
    );
  if (unsupportedScript) return { language: null, basis: null, unsupportedScript: true };

  const lower = ` ${trimmed.toLowerCase()} `;
  const scores = LATIN_MARKERS.map(({ language, words }) => ({
    language,
    score: words.filter((word) => lower.includes(` ${word}`) || lower.includes(`${word} `)).length,
  })).sort((a, b) => b.score - a.score);

  const [best, next] = scores;
  // Two independent hits, and a clear lead over the runner-up.
  //
  // One hit is not evidence of a language: "Riverside Primary School" contains
  // an English marker but is a place name someone would say in any language,
  // and acting on it would switch a Hindi speaker to English mid-conversation
  // for answering a question correctly.
  if (best.score >= 2 && best.score > (next?.score ?? 0)) {
    return { language: best.language, basis: 'words', unsupportedScript: false };
  }
  return { language: null, basis: null, unsupportedScript: false };
}

/** Resolves what language to reply in, given what is known. */
export function replyLanguage(
  chosen: string,
  detected: DetectionResult,
): { language: string; switched: boolean } {
  // A certain script signal overrides a stale menu choice: someone who picked
  // English and then spoke Tamil should be answered in Tamil.
  if (detected.basis === 'script' && detected.language && detected.language !== chosen) {
    return { language: detected.language, switched: true };
  }
  if (isSupported(chosen)) return { language: chosen, switched: false };
  return { language: chosen, switched: false };
}
