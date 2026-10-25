import type { DB } from '@/lib/db';
import { transact } from '@/lib/db';
import { id, nowIso, referenceCode, trackingToken } from '@/lib/util/ids';
import { sha256Hex } from '@/lib/util/tokens';
import { coarsen, unitFor } from '@/lib/util/units';
import type { RequestDraft } from '@/lib/validation/schemas';
import {
  computeItemAllocation,
  deriveRequestStatus,
  type CommitmentStatus,
  type ItemAllocation,
  type RequestStatus,
} from './allocation';

export interface RequestRow {
  id: string;
  reference_code: string;
  district_id: string;
  intent: string;
  status: RequestStatus;
  group_size: number | null;
  group_size_uncertain: number;
  location_text: string;
  resolved_facility_id: string | null;
  resolved_lat: number | null;
  resolved_lng: number | null;
  location_confirmed: number;
  public_lat: number | null;
  public_lng: number | null;
  needed_from: string | null;
  needed_by: string | null;
  reported_urgency: string | null;
  contact_method: string | null;
  contact_value: string | null;
  original_language: string;
  original_text: string | null;
  transcript_text: string | null;
  submitted_on_behalf: number;
  behalf_role: string | null;
  missing_fields: string;
  review_flags: string;
  danger_reported: number;
  source_kind: string;
  input_mode: string;
  extraction_provider: string | null;
  stt_provider: string | null;
  /**
   * sha256 of the private tracking token. Declared because `SELECT *` returns
   * it, so leaving it off the type would hide it rather than protect it. No
   * route returns a RequestRow directly: every response is built by one of the
   * view functions in domain/dashboard.ts, which pick fields explicitly.
   */
  tracking_token_hash: string;
  created_by: string | null;
  is_fictional: number;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  first_allocated_at: string | null;
}

export interface RequestItemRow {
  id: string;
  request_id: string;
  category_id: string;
  quantity: number | null;
  unit: string;
  quantity_uncertain: number;
  note: string | null;
  created_at: string;
}

export interface CreateRequestResult {
  requestId: string;
  referenceCode: string;
  /** Returned to the user once. Only its sha256 hash is stored. */
  trackingToken: string;
  status: RequestStatus;
  missingFields: string[];
}

function nextSequence(db: DB): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number };
  return row.n + 1;
}

/** Essential information a coordinator needs before a request is actionable. */
export function computeMissingFields(draft: RequestDraft): string[] {
  const missing: string[] = [];
  if (!draft.intent) missing.push('intent');
  if (draft.items.length === 0) missing.push('resources');
  if (!draft.locationText) missing.push('location');
  else if (!draft.locationConfirmed) missing.push('location_confirmation');
  if (draft.groupSize === null && draft.items.every((i) => i.quantity === null)) {
    missing.push('scale');
  }
  for (const item of draft.items) {
    if (item.quantity === null || item.quantityUncertain) {
      missing.push(`quantity:${item.categoryId}`);
    }
  }
  return missing;
}

export function computeReviewFlags(draft: RequestDraft): string[] {
  const flags: string[] = [];
  if (draft.dangerReported) flags.push('danger_reported');
  if (draft.items.some((i) => i.quantity === null || i.quantityUncertain)) {
    flags.push('quantity_uncertain');
  }
  if (draft.groupSizeUncertain) flags.push('group_size_uncertain');
  if (draft.locationText && !draft.locationConfirmed) flags.push('location_unconfirmed');
  if (draft.behalfRole !== 'self') flags.push('submitted_on_behalf');
  if (draft.skippedFields.length > 0) flags.push('questions_skipped');
  return flags;
}

export interface CreateRequestOptions {
  districtId: string;
  inputMode: 'voice' | 'text' | 'voice_demo';
  extractionProvider?: string | null;
  sttProvider?: string | null;
  createdBy?: string | null;
  transcriptText?: string | null;
}

/**
 * Persists a request. Everything the model touched has already been through
 * `requestDraftSchema`; this function performs no inference of its own.
 *
 * Note what is NOT derived here: a null quantity stays null. There is no path
 * from `groupSize` to an item quantity anywhere in this file.
 */
export function createRequest(
  db: DB,
  draft: RequestDraft,
  opts: CreateRequestOptions,
): CreateRequestResult {
  const token = trackingToken();
  const missing = computeMissingFields(draft);
  const flags = computeReviewFlags(draft);

  return transact(db, (tx) => {
    const requestId = id('req');
    const ref = referenceCode(nextSequence(tx));
    const now = nowIso();

    // Public map points are coarsened. Exact locations are coordinator-only.
    const publicPoint =
      draft.resolvedLat !== null && draft.resolvedLng !== null
        ? coarsen(draft.resolvedLat, draft.resolvedLng)
        : null;

    tx.prepare(
      `INSERT INTO requests (
        id, reference_code, district_id, intent, status,
        group_size, group_size_uncertain,
        location_text, resolved_facility_id, resolved_lat, resolved_lng,
        location_confirmed, public_lat, public_lng,
        needed_from, needed_by, reported_urgency,
        contact_method, contact_value,
        original_language, original_text, transcript_text,
        submitted_on_behalf, behalf_role,
        missing_fields, review_flags, danger_reported,
        source_kind, input_mode, extraction_provider, stt_provider,
        tracking_token_hash, created_by, is_fictional, created_at, updated_at
      ) VALUES (
        @id, @ref, @district, @intent, 'submitted',
        @groupSize, @groupSizeUncertain,
        @locationText, @facilityId, @lat, @lng,
        @locationConfirmed, @publicLat, @publicLng,
        @neededFrom, @neededBy, @urgency,
        @contactMethod, @contactValue,
        @language, @originalText, @transcriptText,
        @onBehalf, @behalfRole,
        @missing, @flags, @danger,
        'user_reported', @inputMode, @extractionProvider, @sttProvider,
        @tokenHash, @createdBy, 1, @now, @now
      )`,
    ).run({
      id: requestId,
      ref,
      district: opts.districtId,
      intent: draft.intent ?? 'need',
      groupSize: draft.groupSize,
      groupSizeUncertain: draft.groupSizeUncertain ? 1 : 0,
      locationText: draft.locationText ?? 'Location not given',
      facilityId: draft.resolvedFacilityId,
      lat: draft.resolvedLat,
      lng: draft.resolvedLng,
      locationConfirmed: draft.locationConfirmed ? 1 : 0,
      publicLat: publicPoint?.lat ?? null,
      publicLng: publicPoint?.lng ?? null,
      neededFrom: draft.neededFrom,
      neededBy: draft.neededBy,
      urgency: draft.urgency,
      contactMethod: draft.contactMethod,
      contactValue: draft.contactValue,
      language: draft.language,
      originalText: draft.originalText || null,
      transcriptText: opts.transcriptText ?? null,
      onBehalf: draft.behalfRole === 'self' ? 0 : 1,
      behalfRole: draft.behalfRole,
      missing: JSON.stringify(missing),
      flags: JSON.stringify(flags),
      danger: draft.dangerReported ? 1 : 0,
      inputMode: opts.inputMode,
      extractionProvider: opts.extractionProvider ?? null,
      sttProvider: opts.sttProvider ?? null,
      tokenHash: sha256Hex(token),
      createdBy: opts.createdBy ?? null,
      now,
    });

    const insertItem = tx.prepare(
      `INSERT INTO request_items (id, request_id, category_id, quantity, unit, quantity_uncertain, note, created_at)
       VALUES (@id, @requestId, @categoryId, @quantity, @unit, @uncertain, @note, @now)`,
    );
    for (const item of draft.items) {
      insertItem.run({
        id: id('itm'),
        requestId,
        categoryId: item.categoryId,
        quantity: item.quantity,
        unit: unitFor(item.categoryId),
        uncertain: item.quantityUncertain ? 1 : 0,
        note: item.note ?? null,
        now,
      });
    }

    appendEvent(tx, {
      requestId,
      kind: 'submitted',
      detail: {
        inputMode: opts.inputMode,
        extractionProvider: opts.extractionProvider ?? null,
        sttProvider: opts.sttProvider ?? null,
        missingFields: missing,
        reviewFlags: flags,
      },
      actorKind: opts.createdBy ? 'coordinator' : 'public',
      actorUserId: opts.createdBy ?? null,
    });

    return {
      requestId,
      referenceCode: ref,
      trackingToken: token,
      status: 'submitted' as RequestStatus,
      missingFields: missing,
    };
  });
}

export function appendEvent(
  db: DB,
  event: {
    requestId: string;
    kind: string;
    detail?: unknown;
    actorKind: 'public' | 'coordinator' | 'facility_rep' | 'volunteer' | 'donor' | 'system';
    actorUserId?: string | null;
  },
): void {
  db.prepare(
    `INSERT INTO request_events (id, request_id, kind, detail, actor_kind, actor_user_id, created_at)
     VALUES (@id, @requestId, @kind, @detail, @actorKind, @actorUserId, @now)`,
  ).run({
    id: id('evt'),
    requestId: event.requestId,
    kind: event.kind,
    detail: JSON.stringify(event.detail ?? {}),
    actorKind: event.actorKind,
    actorUserId: event.actorUserId ?? null,
    now: nowIso(),
  });
}

export function getRequestById(db: DB, requestId: string): RequestRow | undefined {
  return db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId) as
    | RequestRow
    | undefined;
}

/**
 * Looks a request up by its private tracking token.
 *
 * Only the hash is compared, and the human reference code (RR-1042) is
 * deliberately not accepted here: it is printable and guessable, so it must
 * never grant access to contact details or exact locations.
 */
export function getRequestByTrackingToken(db: DB, token: string): RequestRow | undefined {
  return db
    .prepare('SELECT * FROM requests WHERE tracking_token_hash = ?')
    .get(sha256Hex(token)) as RequestRow | undefined;
}

export function getRequestItems(db: DB, requestId: string): RequestItemRow[] {
  return db
    .prepare('SELECT * FROM request_items WHERE request_id = ? ORDER BY created_at')
    .all(requestId) as RequestItemRow[];
}

export interface CommitmentView {
  id: string;
  organizationId: string;
  organizationName: string;
  qty: number;
  unit: string;
  status: CommitmentStatus;
  receivedQty: number;
  dispatchedQty: number;
  createdAt: string;
  /** Who is carrying this, if anyone. Null when nobody has been assigned. */
  assignment: { id: string; volunteerName: string; status: string } | null;
}

export interface ItemWithAllocation extends ItemAllocation {
  commitments: CommitmentView[];
}

/** Assembles per-item allocation facts from stock, commitment and receipt rows. */
export function getAllocations(db: DB, requestId: string): ItemWithAllocation[] {
  const items = getRequestItems(db, requestId);
  // The current assignment is joined in because a coordinator who has just
  // assigned a delivery needs to see that it happened. Without it the action
  // completes silently and reads as broken.
  const commitments = db
    .prepare(
      `SELECT c.*, o.name AS org_name,
              COALESCE((SELECT SUM(r.qty_received) FROM receipts r WHERE r.commitment_id = c.id), 0) AS received_qty,
              COALESCE((SELECT SUM(d.qty) FROM dispatches d WHERE d.commitment_id = c.id), 0) AS dispatched_qty,
              a.id AS assignment_id, a.status AS assignment_status, au.display_name AS assignee_name
         FROM commitments c
         JOIN organizations o ON o.id = c.organization_id
         LEFT JOIN assignments a
           ON a.id = (SELECT id FROM assignments
                       WHERE commitment_id = c.id AND status IN ('offered','accepted','completed')
                       ORDER BY created_at DESC LIMIT 1)
         LEFT JOIN users au ON au.id = a.volunteer_id
        WHERE c.request_id = ?
        ORDER BY c.created_at`,
    )
    .all(requestId) as Array<{
    id: string;
    request_item_id: string;
    organization_id: string;
    org_name: string;
    qty: number;
    unit: string;
    status: CommitmentStatus;
    received_qty: number;
    dispatched_qty: number;
    created_at: string;
    assignment_id: string | null;
    assignment_status: string | null;
    assignee_name: string | null;
  }>;

  return items.map((item) => {
    const own = commitments.filter((c) => c.request_item_id === item.id);
    const allocation = computeItemAllocation({
      itemId: item.id,
      categoryId: item.category_id,
      unit: item.unit,
      requestedQty: item.quantity,
      requestedUncertain: item.quantity_uncertain === 1,
      commitments: own.map((c) => ({
        id: c.id,
        organizationId: c.organization_id,
        qty: c.qty,
        status: c.status,
        receivedQty: c.received_qty,
        dispatchedQty: c.dispatched_qty,
      })),
    });
    return {
      ...allocation,
      commitments: own.map((c) => ({
        id: c.id,
        organizationId: c.organization_id,
        organizationName: c.org_name,
        qty: c.qty,
        unit: c.unit,
        status: c.status,
        receivedQty: c.received_qty,
        dispatchedQty: c.dispatched_qty,
        createdAt: c.created_at,
        assignment:
          c.assignment_id && c.assignee_name
            ? {
                id: c.assignment_id,
                volunteerName: c.assignee_name,
                status: c.assignment_status ?? 'offered',
              }
            : null,
      })),
    };
  });
}

export function hasActiveAssignment(db: DB, requestId: string): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
         FROM assignments a
         JOIN commitments c ON c.id = a.commitment_id
        WHERE c.request_id = ? AND a.status IN ('accepted','offered')`,
    )
    .get(requestId) as { n: number };
  return row.n > 0;
}

/**
 * Recomputes and stores a request's status from the current records.
 * Called after every commitment, dispatch, receipt or cancellation so the
 * stored status can never drift from the underlying facts.
 */
export function recomputeRequestStatus(db: DB, requestId: string): RequestStatus {
  const request = getRequestById(db, requestId);
  if (!request) throw new Error(`No such request: ${requestId}`);
  if (request.status === 'cancelled') return 'cancelled';

  const allocations = getAllocations(db, requestId);
  const anyDisputed = db
    .prepare(
      `SELECT COUNT(*) AS n FROM commitments WHERE request_id = ? AND status = 'disputed'`,
    )
    .get(requestId) as { n: number };

  const status = deriveRequestStatus({
    allocations,
    reviewed: request.reviewed_at !== null,
    manualStatus: request.status === 'disputed' ? 'disputed' : null,
    anyDisputed: anyDisputed.n > 0,
  });

  if (status !== request.status) {
    db.prepare('UPDATE requests SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      nowIso(),
      requestId,
    );
    appendEvent(db, {
      requestId,
      kind: 'status_changed',
      detail: { from: request.status, to: status },
      actorKind: 'system',
    });
  }
  return status;
}

export function markReviewed(db: DB, requestId: string, userId: string): void {
  const request = getRequestById(db, requestId);
  if (!request) throw new Error('No such request');
  if (request.reviewed_at) return;
  db.prepare('UPDATE requests SET reviewed_at = ?, source_kind = ?, updated_at = ? WHERE id = ?').run(
    nowIso(),
    'coordinator_reviewed',
    nowIso(),
    requestId,
  );
  appendEvent(db, {
    requestId,
    kind: 'coordinator_reviewed',
    actorKind: 'coordinator',
    actorUserId: userId,
  });
  recomputeRequestStatus(db, requestId);
}

/** Sets a confirmed quantity on an item. Only a human may resolve an unknown. */
export function setItemQuantity(
  db: DB,
  requestItemId: string,
  quantity: number,
  actor: { kind: 'coordinator' | 'public'; userId?: string | null },
): void {
  const item = db.prepare('SELECT * FROM request_items WHERE id = ?').get(requestItemId) as
    | RequestItemRow
    | undefined;
  if (!item) throw new Error('No such request item');
  db.prepare(
    'UPDATE request_items SET quantity = ?, quantity_uncertain = 0 WHERE id = ?',
  ).run(quantity, requestItemId);
  appendEvent(db, {
    requestId: item.request_id,
    kind: 'quantity_confirmed',
    detail: { categoryId: item.category_id, quantity, unit: item.unit, previous: item.quantity },
    actorKind: actor.kind,
    actorUserId: actor.userId ?? null,
  });
  refreshMissingFields(db, item.request_id);
  recomputeRequestStatus(db, item.request_id);
}

export function refreshMissingFields(db: DB, requestId: string): void {
  const request = getRequestById(db, requestId);
  if (!request) return;
  const items = getRequestItems(db, requestId);
  const missing: string[] = [];
  if (items.length === 0) missing.push('resources');
  if (!request.location_confirmed) missing.push('location_confirmation');
  if (request.group_size === null && items.every((i) => i.quantity === null)) {
    missing.push('scale');
  }
  for (const item of items) {
    if (item.quantity === null || item.quantity_uncertain === 1) {
      missing.push(`quantity:${item.category_id}`);
    }
  }
  db.prepare('UPDATE requests SET missing_fields = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(missing),
    nowIso(),
    requestId,
  );
}
