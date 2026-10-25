import { describe, expect, it } from 'vitest';
import {
  ALL_KEYS,
  CATALOGUES,
  SUPPORTED_LANGUAGES,
  catalogueFor,
  t,
} from '@/lib/i18n/messages';
import { detectLanguage, replyLanguage } from '@/lib/i18n/detect';

describe('the message catalogues', () => {
  it('every language defines every string English defines', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const missing = ALL_KEYS.filter((key) => !(key in CATALOGUES[language].strings));
      expect(missing, `${language} is missing: ${missing.join(', ')}`).toEqual([]);
    }
  });

  it('keeps every placeholder a string needs', () => {
    const placeholders = (s: string) => (s.match(/\{(\w+)\}/g) ?? []).sort();
    for (const language of SUPPORTED_LANGUAGES) {
      for (const key of ALL_KEYS) {
        const english = CATALOGUES.en.strings[key];
        const translated = CATALOGUES[language].strings[key];
        expect(placeholders(translated), `${language}/${key}`).toEqual(placeholders(english));
      }
    }
  });

  it('is honest about which wordings have been reviewed', () => {
    expect(CATALOGUES.en.reviewed).toBe(true);
    for (const language of SUPPORTED_LANGUAGES.filter((l) => l !== 'en')) {
      // Anything not checked by a native speaker says so, and says why it
      // still matters that the data underneath is unaffected.
      expect(CATALOGUES[language].reviewed).toBe(false);
      expect(CATALOGUES[language].reviewNote).toMatch(/native speaker/i);
    }
  });

  it('never leaks a key name to a person, even for an unknown language', () => {
    expect(t('en', 'q.location')).toMatch(/Where are you/);
    expect(t('hi', 'q.location')).not.toBe('q.location');
    // An unlisted language falls back to English rather than showing the key.
    expect(t('sw', 'q.location')).toMatch(/Where are you/);
    expect(catalogueFor('sw').englishName).toBe('English');
  });

  it('interpolates values into every language', () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const message = t(language, 'submitted.confirmation', { reference: 'RR-1042' });
      expect(message).toContain('RR-1042');
      expect(message).not.toContain('{reference}');
    }
  });

  it('keeps the promise that nobody has been notified, in every language', () => {
    // The danger wording is the one place a translation could do real harm by
    // implying rescue is coming. Each catalogue must still carry the denial.
    const denials: Record<string, RegExp> = {
      en: /has not contacted anyone/i,
      hi: /संपर्क नहीं किया/,
      ta: /தொடர்பு கொள்ளவில்லை/,
      te: /సంప్రదించలేదు/,
      es: /no ha avisado a nadie/i,
    };
    for (const [language, pattern] of Object.entries(denials)) {
      expect(t(language, 'danger.body', { what: 'x' }), language).toMatch(pattern);
      expect(t(language, 'caveat.danger'), language).toMatch(pattern);
    }
  });
});

describe('language detection', () => {
  it('is certain about a distinct script', () => {
    expect(detectLanguage('हमें पीने का पानी चाहिए')).toMatchObject({ language: 'hi', basis: 'script' });
    expect(detectLanguage('எங்களுக்கு குடிநீர் தேவை')).toMatchObject({ language: 'ta', basis: 'script' });
    expect(detectLanguage('మాకు తాగునీరు కావాలి')).toMatchObject({ language: 'te', basis: 'script' });
  });

  it('reads common words for Latin-script languages', () => {
    expect(detectLanguage('necesitamos agua potable para 20 personas')).toMatchObject({
      language: 'es',
      basis: 'words',
    });
    expect(detectLanguage('we need drinking water for 20 people')).toMatchObject({
      language: 'en',
      basis: 'words',
    });
  });

  it('declines to guess when the evidence is thin', () => {
    expect(detectLanguage('ok').language).toBeNull();
    expect(detectLanguage('42').language).toBeNull();
    expect(detectLanguage('Riverside Primary School').language).toBeNull();
  });

  it('keeps the speaker language when they answer with an English place name', () => {
    // A Hindi speaker answering "which school?" with the school's actual
    // English name must stay in Hindi rather than being switched to English
    // for answering the question correctly.
    const answer = detectLanguage('Riverside Primary School');
    expect(replyLanguage('hi', answer)).toEqual({ language: 'hi', switched: false });
    expect(replyLanguage('ta', answer)).toEqual({ language: 'ta', switched: false });
  });

  it('flags a script no catalogue covers, rather than guessing English', () => {
    const arabic = detectLanguage('نحتاج إلى مياه الشرب');
    expect(arabic.language).toBeNull();
    expect(arabic.unsupportedScript).toBe(true);
  });

  it('switches language on a certain script signal, not on a weak one', () => {
    // Picked English, then spoke Tamil: answer in Tamil.
    expect(replyLanguage('en', detectLanguage('எங்களுக்கு உணவு தேவை'))).toEqual({
      language: 'ta',
      switched: true,
    });
    // Picked Hindi, then answered "Yes": stay in Hindi.
    expect(replyLanguage('hi', detectLanguage('Yes'))).toEqual({ language: 'hi', switched: false });
  });
});
