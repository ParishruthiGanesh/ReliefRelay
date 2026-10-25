import type { LanguageCode } from '@/lib/validation/schemas';
import type { ProviderInfo, TtsProvider, TtsResult } from '../types';

/**
 * Text to speech.
 *
 * Every spoken reply is also returned as text, always. When no server provider
 * is configured the result carries `useBrowserSynthesis: true` and the client
 * may read the text with the browser's own voice — which the UI says plainly,
 * so nobody thinks a service generated it. Nothing is auto-played: the user
 * presses play, and can stop or mute at any time.
 */

const BROWSER_PROVIDER: ProviderInfo = {
  id: 'browser-speech-synthesis',
  label: 'Your browser’s own speech synthesis (no server service was called)',
  kind: 'local',
};

export class OpenAiTtsProvider implements TtsProvider {
  readonly info: ProviderInfo = {
    id: 'openai-tts',
    label: `OpenAI text-to-speech (${process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts'})`,
    kind: 'live_service',
  };
  readonly languages: LanguageCode[] = ['en', 'hi', 'ta', 'te'];

  constructor(
    private apiKey: string,
    private model = process.env.OPENAI_TTS_MODEL ?? 'gpt-4o-mini-tts',
    private voice = process.env.OPENAI_TTS_VOICE ?? 'alloy',
    private baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1',
  ) {}

  async speak(input: { text: string; language: LanguageCode }): Promise<TtsResult> {
    const response = await fetch(`${this.baseUrl}/audio/speech`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        voice: this.voice,
        input: input.text,
        response_format: 'mp3',
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI speech failed (${response.status}): ${detail.slice(0, 200)}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      audioBase64: buffer.toString('base64'),
      mimeType: 'audio/mpeg',
      text: input.text,
      provider: this.info,
      useBrowserSynthesis: false,
    };
  }
}

export function getTtsProvider(): TtsProvider | null {
  const configured = (process.env.TTS_PROVIDER ?? 'none').toLowerCase();
  if (configured === 'openai' && process.env.OPENAI_API_KEY) {
    return new OpenAiTtsProvider(process.env.OPENAI_API_KEY);
  }
  return null;
}

export function browserSynthesisResult(text: string): TtsResult {
  return {
    audioBase64: null,
    mimeType: null,
    text,
    provider: BROWSER_PROVIDER,
    useBrowserSynthesis: true,
  };
}

export function ttsStatus(): { configured: string; active: string; live: boolean; note: string } {
  const configured = (process.env.TTS_PROVIDER ?? 'none').toLowerCase();
  const provider = getTtsProvider();
  if (provider) {
    return {
      configured,
      active: provider.info.id,
      live: true,
      note: `${provider.info.label} generates spoken replies. Text is always shown as well.`,
    };
  }
  return {
    configured,
    active: BROWSER_PROVIDER.id,
    live: false,
    note: 'No server text-to-speech provider is configured. Spoken replies use your browser’s own speech synthesis where available; every reply is shown as text regardless. Set TTS_PROVIDER=openai and OPENAI_API_KEY to generate audio server-side.',
  };
}
