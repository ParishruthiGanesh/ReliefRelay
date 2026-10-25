import { getDb } from '@/lib/db';
import { handleError, json } from '@/lib/api/http';
import { publicNeedSummaries } from '@/lib/domain/dashboard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The public needs feed. Generalised points and resource categories only —
 * no exact locations, contact details, group sizes or quantities.
 */
export async function GET() {
  try {
    return json({
      needs: publicNeedSummaries(getDb()),
      disclosure:
        'Locations are generalised to roughly a one-kilometre grid and household details are withheld. Exact locations and contact details are visible only to authorised coordinators.',
    });
  } catch (error) {
    return handleError(error);
  }
}
