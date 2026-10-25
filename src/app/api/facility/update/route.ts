import { getDb } from '@/lib/db';
import { fail, handleError, json, readBody, requireUser } from '@/lib/api/http';
import { canUpdateFacility } from '@/lib/auth/session';
import { getFacility, recordFacilityUpdate } from '@/lib/domain/facilities';
import { facilityUpdateSubmitSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * A facility representative updates their own facility.
 *
 * Authorisation is checked against the facility on the account, so a
 * representative of one shelter cannot change another shelter's capacity.
 */
export async function POST(request: Request) {
  const body = await readBody(request, facilityUpdateSubmitSchema);
  if (!body.ok) return body.response;
  try {
    const user = await requireUser('facility_rep', 'coordinator');
    if (!canUpdateFacility(user, body.data.facilityId)) {
      return fail('forbidden', 'Your account is not registered for that facility.', 403);
    }
    const db = getDb();
    recordFacilityUpdate(db, {
      facilityId: body.data.facilityId,
      capacityAvailable: body.data.capacityAvailable,
      openingStatus: body.data.openingStatus,
      resourcesNote: body.data.resourcesNote,
      note: body.data.note,
      sourceKind: user.role === 'facility_rep' ? 'facility_confirmed' : 'coordinator_reviewed',
      reportedBy: user.id,
    });
    return json({ facility: getFacility(db, body.data.facilityId) });
  } catch (error) {
    return handleError(error);
  }
}
