import { getDb } from '@/lib/db';
import { handleError, json, readBody, requireUser } from '@/lib/api/http';
import {
  decideDuplicate,
  listDuplicateSuggestions,
  refreshDuplicateCandidates,
} from '@/lib/domain/duplicates';
import { duplicateDecisionSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser('coordinator');
    const db = getDb();
    refreshDuplicateCandidates(db);
    return json({
      suggestions: listDuplicateSuggestions(db),
      disclosure:
        'These are suggestions for human review only. Nothing is merged, hidden, deleted or deprioritised automatically, and confirming a duplicate does not close either request.',
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST(request: Request) {
  const body = await readBody(request, duplicateDecisionSchema);
  if (!body.ok) return body.response;
  try {
    const user = await requireUser('coordinator');
    const db = getDb();
    decideDuplicate(db, {
      candidateId: body.data.candidateId,
      decision: body.data.decision,
      userId: user.id,
    });
    return json({ suggestions: listDuplicateSuggestions(db) });
  } catch (error) {
    return handleError(error);
  }
}
