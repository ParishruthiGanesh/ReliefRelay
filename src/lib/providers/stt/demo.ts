import type { LanguageCode } from '@/lib/validation/schemas';
import type { ProviderInfo } from '../types';

/**
 * The labelled demonstration.
 *
 * This is a *script*, not a recording, and it is labelled as such everywhere it
 * appears. Playing it does not record the microphone and does not call any
 * speech service — it replays known lines through the real conversation engine
 * so the workflow can be shown without credentials. If spoken aloud, it is the
 * browser's own speech synthesis reading the text, not a human voice.
 */

export const DEMO_PROVIDER: ProviderInfo = {
  id: 'scripted-demo',
  label: 'Scripted demonstration (nothing was recorded; no speech service was called)',
  kind: 'fixture',
};

export interface DemoLine {
  /** What the script says the person said. */
  text: string;
  /** Which step of the demonstration this is. */
  step: number;
  hint: string;
}

export const DEMO_SCRIPT: Record<LanguageCode, DemoLine[]> = {
  en: [
    {
      step: 1,
      text: 'We are at the school near the old bridge. There are twenty-five people here. We need food and drinking water.',
      hint: 'The opening report: two resources, a group size, and a vague landmark.',
    },
    {
      step: 2,
      text: 'Riverside Primary School',
      hint: 'Answering the location question by naming the school.',
    },
    {
      step: 3,
      text: 'Yes',
      hint: 'Confirming the request covers the whole group of 25.',
    },
  ],
  hi: [
    {
      step: 1,
      text: 'हम पुराने पुल के पास स्कूल में हैं। यहाँ पच्चीस लोग हैं। हमें खाना और पीने का पानी चाहिए।',
      hint: 'The same opening report in Hindi. Extraction patterns for Hindi are not written yet, so this line is for showing the speech path only.',
    },
  ],
  ta: [],
  te: [],
};

export function demoScript(language: LanguageCode): DemoLine[] {
  const lines = DEMO_SCRIPT[language];
  return lines.length > 0 ? lines : DEMO_SCRIPT.en;
}
