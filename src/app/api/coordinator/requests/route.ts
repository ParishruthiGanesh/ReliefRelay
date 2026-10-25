import { getDb } from '@/lib/db';
import { handleError, json, requireUser } from '@/lib/api/http';
import { listCoordinatorRequests } from '@/lib/domain/dashboard';
import { listInventory } from '@/lib/domain/inventory';
import { listFacilities } from '@/lib/domain/facilities';
import { listAdvisories } from '@/lib/domain/advisories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    await requireUser('coordinator');
    const params = new URL(request.url).searchParams;
    const db = getDb();
    const requests = listCoordinatorRequests(db, {
      categoryId: params.get('category') ?? undefined,
      status: params.get('status') ?? undefined,
      facilityId: params.get('facility') ?? undefined,
      maxAgeMinutes: params.get('maxAge') ? Number(params.get('maxAge')) : undefined,
      missingInfoOnly: params.get('missing') === '1',
      discrepanciesOnly: params.get('discrepancies') === '1',
      search: params.get('q') ?? undefined,
    });
    return json({
      requests,
      inventory: listInventory(db),
      facilities: listFacilities(db),
      advisories: listAdvisories(db),
    });
  } catch (error) {
    return handleError(error);
  }
}
