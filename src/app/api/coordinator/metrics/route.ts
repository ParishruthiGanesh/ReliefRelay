import { getDb } from '@/lib/db';
import { handleError, json, requireUser } from '@/lib/api/http';
import { metricsSnapshot, PRIORITY_FACTOR_LABELS } from '@/lib/domain/metrics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireUser('coordinator');
    return json({
      metrics: metricsSnapshot(getDb()),
      prioritisationFactors: PRIORITY_FACTOR_LABELS,
      disclosure:
        'Every figure here is computed from records in this database. There are no estimates of lives saved, emissions avoided or beneficiaries verified, because this prototype has no way to measure them. All data is fictional.',
    });
  } catch (error) {
    return handleError(error);
  }
}
