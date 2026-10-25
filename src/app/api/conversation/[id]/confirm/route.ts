import { getDb } from '@/lib/db';
import { confirmAndSubmit } from '@/lib/conversation/engine';
import { currentUser, handleError, json, readBody } from '@/lib/api/http';
import { confirmSubmissionSchema } from '@/lib/validation/schemas';
import { refreshDuplicateCandidates } from '@/lib/domain/duplicates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Saves the request. The client must not show anything as submitted until this
 * has returned, which is why the response carries the server's own status and
 * reference code rather than anything the client guessed.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const body = await readBody(request, confirmSubmissionSchema);
  if (!body.ok) return body.response;
  try {
    const { id } = await context.params;
    const db = getDb();
    const user = await currentUser(db);
    const result = confirmAndSubmit(db, id, {
      idempotencyKey: body.data.idempotencyKey,
      confirmedSummary: body.data.confirmedSummary,
      acceptIncomplete: body.data.acceptIncomplete,
      userId: user?.id ?? null,
    });
    // Possible duplicates are suggested for human review, never acted on here.
    try {
      refreshDuplicateCandidates(db);
    } catch {
      // Duplicate suggestion is a convenience; it must never fail a submission.
    }
    return json({ result });
  } catch (error) {
    return handleError(error);
  }
}
