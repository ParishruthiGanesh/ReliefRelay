import { getDb } from '@/lib/db';
import { fail, handleError, json, requireUser } from '@/lib/api/http';
import { getRequestById } from '@/lib/domain/requests';
import { situationSummary, suggestMatches } from '@/lib/domain/matching';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUser('coordinator');
    const db = getDb();
    const requestId = new URL(request.url).searchParams.get('requestId');
    if (!requestId) return json({ situation: situationSummary(db) });

    const row = getRequestById(db, requestId);
    if (!row) return fail('not_found', 'No such request.', 404);
    return json({
      suggestions: suggestMatches(db, row),
      situation: situationSummary(db),
      disclosure:
        'These are proposals ranked by explainable rules, not decisions. A coordinator approves every allocation, and the reasons shown are the actual ranking criteria.',
    });
  } catch (error) {
    return handleError(error);
  }
}
