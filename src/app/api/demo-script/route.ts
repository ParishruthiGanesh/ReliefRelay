import { json } from '@/lib/api/http';
import { DEMO_PROVIDER, demoScript } from '@/lib/providers/stt/demo';
import { languageSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';

/**
 * The labelled demonstration script.
 *
 * This replays known lines through the real conversation engine. It records
 * nothing, calls no speech service, and is labelled as a script everywhere it
 * is shown so it can never be mistaken for a transcription.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const parsed = languageSchema.safeParse(url.searchParams.get('language') ?? 'en');
  const language = parsed.success ? parsed.data : 'en';
  return json({
    provider: DEMO_PROVIDER,
    language,
    lines: demoScript(language),
    disclosure:
      'These are scripted lines, not a recording of a person, and no speech-to-text service is called when you play them. They are provided so the full conversation workflow can be demonstrated without speech credentials.',
  });
}
