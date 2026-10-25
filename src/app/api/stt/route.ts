import { handleError, json, readBody } from '@/lib/api/http';
import { getSttProvider, sttUnavailable } from '@/lib/providers/stt';
import { sttRequestSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Transcribes a recording.
 *
 * Privacy and honesty, both enforced here:
 *   * If no provider is configured, this returns 503 and the audio is dropped.
 *     It never returns a transcript that no service produced.
 *   * The audio is held in memory only for the call, is never written to disk
 *     unless RETAIN_SERVER_AUDIO=true, and is never logged.
 */
export async function POST(request: Request) {
  const body = await readBody(request, sttRequestSchema);
  if (!body.ok) return body.response;

  const provider = getSttProvider();
  if (!provider) {
    const error = sttUnavailable(body.data.language);
    return handleError(error);
  }
  if (!provider.languages.includes(body.data.language)) {
    return json(
      {
        error: {
          code: 'language_unsupported',
          message: `${provider.info.label} does not document support for "${body.data.language}". Nothing was transcribed.`,
          guidance:
            'Choose a language this provider supports, type your request instead, or configure a provider that covers it.',
        },
      },
      422,
    );
  }

  // Scoped so the buffer goes out of scope as soon as the call returns.
  let audio: Buffer | null = Buffer.from(body.data.audioBase64, 'base64');
  try {
    const result = await provider.transcribe({
      audio,
      mimeType: body.data.mimeType,
      language: body.data.language,
    });
    return json({
      transcript: result.text,
      provider: result.provider,
      language: result.language,
      durationMs: result.durationMs ?? null,
      retention:
        process.env.RETAIN_SERVER_AUDIO === 'true'
          ? 'Audio retention is enabled on this server (RETAIN_SERVER_AUDIO=true).'
          : 'The recording was discarded as soon as it was transcribed and was not written to disk or to any log.',
    });
  } catch (error) {
    return handleError(error);
  } finally {
    audio = null;
  }
}
