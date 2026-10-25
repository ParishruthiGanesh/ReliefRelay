import type { LanguageCode } from '@/lib/validation/schemas';
import { LANGUAGE_LABELS } from '@/lib/db/seed-data';

/**
 * Language support, reported honestly.
 *
 * `uiReady` means the app's own interface strings and the deterministic
 * extractor handle the language. `voiceReady` means the *configured* speech
 * provider documents support for it. We do not advertise voice coverage for a
 * language whose provider is not configured, and we do not claim the
 * rule-based extractor understands a language it has no patterns for.
 */

export interface LanguageSupport {
  code: LanguageCode;
  label: string;
  /** Interface and extraction. */
  uiReady: boolean;
  /** Speech recognition through the configured provider. */
  sttReady: boolean;
  /** Speech synthesis through the configured provider or the browser. */
  ttsReady: boolean;
  note: string;
}

/** Whisper's documented language list includes all four; Deepgram nova-2 does not. */
const OPENAI_STT_LANGUAGES: LanguageCode[] = ['en', 'hi', 'ta', 'te'];
const DEEPGRAM_STT_LANGUAGES: LanguageCode[] = ['en', 'hi'];
const OPENAI_TTS_LANGUAGES: LanguageCode[] = ['en', 'hi', 'ta', 'te'];

export function sttLanguagesFor(provider: string): LanguageCode[] {
  if (provider === 'openai') return OPENAI_STT_LANGUAGES;
  if (provider === 'deepgram') return DEEPGRAM_STT_LANGUAGES;
  return [];
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

  // English and Hindi have interface strings and extraction patterns in this
  // prototype. Tamil and Telugu are wired through the same adapters but their
  // extraction patterns are not written yet, so they are not claimed as ready.
  const extractionReady: LanguageCode[] = ['en', 'hi'];

  return (['en', 'hi', 'ta', 'te'] as LanguageCode[]).map((code) => {
    const uiReady = extractionReady.includes(code);
    const sttReady = sttLanguages.includes(code);
    const ttsReady = ttsLanguages.includes(code);
    const notes: string[] = [];
    if (!uiReady) {
      notes.push(
        'Interface strings and extraction patterns for this language are not written yet; it is listed to show the architecture is extensible, not as verified coverage.',
      );
    }
    if (!sttReady) {
      notes.push(
        sttKeyPresent
          ? `The configured speech provider (${sttProvider}) does not document support for this language.`
          : 'No speech-to-text provider is configured, so spoken input falls back to the browser, to typing, or to the labelled demonstration.',
      );
    }
    if (!ttsReady) {
      notes.push(
        'Spoken replies will use your browser’s own speech synthesis if it has a voice for this language; everything is shown as text regardless.',
      );
    }
    return {
      code,
      label: LANGUAGE_LABELS[code] ?? code,
      uiReady,
      sttReady,
      ttsReady,
      note: notes.join(' ') || 'Interface, extraction, speech recognition and spoken replies are all configured.',
    };
  });
}

/** Languages offered in the picker: everything, with each one's state shown. */
export function offeredLanguages(): LanguageSupport[] {
  return languageSupport();
}
