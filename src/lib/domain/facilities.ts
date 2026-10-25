import type { DB } from '@/lib/db';
import { transact } from '@/lib/db';
import { id, nowIso } from '@/lib/util/ids';
import { formatAge, freshness, type Freshness } from '@/lib/util/time';

export interface FacilityRow {
  id: string;
  district_id: string;
  name: string;
  kind: 'shelter' | 'supply_hub';
  lat: number;
  lng: number;
  address: string;
  public_contact: string | null;
  accessibility: string;
  opening_status: 'open' | 'full' | 'closed';
  capacity_total: number | null;
  capacity_available: number | null;
  is_fictional: number;
}

export interface FacilityView {
  id: string;
  name: string;
  kind: 'shelter' | 'supply_hub';
  lat: number;
  lng: number;
  address: string;
  publicContact: string | null;
  accessibility: string[];
  openingStatus: 'open' | 'full' | 'closed';
  capacityTotal: number | null;
  capacityAvailable: number | null;
  /** Resource categories currently held, from recorded stock at this facility. */
  resourceCategories: string[];
  resourcesNote: string | null;
  lastUpdateAt: string | null;
  lastUpdateAge: string;
  lastUpdateSource: string | null;
  freshness: Freshness;
  /**
   * How to read the capacity figure. These four states are deliberately
   * distinct: a number confirmed 20 minutes ago and the same number from
   * yesterday are not the same information.
   */
  availabilityLabel:
    | 'recently_confirmed'
    | 'reported'
    | 'stale'
    | 'full'
    | 'closed';
  isFictional: boolean;
}

export function facilityView(db: DB, row: FacilityRow, now = new Date()): FacilityView {
  const update = db
    .prepare(
      `SELECT * FROM facility_updates WHERE facility_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(row.id) as
    | {
        created_at: string;
        source_kind: string;
        resources_note: string | null;
        capacity_available: number | null;
      }
    | undefined;

  const categories = db
    .prepare(
      `SELECT DISTINCT category_id FROM inventory_lots
        WHERE facility_id = ? AND (qty_total - qty_committed) > 0`,
    )
    .all(row.id) as Array<{ category_id: string }>;

  const state = freshness(update?.created_at, { now, freshMinutes: 90, staleMinutes: 480 });

  let availabilityLabel: FacilityView['availabilityLabel'];
  if (row.opening_status === 'closed') availabilityLabel = 'closed';
  else if (row.opening_status === 'full') availabilityLabel = 'full';
  else if (state === 'fresh') availabilityLabel = 'recently_confirmed';
  else if (state === 'ageing') availabilityLabel = 'reported';
  else availabilityLabel = 'stale';

  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    lat: row.lat,
    lng: row.lng,
    address: row.address,
    publicContact: row.public_contact,
    accessibility: JSON.parse(row.accessibility) as string[],
    openingStatus: row.opening_status,
    capacityTotal: row.capacity_total,
    capacityAvailable: row.capacity_available,
    resourceCategories: categories.map((c) => c.category_id),
    resourcesNote: update?.resources_note ?? null,
    lastUpdateAt: update?.created_at ?? null,
    lastUpdateAge: formatAge(update?.created_at, now),
    lastUpdateSource: update?.source_kind ?? null,
    freshness: state,
    availabilityLabel,
    isFictional: row.is_fictional === 1,
  };
}

export function listFacilities(db: DB, kind?: 'shelter' | 'supply_hub'): FacilityView[] {
  const rows = (
    kind
      ? db.prepare('SELECT * FROM facilities WHERE kind = ? ORDER BY name').all(kind)
      : db.prepare('SELECT * FROM facilities ORDER BY kind, name').all()
  ) as FacilityRow[];
  const now = new Date();
  return rows.map((row) => facilityView(db, row, now));
}

export function getFacility(db: DB, facilityId: string): FacilityView | null {
  const row = db.prepare('SELECT * FROM facilities WHERE id = ?').get(facilityId) as
    | FacilityRow
    | undefined;
  return row ? facilityView(db, row) : null;
}

export interface FacilityUpdateInput {
  facilityId: string;
  capacityAvailable: number | null;
  openingStatus: 'open' | 'full' | 'closed' | null;
  resourcesNote: string | null;
  note: string | null;
  sourceKind: 'facility_confirmed' | 'coordinator_reviewed' | 'user_reported';
  reportedBy: string | null;
}

/**
 * Appends a facility update and moves the facility's current figures.
 *
 * The history row is what the directory reads for provenance and freshness,
 * so an update always leaves a trace of who said it and when.
 */
export function recordFacilityUpdate(db: DB, input: FacilityUpdateInput): { updateId: string } {
  return transact(db, (tx) => {
    const facility = tx.prepare('SELECT * FROM facilities WHERE id = ?').get(input.facilityId) as
      | FacilityRow
      | undefined;
    if (!facility) throw new Error('No such facility.');

    const updateId = id('fup');
    const now = nowIso();
    tx.prepare(
      `INSERT INTO facility_updates (
         id, facility_id, capacity_available, opening_status, note, resources_note,
         source_kind, reported_by, created_at
       ) VALUES (@id, @facilityId, @capacity, @status, @note, @resourcesNote, @sourceKind, @reportedBy, @now)`,
    ).run({
      id: updateId,
      facilityId: input.facilityId,
      capacity: input.capacityAvailable,
      status: input.openingStatus,
      note: input.note,
      resourcesNote: input.resourcesNote,
      sourceKind: input.sourceKind,
      reportedBy: input.reportedBy,
      now,
    });

    // A facility reporting zero spaces is full; that is a statement about
    // capacity, not a closure.
    const nextStatus =
      input.openingStatus ??
      (input.capacityAvailable === 0 && facility.opening_status === 'open'
        ? 'full'
        : facility.opening_status);

    tx.prepare(
      `UPDATE facilities
          SET capacity_available = COALESCE(@capacity, capacity_available),
              opening_status = @status
        WHERE id = @id`,
    ).run({ id: input.facilityId, capacity: input.capacityAvailable, status: nextStatus });

    return { updateId };
  });
}

export function facilityUpdateHistory(db: DB, facilityId: string, limit = 20) {
  return db
    .prepare(
      `SELECT fu.*, u.display_name AS reporter_name
         FROM facility_updates fu
         LEFT JOIN users u ON u.id = fu.reported_by
        WHERE fu.facility_id = ?
        ORDER BY fu.created_at DESC LIMIT ?`,
    )
    .all(facilityId, limit) as Array<{
    id: string;
    capacity_available: number | null;
    opening_status: string | null;
    note: string | null;
    resources_note: string | null;
    source_kind: string;
    reporter_name: string | null;
    created_at: string;
  }>;
}

export const ACCESSIBILITY_LABELS: Record<string, string> = {
  step_free_entrance: 'Step-free entrance',
  accessible_toilet: 'Accessible toilet',
  ground_floor_sleeping: 'Ground-floor sleeping',
  quiet_room: 'Quiet room',
  assistance_animals_welcome: 'Assistance animals welcome',
  loading_bay: 'Loading bay',
  forklift: 'Forklift on site',
};
