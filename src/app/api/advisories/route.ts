import { getDb } from '@/lib/db';
import { handleError, json } from '@/lib/api/http';
import { listAdvisories, refreshAdvisories } from '@/lib/domain/advisories';
import { envFeedStatus } from '@/lib/providers/envfeed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    const advisories = listAdvisories(db);
    return json({
      advisories,
      feed: envFeedStatus(),
      disclosure:
        'These are advisories published by a source, shown with their issuing body, publication time, coverage and expiry. ReliefRelay does not forecast flooding and does not attribute any individual flood to a cause.',
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function POST() {
  try {
    const db = getDb();
    const result = await refreshAdvisories(db);
    return json({ refresh: result, advisories: listAdvisories(db), feed: envFeedStatus() });
  } catch (error) {
    return handleError(error);
  }
}
