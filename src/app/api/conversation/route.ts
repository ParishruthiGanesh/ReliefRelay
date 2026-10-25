import { getDb } from '@/lib/db';
import { startConversation } from '@/lib/conversation/engine';
import { currentUser, handleError, json, readBody } from '@/lib/api/http';
import { startConversationSchema } from '@/lib/validation/schemas';
import { extractionProviderStatus } from '@/lib/providers/extraction';
import { sttStatus } from '@/lib/providers/stt';
import { ttsStatus } from '@/lib/providers/tts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const body = await readBody(request, startConversationSchema);
  if (!body.ok) return body.response;
  try {
    const db = getDb();
    const user = await currentUser(db);
    const view = startConversation(db, {
      language: body.data.language,
      mode: body.data.mode,
      behalfRole: body.data.behalfRole,
      userId: user?.id ?? null,
      facilityId: body.data.facilityId ?? null,
    });
    return json({
      conversation: view,
      providers: {
        extraction: extractionProviderStatus(),
        stt: sttStatus(),
        tts: ttsStatus(),
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
