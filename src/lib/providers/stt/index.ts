import type { LanguageCode } from '@/lib/validation/schemas';
import {
  SttUnavailableError,
  type ProviderInfo,
  type SttInput,
  type SttProvider,
  type SttResult,
} from '../types';
import { sttLanguagesFor } from '../languages';

/**
 * Speech to text.
 *
 * The honesty rule for this file: if no provider is configured, nothing is
 * transcribed and nothing pretends to have been. `getSttProvider` returns null
 * and the API answers with a 503 plus guidance, so the user is offered typing,
 * their browser's own recogniser, or the clearly-labelled scripted
 * demonstration instead.
 */

export class OpenAiWhisperProvider implements SttProvider {
  readonly info: ProviderInfo = {
    id: 'openai-whisper',
    label: `OpenAI speech-to-text (${process.env.OPENAI_STT_MODEL ?? 'whisper-1'})`,
    kind: 'live_service',
  };
  readonly languages = sttLanguagesFor('openai');

  constructor(
    private apiKey: string,
    private model = process.env.OPENAI_STT_MODEL ?? 'whisper-1',
    private baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  ) {}

  async transcribe(input: SttInput): Promise<SttResult> {
    const started = Date.now();
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(input.audio)], { type: input.mimeType }), 'speech.webm');
    form.append('model', this.model);
    form.append('language', input.language);
    form.append('response_format', 'json');

    const response = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI transcription failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const body = (await response.json()) as { text?: string };
    if (!body.text) throw new Error('OpenAI transcription returned no text.');
    return {
      text: body.text.trim(),
      provider: this.info,
      language: input.language,
      durationMs: Date.now() - started,
    };
  }
}

export class DeepgramProvider implements SttProvider {
  readonly info: ProviderInfo = {
    id: 'deepgram',
    label: `Deepgram speech-to-text (${process.env.DEEPGRAM_STT_MODEL ?? 'nova-2'})`,
    kind: 'live_service',
  };
  readonly languages = sttLanguagesFor('deepgram');

  constructor(
    private apiKey: string,
    private model = process.env.DEEPGRAM_STT_MODEL ?? 'nova-2',
  ) {}

  async transcribe(input: SttInput): Promise<SttResult> {
    const started = Date.now();
    const url = new URL('https://api.deepgram.com/v1/listen');
    url.searchParams.set('model', this.model);
    url.searchParams.set('language', input.language);
    url.searchParams.set('smart_format', 'true');
    url.searchParams.set('punctuate', 'true');

    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Token ${this.apiKey}`, 'content-type': input.mimeType },
      body: new Uint8Array(input.audio),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Deepgram transcription failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      results?: { channels?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
    };
    const text = body.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (!text) throw new Error('Deepgram returned no transcript.');
    return {
      text: text.trim(),
      provider: this.info,
      language: input.language,
      durationMs: Date.now() - started,
    };
  }
}

export function getSttProvider(): SttProvider | null {
  const configured = (process.env.STT_PROVIDER ?? 'none').toLowerCase();
  if (configured === 'openai' && process.env.OPENAI_API_KEY) {
    return new OpenAiWhisperProvider(process.env.OPENAI_API_KEY);
  }
  if (configured === 'deepgram' && process.env.DEEPGRAM_API_KEY) {
    return new DeepgramProvider(process.env.DEEPGRAM_API_KEY);
  }
  return null;
}

export function sttUnavailable(language: LanguageCode): SttUnavailableError {
  const configured = (process.env.STT_PROVIDER ?? 'none').toLowerCase();
  const reason =
    configured === 'none'
      ? 'No speech-to-text provider is configured on this server (STT_PROVIDER=none).'
      : `STT_PROVIDER=${configured} is set but its API key is missing.`;
  return new SttUnavailableError(
    `${reason} Your recording was not sent anywhere and has not been transcribed.`,
    'You can type your request instead, use your browser’s own speech recognition if it offers it, or play the labelled scripted demonstration. To enable live transcription, set STT_PROVIDER and the matching API key in .env.local — see .env.example.',
  );
}

export function sttStatus(): {
  configured: string;
  active: string | null;
  live: boolean;
  languages: LanguageCode[];
  note: string;
} {
  const configured = (process.env.STT_PROVIDER ?? 'none').toLowerCase();
  const provider = getSttProvider();
  if (provider) {
    return {
      configured,
      active: provider.info.id,
      live: true,
      languages: provider.languages,
      note: `${provider.info.label} transcribes recordings server-side. Audio is ${
        process.env.RETAIN_SERVER_AUDIO === 'true' ? 'retained (RETAIN_SERVER_AUDIO=true)' : 'discarded immediately after transcription'
      }.`,
    };
  }
  return {
    configured,
    active: null,
    live: false,
    languages: [],
    note: sttUnavailable('en').message,
  };
}
