import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractionProviderStatus, getExtractionProvider } from '@/lib/providers/extraction';
import { RulesExtractionProvider } from '@/lib/providers/extraction/rules';
import { AnthropicExtractionProvider } from '@/lib/providers/extraction/anthropic';
import { getSttProvider, sttStatus, sttUnavailable } from '@/lib/providers/stt';
import { browserSynthesisResult, getTtsProvider, ttsStatus } from '@/lib/providers/tts';
import { envFeedStatus, getEnvFeedProvider } from '@/lib/providers/envfeed';
import { languageSupport, unlistedLanguagePolicy } from '@/lib/providers/languages';
import { DEMO_PROVIDER, demoScript } from '@/lib/providers/stt/demo';
import { emptyDraft } from '@/lib/validation/schemas';
import { digitize, firstNumber } from '@/lib/providers/extraction/numbers';

const ENV_KEYS = [
  'EXTRACTION_PROVIDER',
  'ANTHROPIC_API_KEY',
  'STT_PROVIDER',
  'OPENAI_API_KEY',
  'DEEPGRAM_API_KEY',
  'TTS_PROVIDER',
  'ENV_FEED_PROVIDER',
  'ENV_FEED_URL',
];

/**
 * Behaviour with no credentials configured.
 *
 * The rule being tested throughout: a missing credential produces an honest
 * fallback that names what actually ran. Nothing ever reports that a service
 * answered when it was not called.
 */
describe('missing credentials produce honest fallbacks', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('falls back to the deterministic extractor and says so', () => {
    expect(getExtractionProvider()).toBeInstanceOf(RulesExtractionProvider);
    const status = extractionProviderStatus();
    expect(status.active).toBe('rules');
    expect(status.live).toBe(false);
    expect(status.note).toMatch(/No AI service is called/i);
  });

  it('does not silently use the rule extractor while claiming Claude is configured', () => {
    process.env.EXTRACTION_PROVIDER = 'anthropic';
    // Key missing: the status must say the fallback is running, not pretend.
    const status = extractionProviderStatus();
    expect(status.configured).toBe('anthropic');
    expect(status.active).toBe('rules');
    expect(status.live).toBe(false);
    expect(status.note).toMatch(/ANTHROPIC_API_KEY is not set/);
    expect(getExtractionProvider()).toBeInstanceOf(RulesExtractionProvider);
  });

  it('returns no speech-to-text provider, and an error that offers alternatives', () => {
    expect(getSttProvider()).toBeNull();
    const status = sttStatus();
    expect(status.live).toBe(false);
    expect(status.active).toBeNull();
    expect(status.languages).toEqual([]);

    const error = sttUnavailable('en');
    expect(error.code).toBe('stt_unavailable');
    // It must state plainly that nothing was transcribed.
    expect(error.message).toMatch(/has not been transcribed/i);
    expect(error.guidance).toMatch(/type your request instead/i);
    expect(error.guidance).toMatch(/\.env/);
  });

  it('falls back to the browser voice for spoken replies, with the text always present', () => {
    expect(getTtsProvider()).toBeNull();
    const status = ttsStatus();
    expect(status.live).toBe(false);
    expect(status.note).toMatch(/browser/i);

    const result = browserSynthesisResult('Shall I submit it?');
    expect(result.useBrowserSynthesis).toBe(true);
    expect(result.audioBase64).toBeNull();
    expect(result.text).toBe('Shall I submit it?');
    expect(result.provider.label).toMatch(/no server service was called/i);
  });

  it('serves the scenario advisory feed, labelled as simulated', async () => {
    const provider = getEnvFeedProvider();
    expect(provider.recordKind).toBe('scenario');
    expect(provider.info.kind).toBe('fixture');

    const status = envFeedStatus();
    expect(status.live).toBe(false);
    expect(status.recordKind).toBe('scenario');
    expect(status.note).toMatch(/simulated/i);

    const result = await provider.fetchAdvisories();
    expect(result.recordKind).toBe('scenario');
    expect(result.records.length).toBeGreaterThan(0);
    // Every scenario record says so in its own text.
    for (const record of result.records) {
      expect(record.body).toMatch(/simulated/i);
      expect(record.sourceName).toMatch(/fictional/i);
    }
  });

  it('claims voice support for no language when nothing is configured', () => {
    for (const language of languageSupport()) {
      expect(language.sttReady).toBe(false);
      expect(language.ttsReady).toBe(false);
      expect(language.note.length).toBeGreaterThan(0);
    }
  });

  it('reports that Claude unlocks any language once configured', () => {
    process.env.EXTRACTION_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'test-key-not-used';
    const policy = unlistedLanguagePolicy();
    expect(policy.supported).toBe(true);
    // ...and is still honest that replies fall back to English for a
    // language whose wording nobody has checked.
    expect(policy.note).toMatch(/Replies fall back to English/i);
  });

  it('labels the demonstration as a script, not a recording', () => {
    expect(DEMO_PROVIDER.kind).toBe('fixture');
    expect(DEMO_PROVIDER.label).toMatch(/nothing was recorded/i);
    expect(DEMO_PROVIDER.label).toMatch(/no speech service was called/i);

    const lines = demoScript('en');
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0].text).toMatch(/twenty-five people/i);
    // A language with no script falls back to English rather than inventing one.
    expect(demoScript('ta')).toEqual(lines);
  });
});

describe('language claims match what is configured', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('reports only the languages the configured provider documents', () => {
    process.env.STT_PROVIDER = 'deepgram';
    process.env.DEEPGRAM_API_KEY = 'test-key-not-used';
    const languages = languageSupport();
    const byCode = Object.fromEntries(languages.map((l) => [l.code, l]));

    // Deepgram nova-2 is listed for English and Hindi in this adapter, so
    // Tamil and Telugu must not be advertised as voice-ready.
    expect(byCode.en.sttReady).toBe(true);
    expect(byCode.hi.sttReady).toBe(true);
    expect(byCode.ta.sttReady).toBe(false);
    expect(byCode.te.sttReady).toBe(false);
    expect(byCode.ta.note).toMatch(/does not document this language/i);
  });

  it('separates being able to reply from being able to understand', () => {
    const byCode = Object.fromEntries(languageSupport().map((l) => [l.code, l]));

    // Every listed language can be replied to, because a catalogue exists.
    for (const language of Object.values(byCode)) expect(language.repliesReady).toBe(true);

    // Only English is reviewed, and only English is understood without a key.
    expect(byCode.en.repliesReviewed).toBe(true);
    expect(byCode.ta.repliesReviewed).toBe(false);
    expect(byCode.ta.reviewNote).toMatch(/native speaker/i);

    // All five catalogue languages are read by the built-in extractor, with
    // no API key — by keyword matching, which the note says plainly.
    for (const language of Object.values(byCode)) {
      expect(language.understandsVia).toBe('rules');
      expect(language.understandsReady).toBe(true);
    }
    expect(byCode.ta.note).toMatch(/keyword matching/i);
    expect(byCode.ta.note).toMatch(/not full comprehension/i);
  });

  it('says plainly what happens for a language with no catalogue', () => {
    const policy = unlistedLanguagePolicy();
    expect(policy.supported).toBe(false);
    expect(policy.note).toMatch(/Only the languages listed here are understood/i);
  });
});

describe('a model proposal outside the schema changes nothing', () => {
  it('discards an out-of-schema reply and reports which extractor actually ran', async () => {
    const originalFetch = globalThis.fetch;
    // A model that tries to write fields it was never allowed to touch.
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                groupSize: 25,
                requestStatus: 'fulfilled',
                markDelivered: true,
                inventoryQty: 999,
              }),
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )) as typeof fetch;

    try {
      const provider = new AnthropicExtractionProvider('test-key');
      const result = await provider.extract({
        draft: emptyDraft(),
        pendingQuestion: null,
        userText: 'We need water for 25 people at Riverside Primary School.',
        language: 'en',
        history: [],
      });

      // The boundary held: no status, no inventory, no delivery flag.
      expect(result.update).not.toHaveProperty('requestStatus');
      expect(result.update).not.toHaveProperty('markDelivered');
      expect(result.update).not.toHaveProperty('inventoryQty');
      expect(result.validationError).toBeTruthy();
      // And the UI is told the deterministic extractor produced the draft.
      expect(result.provider.id).toBe('rules-after-anthropic-schema-error');
      expect(result.provider.label).toMatch(/outside the allowed schema/i);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('falls back and names the failure when the service is unreachable', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('getaddrinfo ENOTFOUND api.anthropic.com');
    }) as typeof fetch;

    try {
      const provider = new AnthropicExtractionProvider('test-key');
      const result = await provider.extract({
        draft: emptyDraft(),
        pendingQuestion: null,
        userText: 'We need 40 meal packs at Old Bridge Community Hall.',
        language: 'en',
        history: [],
      });
      expect(result.provider.id).toBe('rules-after-anthropic-error');
      expect(result.provider.label).toMatch(/could not be reached/i);
      // The fallback still did real work.
      expect(result.update.items?.[0]).toMatchObject({ categoryId: 'meal_packs', quantity: 40 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('spoken-number handling', () => {
  it('reads number words as well as digits', () => {
    expect(digitize('twenty-five people')).toContain('25');
    expect(digitize('twenty five people')).toContain('25');
    expect(digitize('two hundred litres')).toContain('200');
    expect(firstNumber('about thirty five of us')).toBe(35);
    expect(firstNumber('no numbers here')).toBeNull();
  });

  it('extracts a group size from several phrasings without touching quantities', async () => {
    const provider = new RulesExtractionProvider();
    for (const phrase of [
      'there are 18 people here',
      'we are eighteen',
      'a family of 18',
      'group of 18',
      '18 of us',
    ]) {
      const result = await provider.extract({
        draft: emptyDraft(),
        pendingQuestion: null,
        userText: `${phrase} and we need food`,
        language: 'en',
        history: [],
      });
      expect(result.update.groupSize).toBe(18);
      // The food item exists but has no quantity derived from 18.
      const food = result.update.items?.find((i) => i.categoryId === 'meal_packs');
      expect(food).toBeDefined();
      expect(food?.quantity ?? null).toBeNull();
    }
  });
});

describe('the deterministic extractor reads more than English', () => {
  const cases: Array<{
    language: string;
    text: string;
    expectCategories: string[];
    expectGroupSize: number | null;
  }> = [
    {
      language: 'hi',
      text: 'हमें पीने का पानी और खाना चाहिए। यहाँ बीस लोग हैं।',
      expectCategories: ['drinking_water', 'meal_packs'],
      expectGroupSize: 20,
    },
    {
      language: 'es',
      text: 'Necesitamos agua potable y comida para veinticinco personas.',
      expectCategories: ['drinking_water', 'meal_packs'],
      expectGroupSize: 25,
    },
    {
      language: 'ta',
      text: 'எங்களுக்கு குடிநீர் தேவை. இங்கே 15 பேர் இருக்கிறார்கள்.',
      expectCategories: ['drinking_water'],
      expectGroupSize: 15,
    },
    {
      language: 'te',
      text: 'మాకు తాగునీరు కావాలి. ఇక్కడ 30 మంది ఉన్నారు.',
      expectCategories: ['drinking_water'],
      expectGroupSize: 30,
    },
  ];

  it.each(cases)('reads a $language request with no API key', async (testCase) => {
    const provider = new RulesExtractionProvider();
    const result = await provider.extract({
      draft: emptyDraft(),
      pendingQuestion: null,
      userText: testCase.text,
      language: 'en',
      history: [],
    });

    const found = (result.update.items ?? []).map((i) => i.categoryId).sort();
    for (const category of testCase.expectCategories) {
      expect(found, `${testCase.language} should find ${category}`).toContain(category);
    }
    expect(result.update.groupSize).toBe(testCase.expectGroupSize);
    expect(result.update.intent).toBe('need');

    // The rule that holds in every language: people are not supplies.
    for (const item of result.update.items ?? []) {
      expect(item.quantity ?? null).toBeNull();
    }
  });

  it('reads an explicit quantity in Spanish and Hindi', async () => {
    const provider = new RulesExtractionProvider();
    const spanish = await provider.extract({
      draft: emptyDraft(),
      pendingQuestion: null,
      userText: 'Necesitamos 300 litros de agua potable.',
      language: 'es',
      history: [],
    });
    expect(spanish.update.items?.[0]).toMatchObject({
      categoryId: 'drinking_water',
      quantity: 300,
    });

    const hindi = await provider.extract({
      draft: emptyDraft(),
      pendingQuestion: null,
      userText: 'हमें 50 लीटर पानी चाहिए।',
      language: 'hi',
      history: [],
    });
    expect(hindi.update.items?.[0]).toMatchObject({
      categoryId: 'drinking_water',
      quantity: 50,
    });
  });

  it('refuses to convert an unrecognised unit in Spanish too', async () => {
    const provider = new RulesExtractionProvider();
    const result = await provider.extract({
      draft: emptyDraft(),
      pendingQuestion: null,
      userText: 'Necesitamos 50 botellas de agua.',
      language: 'es',
      history: [],
    });
    const water = result.update.items?.find((i) => i.categoryId === 'drinking_water');
    expect(water?.quantity ?? null).toBeNull();
    expect(water?.quantityUncertain).toBe(true);
    expect(water?.note).toMatch(/50 botellas/);
  });

  it('distinguishes an offer from a need in Spanish', async () => {
    const provider = new RulesExtractionProvider();
    const offer = await provider.extract({
      draft: emptyDraft(),
      pendingQuestion: null,
      userText: 'Podemos donar 200 paquetes de comida.',
      language: 'es',
      history: [],
    });
    expect(offer.update.intent).toBe('offer');
  });

  it('says so when a script has no built-in vocabulary', async () => {
    const provider = new RulesExtractionProvider();
    const result = await provider.extract({
      draft: emptyDraft(),
      pendingQuestion: null,
      userText: 'نحتاج إلى مياه الشرب لعشرين شخصا',
      language: 'en',
      history: [],
    });
    // It does not pretend to have understood Arabic.
    expect(result.update.notes?.join(' ')).toMatch(/no vocabulary for/i);
    expect(result.update.notes?.join(' ')).toMatch(/anthropic/i);
  });
});
