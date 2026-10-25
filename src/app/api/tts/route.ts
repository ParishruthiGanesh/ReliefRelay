import { handleError, json, readBody } from '@/lib/api/http';
import { browserSynthesisResult, getTtsProvider } from '@/lib/providers/tts';
import { ttsRequestSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Returns spoken audio when a provider is configured, and otherwise tells the
 * client to use the browser's own voice. Either way the text comes back, since
 * everything spoken must also be readable. Nothing auto-plays: the client only
 * calls this when the user presses play.
 */
export async function POST(request: Request) {
  const body = await readBody(request, ttsRequestSchema);
  if (!body.ok) return body.response;

  const provider = getTtsProvider();
  if (!provider) return json({ speech: browserSynthesisResult(body.data.text) });

  try {
    const result = await provider.speak({ text: body.data.text, language: body.data.language });
    return json({ speech: result });
  } catch (error) {
    // A speech failure must not break the conversation: fall back to the
    // browser voice and say which one is being used.
    if (error instanceof Error) {
      return json({
        speech: browserSynthesisResult(body.data.text),
        note: `Server speech generation failed (${error.message}); your browser’s own voice will be used instead.`,
      });
    }
    return handleError(error);
  }
}
