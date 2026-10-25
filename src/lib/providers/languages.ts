import type { LanguageCode } from '@/lib/validation/schemas';
import { CATALOGUES, SUPPORTED_LANGUAGES } from '@/lib/i18n/messages';
import { RULE_EXTRACTION_LANGUAGES } from './extraction/keywords';

/**
 * Language support, reported honestly and in three separate parts.
 *
 * Each is a different question, and conflating them is how products end up
 * claiming coverage they do not have:
 *
 *   replies      — is there a message catalogue, and has a native speaker
 *                  checked its wording?
 *   understands  — can the configured extractor read this language?
 *   speech       — does the configured speech provider document it?
 *
 * A language can be strong in one and absent in another, and the interface
 * says which.
 */

export interface LanguageSupport {
  code: LanguageCode;
  label: string;
  englishName: string;
  /** A built-in catalogue exists, so replies are written in this language. */
  repliesReady: boolean;
  /** A native speaker has checked that catalogue's wording. */
  repliesReviewed: boolean;
  reviewNote?: string;
  /** The active extractor can read this language. */
  understandsReady: boolean;
  understandsVia: 'rules' | 'model' | 'none';
  sttReady: boolean;
  ttsReady: boolean;
  note: string;
}

/** Whisper documents all of these; Deepgram nova-2 documents fewer. */
const OPENAI_STT_LANGUAGES: LanguageCode[] = ['en', 'hi', 'ta', 'te', 'es'];
const DEEPGRAM_STT_LANGUAGES: LanguageCode[] = ['en', 'hi', 'es'];
const OPENAI_TTS_LANGUAGES: LanguageCode[] = ['en', 'hi', 'ta', 'te', 'es'];

/**
 * Languages the deterministic extractor has a vocabulary for.
 *
 * Derived from the vocabulary table rather than restated, so this cannot drift
 * from what the extractor can actually read.
 */
const RULES_LANGUAGES = RULE_EXTRACTION_LANGUAGES as LanguageCode[];

export function sttLanguagesFor(provider: string): LanguageCode[] {
  if (provider === 'openai') return OPENAI_STT_LANGUAGES;
  if (provider === 'deepgram') return DEEPGRAM_STT_LANGUAGES;
  return [];
}

export function modelExtractionEnabled(): boolean {
  return (
    (process.env.EXTRACTION_PROVIDER ?? 'rules').toLowerCase() === 'anthropic' &&
    !!process.env.ANTHROPIC_API_KEY
  );
}

export function languageSupport(): LanguageSupport[] {
  const sttProvider = (process.env.STT_PROVIDER ?? 'none').toLowerCase();
  const ttsProvider = (process.env.TTS_PROVIDER ?? 'none').toLowerCase();
  const sttKeyPresent =
    (sttProvider === 'openai' && !!process.env.OPENAI_API_KEY) ||
    (sttProvider === 'deepgram' && !!process.env.DEEPGRAM_API_KEY);
  const ttsKeyPresent = ttsProvider === 'openai' && !!process.env.OPENAI_API_KEY;

  const sttLanguages = sttKeyPresent ? sttLanguagesFor(sttProvider) : [];
  const ttsLanguages = ttsKeyPresent ? OPENAI_TTS_LANGUAGES : [];
  const modelReads = modelExtractionEnabled();

  return SUPPORTED_LANGUAGES.map((code) => {
    const catalogue = CATALOGUES[code];
    const understandsVia: LanguageSupport['understandsVia'] = RULES_LANGUAGES.includes(code)
      ? 'rules'
      : modelReads
        ? 'model'
        : 'none';

    const notes: string[] = [];
    if (!catalogue.reviewed) notes.push(catalogue.reviewNote ?? '');
    if (understandsVia === 'none') {
      notes.push(
        'The deterministic extractor only reads English, so a request written in this language will not be understood until EXTRACTION_PROVIDER=anthropic and ANTHROPIC_API_KEY are set. Replies would still be in this language.',
      );
    } else if (understandsVia === 'model') {
      notes.push('Understood by Claude, which reads any language.');
    } else {
      notes.push(
        'Read by the built-in extractor with no API key — keyword matching for resources, quantities and group size, not full comprehension.',
      );
    }
    if (!sttLanguages.includes(code)) {
      notes.push(
        sttKeyPresent
          ? `The configured speech provider (${sttProvider}) does not document this language.`
          : 'No speech-to-text provider is configured, so spoken input falls back to the browser, to typing, or to the labelled demonstration.',
      );
    }
    if (!ttsLanguages.includes(code)) {
      notes.push(
        'Spoken replies use your browser’s own voice if it has one for this language; everything is shown as text regardless.',
      );
    }

    return {
      code,
      label: catalogue.label,
      englishName: catalogue.englishName,
      repliesReady: true,
      repliesReviewed: catalogue.reviewed,
      reviewNote: catalogue.reviewNote,
      understandsReady: understandsVia !== 'none',
      understandsVia,
      sttReady: sttLanguages.includes(code),
      ttsReady: ttsLanguages.includes(code),
      note: notes.filter(Boolean).join(' ') || 'Replies, understanding, speech recognition and spoken replies are all configured and reviewed.',
    };
  });
}

/** What happens for a language with no catalogue at all. */
export function unlistedLanguagePolicy(): { supported: boolean; note: string } {
  if (modelExtractionEnabled()) {
    return {
      supported: true,
      note: 'Claude reads any language, so a request in a language not listed here is understood. Replies fall back to English, because writing them in a language with no checked catalogue would mean showing a person wording nobody has verified.',
    };
  }
  return {
    supported: false,
    note: 'Only the languages listed here are understood. Set EXTRACTION_PROVIDER=anthropic and ANTHROPIC_API_KEY to accept requests in any language; replies would still be in English for languages with no checked catalogue.',
  };
}

export function offeredLanguages(): LanguageSupport[] {
  return languageSupport();
}
