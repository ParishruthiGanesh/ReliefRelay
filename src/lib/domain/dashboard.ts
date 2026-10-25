import type { DB } from '@/lib/db';
import { ageMinutes, formatAge } from '@/lib/util/time';
import { categoryLabel, formatQuantity } from '@/lib/util/units';
import { advisoriesCovering, listAdvisories, type AdvisoryRow } from './advisories';
import { canSayHelpIsOnTheWay, explainStatus, REQUEST_STATUS_LABELS, type RequestStatus } from './allocation';
import { getAllocations, hasActiveAssignment, type ItemWithAllocation, type RequestRow } from './requests';
import { priorityScore, DEFAULT_PRIORITY_WEIGHTS, type PriorityWeights } from './metrics';

/**
 * Read models for the coordinator dashboard and the public views.
 *
 * `coordinatorRequestView` includes sensitive fields (exact location, contact
 * details, the original transcript). `publicRequestSummary` and
 * `trackingView` are built from the same rows with those fields removed, so
 * there is one place to check what each audience can see.
 */

export interface ProvenanceView {
  sourceKind: 'user_reported' | 'coordinator_reviewed' | 'facility_confirmed' | 'official_source';
  sourceLabel: string;
  lastUpdatedAt: string;
  lastUpdatedAge: string;
  isStale: boolean;
}

export const SOURCE_LABELS: Record<string, string> = {
  user_reported: 'User reported',
  coordinator_reviewed: 'Coordinator reviewed',
  facility_confirmed: 'Facility confirmed',
  official_source: 'Official environmental source',
};

function provenance(row: RequestRow): ProvenanceView {
  const age = ageMinutes(row.updated_at);
  return {
    sourceKind: row.source_kind as ProvenanceView['sourceKind'],
    sourceLabel: SOURCE_LABELS[row.source_kind] ?? row.source_kind,
    lastUpdatedAt: row.updated_at,
    lastUpdatedAge: formatAge(row.updated_at),
    isStale: age > 480,
  };
}

export interface CoordinatorRequestView {
  id: string;
  referenceCode: string;
  status: RequestStatus;
  statusLabel: string;
  statusExplanation: string;
  intent: string;
  createdAt: string;
  createdAge: string;
  ageMinutes: number;
  groupSize: number | null;
  groupSizeUncertain: boolean;
  /** Exact location. Coordinator views only. */
  locationText: string;
  resolvedFacilityId: string | null;
  resolvedFacilityName: string | null;
  lat: number | null;
  lng: number | null;
  locationConfirmed: boolean;
  reportedUrgency: string | null;
  /** Sensitive. Never in a public response. */
  contactMethod: string | null;
  contactValue: string | null;
  originalText: string | null;
  transcriptText: string | null;
  originalLanguage: string;
  inputMode: string;
  extractionProvider: string | null;
  sttProvider: string | null;
  behalfRole: string | null;
  missingFields: string[];
  reviewFlags: string[];
  dangerReported: boolean;
  allocations: ItemWithAllocation[];
  itemSummaries: Array<{
    itemId: string;
    categoryId: string;
    label: string;
    requestedLabel: string;
    committedLabel: string;
    receivedLabel: string;
    outstandingLabel: string;
    shortfallLabel: string | null;
    needsQuantityConfirmation: boolean;
  }>;
  hasDiscrepancy: boolean;
  hasActiveAssignment: boolean;
  canSayHelpIsOnTheWay: boolean;
  provenance: ProvenanceView;
  advisories: Array<{ id: string; headline: string; severity: string; isSimulated: boolean }>;
  priority: { score: number; terms: Array<{ factor: string; contribution: number }> };
  isFictional: boolean;
}

function itemSummaries(allocations: ItemWithAllocation[]) {
  return allocations.map((a) => ({
    itemId: a.itemId,
    categoryId: a.categoryId,
    label: categoryLabel(a.categoryId),
    requestedLabel: formatQuantity(a.requestedQty, a.categoryId, a.requestedUncertain),
    committedLabel: `${a.openCommittedQty} ${a.unit}`,
    receivedLabel: `${a.receivedQty} ${a.unit}`,
    outstandingLabel:
      a.outstandingQty === null ? 'unknown until a quantity is confirmed' : `${a.outstandingQty} ${a.unit}`,
    shortfallLabel: a.shortfallQty > 0 ? `${a.shortfallQty} ${a.unit} short` : null,
    needsQuantityConfirmation: a.needsQuantityConfirmation,
  }));
}

export function coordinatorRequestView(
  db: DB,
  row: RequestRow,
  advisories: AdvisoryRow[],
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): CoordinatorRequestView {
  const allocations = getAllocations(db, row.id);
  const assignment = hasActiveAssignment(db, row.id);

  const facility = row.resolved_facility_id
    ? (db.prepare('SELECT name, capacity_available, capacity_total FROM facilities WHERE id = ?').get(
        row.resolved_facility_id,
      ) as { name: string; capacity_available: number | null; capacity_total: number | null } | undefined)
    : undefined;

  const covering =
    row.resolved_lat !== null && row.resolved_lng !== null
      ? advisoriesCovering(advisories, row.resolved_lat, row.resolved_lng)
      : [];

  const totalRequested = allocations.reduce((sum, a) => sum + (a.requestedQty ?? 0), 0);
  const totalOutstanding = allocations.reduce((sum, a) => sum + (a.outstandingQty ?? 0), 0);
  const outstandingShare = totalRequested > 0 ? totalOutstanding / totalRequested : 1;

  const nearlyFull =
    !!facility &&
    facility.capacity_available !== null &&
    facility.capacity_total !== null &&
    facility.capacity_total > 0 &&
    facility.capacity_available / facility.capacity_total < 0.1;

  const priority = priorityScore(
    {
      ageMinutes: ageMinutes(row.created_at),
      outstandingShare,
      reportedUrgency: row.reported_urgency,
      dangerReported: row.danger_reported === 1,
      shelterNearlyFull: nearlyFull,
      underAdvisory: covering.length > 0,
    },
    weights,
  );

  return {
    id: row.id,
    referenceCode: row.reference_code,
    status: row.status,
    statusLabel: REQUEST_STATUS_LABELS[row.status],
    statusExplanation: explainStatus(row.status, assignment),
    intent: row.intent,
    createdAt: row.created_at,
    createdAge: formatAge(row.created_at),
    ageMinutes: Math.round(ageMinutes(row.created_at)),
    groupSize: row.group_size,
    groupSizeUncertain: row.group_size_uncertain === 1,
    locationText: row.location_text,
    resolvedFacilityId: row.resolved_facility_id,
    resolvedFacilityName: facility?.name ?? null,
    lat: row.resolved_lat,
    lng: row.resolved_lng,
    locationConfirmed: row.location_confirmed === 1,
    reportedUrgency: row.reported_urgency,
    contactMethod: row.contact_method,
    contactValue: row.contact_value,
    originalText: row.original_text,
    transcriptText: row.transcript_text,
    originalLanguage: row.original_language,
    inputMode: row.input_mode,
    extractionProvider: row.extraction_provider,
    sttProvider: row.stt_provider,
    behalfRole: row.behalf_role,
    missingFields: JSON.parse(row.missing_fields) as string[],
    reviewFlags: JSON.parse(row.review_flags) as string[],
    dangerReported: row.danger_reported === 1,
    allocations,
    itemSummaries: itemSummaries(allocations),
    hasDiscrepancy: allocations.some((a) => a.hasDiscrepancy),
    hasActiveAssignment: assignment,
    canSayHelpIsOnTheWay: canSayHelpIsOnTheWay(row.status, assignment),
    provenance: provenance(row),
    advisories: covering.map((a) => ({
      id: a.id,
      headline: a.headline,
      severity: a.severity,
      isSimulated: a.record_kind === 'scenario',
    })),
    priority,
    isFictional: row.is_fictional === 1,
  };
}

export interface RequestFilters {
  categoryId?: string;
  status?: string;
  maxAgeMinutes?: number;
  facilityId?: string;
  missingInfoOnly?: boolean;
  discrepanciesOnly?: boolean;
  search?: string;
}

export function listCoordinatorRequests(
  db: DB,
  filters: RequestFilters = {},
  weights?: PriorityWeights,
): CoordinatorRequestView[] {
  const clauses: string[] = ["r.intent = 'need'"];
  const params: Record<string, unknown> = {};

  if (filters.status) {
    clauses.push('r.status = @status');
    params.status = filters.status;
  }
  if (filters.facilityId) {
    clauses.push('r.resolved_facility_id = @facilityId');
    params.facilityId = filters.facilityId;
  }
  if (filters.categoryId) {
    clauses.push('EXISTS (SELECT 1 FROM request_items i WHERE i.request_id = r.id AND i.category_id = @categoryId)');
    params.categoryId = filters.categoryId;
  }
  if (filters.missingInfoOnly) {
    clauses.push("r.missing_fields != '[]'");
  }
  if (filters.search) {
    clauses.push('(r.reference_code LIKE @search OR r.location_text LIKE @search)');
    params.search = `%${filters.search}%`;
  }

  const rows = db
    .prepare(
      `SELECT * FROM requests r WHERE ${clauses.join(' AND ')} ORDER BY r.created_at DESC LIMIT 300`,
    )
    .all(params) as RequestRow[];

  const advisories = listAdvisories(db);
  let views = rows.map((row) => coordinatorRequestView(db, row, advisories, weights));

  if (filters.maxAgeMinutes !== undefined) {
    views = views.filter((v) => v.ageMinutes <= filters.maxAgeMinutes!);
  }
  if (filters.discrepanciesOnly) {
    views = views.filter((v) => v.hasDiscrepancy);
  }
  return views.sort((a, b) => b.priority.score - a.priority.score);
}

// ────────────────────────────── public views ───────────────────────────────

export interface PublicNeedSummary {
  referenceCode: string;
  status: RequestStatus;
  statusLabel: string;
  /** Generalised: a coarse point, never an exact household location. */
  publicLat: number | null;
  publicLng: number | null;
  /** A general area name, not a street address. */
  areaLabel: string;
  categories: string[];
  createdAge: string;
  /** Whether anything is still unmet, without exposing quantities per household. */
  hasUnmetNeed: boolean;
}

/**
 * The public map and list.
 *
 * Deliberately omitted: exact coordinates, street addresses, contact details,
 * group sizes, the original transcript, and per-request quantities. What
 * remains is enough to show where need is concentrated without identifying
 * anyone's household.
 */
export function publicNeedSummaries(db: DB): PublicNeedSummary[] {
  const rows = db
    .prepare(
      `SELECT r.id, r.reference_code, r.status, r.public_lat, r.public_lng, r.created_at,
              r.resolved_facility_id,
              (SELECT name FROM facilities WHERE id = r.resolved_facility_id) AS facility_name,
              (SELECT json_group_array(DISTINCT category_id) FROM request_items WHERE request_id = r.id) AS categories
         FROM requests r
        WHERE r.intent = 'need' AND r.status NOT IN ('cancelled')
        ORDER BY r.created_at DESC LIMIT 200`,
    )
    .all() as Array<{
    id: string;
    reference_code: string;
    status: RequestStatus;
    public_lat: number | null;
    public_lng: number | null;
    created_at: string;
    facility_name: string | null;
    categories: string;
  }>;

  return rows.map((row) => {
    const allocations = getAllocations(db, row.id);
    return {
      referenceCode: row.reference_code,
      status: row.status,
      statusLabel: REQUEST_STATUS_LABELS[row.status],
      publicLat: row.public_lat,
      publicLng: row.public_lng,
      areaLabel: row.facility_name ?? 'Riverbend District (area generalised)',
      categories: (JSON.parse(row.categories) as string[]).map((categoryId) => categoryLabel(categoryId)),
      createdAge: formatAge(row.created_at),
      hasUnmetNeed: allocations.some((a) => a.outstandingQty === null || a.outstandingQty > 0),
    };
  });
}

export interface TrackingView {
  referenceCode: string;
  status: RequestStatus;
  statusLabel: string;
  statusExplanation: string;
  canSayHelpIsOnTheWay: boolean;
  createdAt: string;
  createdAge: string;
  locationText: string;
  groupSize: number | null;
  items: Array<{
    itemId: string;
    label: string;
    requestedLabel: string;
    committedLabel: string;
    receivedLabel: string;
    outstandingLabel: string;
    shortfallLabel: string | null;
    commitments: Array<{
      id: string;
      organizationName: string;
      qty: number;
      unit: string;
      status: string;
      receivedQty: number;
      canConfirmReceipt: boolean;
    }>;
  }>;
  missingFields: string[];
  timeline: Array<{ kind: string; detail: Record<string, unknown>; createdAt: string; actorKind: string }>;
  dangerReported: boolean;
}

/**
 * Which event kinds the requester sees, and which fields of each.
 *
 * An allow-list rather than a redaction list, because the raw `detail` blobs
 * are written by many call sites and will grow. Two kinds in particular must
 * never reach this view: a duplicate decision carries another person's request
 * id, and coordinator review notes are internal. Anything not listed here is
 * dropped rather than passed through.
 */
const TRACKING_EVENT_FIELDS: Record<string, string[]> = {
  submitted: ['inputMode'],
  coordinator_reviewed: [],
  status_changed: ['from', 'to'],
  commitment_recorded: ['categoryId', 'qty', 'unit'],
  commitment_cancelled: ['qty', 'unit', 'reason', 'reopenedQty'],
  dispatch_recorded: ['qty', 'unit'],
  receipt_confirmed: ['committedQty', 'receivedQty', 'shortfallQty', 'unit', 'note'],
  delivery_failed: ['committedQty', 'receivedQty', 'shortfallQty', 'unit', 'note'],
  delivery_assigned: [],
  delivery_reassigned: [],
  quantity_confirmed: ['categoryId', 'quantity', 'unit'],
  information_added: ['note'],
  cancelled_by_requester: [],
  commitment_disputed: ['reason'],
  assignment_accepted: [],
  assignment_withdrawn: [],
  assignment_completed: [],
};

function sanitizeTrackingEvent(
  kind: string,
  detail: Record<string, unknown>,
): Record<string, unknown> | null {
  const allowed = TRACKING_EVENT_FIELDS[kind];
  if (!allowed) return null;
  const out: Record<string, unknown> = {};
  for (const field of allowed) {
    if (detail[field] !== undefined) out[field] = detail[field];
  }
  return out;
}

/**
 * What the person who made the request sees via their private link.
 *
 * They get their own request in full, including who committed what, because it
 * is their request — but no other request, and no coordinator-only notes.
 */
export function trackingView(db: DB, row: RequestRow): TrackingView {
  const allocations = getAllocations(db, row.id);
  const assignment = hasActiveAssignment(db, row.id);
  const events = db
    .prepare(
      `SELECT kind, detail, created_at, actor_kind FROM request_events
        WHERE request_id = ? ORDER BY created_at`,
    )
    .all(row.id) as Array<{ kind: string; detail: string; created_at: string; actor_kind: string }>;

  return {
    referenceCode: row.reference_code,
    status: row.status,
    statusLabel: REQUEST_STATUS_LABELS[row.status],
    statusExplanation: explainStatus(row.status, assignment),
    canSayHelpIsOnTheWay: canSayHelpIsOnTheWay(row.status, assignment),
    createdAt: row.created_at,
    createdAge: formatAge(row.created_at),
    locationText: row.location_text,
    groupSize: row.group_size,
    items: allocations.map((a) => ({
      itemId: a.itemId,
      label: categoryLabel(a.categoryId),
      requestedLabel: formatQuantity(a.requestedQty, a.categoryId, a.requestedUncertain),
      committedLabel: `${a.openCommittedQty} ${a.unit}`,
      receivedLabel: `${a.receivedQty} ${a.unit}`,
      outstandingLabel:
        a.outstandingQty === null ? 'not yet known' : `${a.outstandingQty} ${a.unit}`,
      shortfallLabel: a.shortfallQty > 0 ? `${a.shortfallQty} ${a.unit} did not arrive` : null,
      commitments: a.commitments.map((c) => ({
        id: c.id,
        organizationName: c.organizationName,
        qty: c.qty,
        unit: c.unit,
        status: c.status,
        receivedQty: c.receivedQty,
        // The recipient can confirm receipt once something has been dispatched.
        canConfirmReceipt: c.status === 'dispatched' || c.status === 'committed',
      })),
    })),
    missingFields: JSON.parse(row.missing_fields) as string[],
    timeline: events.flatMap((e) => {
      const detail = sanitizeTrackingEvent(e.kind, JSON.parse(e.detail) as Record<string, unknown>);
      // An unrecognised event kind is withheld rather than passed through, so a
      // new internal event cannot leak by default.
      if (detail === null) return [];
      return [{ kind: e.kind, detail, createdAt: e.created_at, actorKind: e.actor_kind }];
    }),
    dangerReported: row.danger_reported === 1,
  };
}
