import { getDb } from '@/lib/db';
import { DISTRICT } from '@/lib/db/seed-data';
import { currentUser, handleError, json, readBody } from '@/lib/api/http';
import { matchLocation } from '@/lib/conversation/locations';
import { createRequest } from '@/lib/domain/requests';
import { refreshDuplicateCandidates } from '@/lib/domain/duplicates';
import { submissionConfirmation } from '@/lib/conversation/summary';
import { nowIso } from '@/lib/util/ids';
import { unitFor } from '@/lib/util/units';
import { directRequestSchema, requestDraftSchema } from '@/lib/validation/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The typed request form, and the endpoint an offline queue replays to.
 *
 * It takes the same path through `requestDraftSchema` and `createRequest` as
 * the voice flow, so a typed request is never a second-class record. The
 * idempotency key means a client that retries after a dropped connection gets
 * the same request back rather than creating another one.
 */
export async function POST(request: Request) {
  const body = await readBody(request, directRequestSchema);
  if (!body.ok) return body.response;
  const input = body.data;

  try {
    const db = getDb();
    const scope = 'direct_request';
    const existing = db
      .prepare('SELECT response_json FROM idempotency_keys WHERE key = ? AND scope = ?')
      .get(input.idempotencyKey, scope) as { response_json: string } | undefined;
    if (existing) {
      return json({ result: { ...JSON.parse(existing.response_json), deduplicated: true } });
    }

    const user = await currentUser(db);

    // Resolve the location the same way the voice flow does: an explicit
    // facility choice, or a single exact name match. Never a guess.
    let resolved: { facilityId: string | null; lat: number | null; lng: number | null; label: string; confirmed: boolean } = {
      facilityId: null,
      lat: null,
      lng: null,
      label: input.locationText,
      confirmed: false,
    };
    if (input.facilityId) {
      const facility = db
        .prepare('SELECT id, name, lat, lng FROM facilities WHERE id = ?')
        .get(input.facilityId) as { id: string; name: string; lat: number; lng: number } | undefined;
      if (facility) {
        resolved = {
          facilityId: facility.id,
          lat: facility.lat,
          lng: facility.lng,
          label: facility.name,
          confirmed: true,
        };
      }
    } else if (input.lat !== undefined && input.lng !== undefined) {
      // A point the person placed on the map or took from their own device.
      // That is a confirmation by someone who is there, which is the only kind
      // this app treats as confirmed.
      resolved = {
        facilityId: null,
        lat: input.lat,
        lng: input.lng,
        label: input.locationText,
        confirmed: true,
      };
    } else {
      const match = matchLocation(db, input.locationText);
      if (match.resolved) {
        resolved = {
          facilityId: match.resolved.facilityId ?? null,
          lat: match.resolved.lat,
          lng: match.resolved.lng,
          label: match.resolved.label,
          confirmed: true,
        };
      }
    }

    const draft = requestDraftSchema.parse({
      intent: 'need',
      items: input.items.map((item) => ({
        categoryId: item.categoryId,
        quantity: item.quantity,
        unit: unitFor(item.categoryId),
        quantityUncertain: item.quantityUncertain || item.quantity === null,
      })),
      groupSize: input.groupSize,
      locationText: resolved.label,
      resolvedFacilityId: resolved.facilityId,
      resolvedLat: resolved.lat,
      resolvedLng: resolved.lng,
      locationConfirmed: resolved.confirmed,
      urgency: input.urgency,
      contactMethod: input.contactMethod,
      contactValue: input.contactValue,
      language: input.language,
      behalfRole: input.behalfRole,
      dangerReported: input.dangerReported,
      originalText: input.note ?? '',
      notes: input.note ? [input.note] : [],
    });

    const created = createRequest(db, draft, {
      districtId: DISTRICT.id,
      inputMode: 'text',
      extractionProvider: null,
      createdBy: user?.id ?? null,
    });

    const result = {
      ...created,
      assistantText: submissionConfirmation(created.referenceCode),
      deduplicated: false,
    };
    db.prepare(
      'INSERT INTO idempotency_keys (key, scope, response_json, created_at) VALUES (?, ?, ?, ?)',
    ).run(input.idempotencyKey, scope, JSON.stringify(result), nowIso());

    try {
      refreshDuplicateCandidates(db);
    } catch {
      // Never fail a submission over duplicate suggestion.
    }

    return json({ result });
  } catch (error) {
    return handleError(error);
  }
}
