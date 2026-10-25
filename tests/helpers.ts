import { createTestDb, type DB } from '@/lib/db';
import { seed } from '@/lib/db/seed';
import { createRequest } from '@/lib/domain/requests';
import { emptyDraft, requestDraftSchema, type RequestDraft } from '@/lib/validation/schemas';

export function freshDb(): DB {
  const db = createTestDb();
  seed(db);
  return db;
}

export function draftWith(partial: Partial<RequestDraft>): RequestDraft {
  return requestDraftSchema.parse({ ...emptyDraft(), ...partial });
}

/** A request for a known quantity of one category, ready for allocation. */
export function makeRequest(
  db: DB,
  opts: {
    items: Array<{ categoryId: string; quantity: number | null; quantityUncertain?: boolean }>;
    groupSize?: number | null;
    locationText?: string;
    facilityId?: string | null;
    confirmed?: boolean;
  },
) {
  const draft = draftWith({
    intent: 'need',
    items: opts.items.map((i) => ({
      categoryId: i.categoryId as never,
      quantity: i.quantity,
      unit:
        i.categoryId === 'drinking_water'
          ? 'litres'
          : i.categoryId === 'meal_packs'
            ? 'packs'
            : i.categoryId === 'hygiene_kits'
              ? 'kits'
              : 'spaces',
      quantityUncertain: i.quantityUncertain ?? false,
    })),
    groupSize: opts.groupSize ?? null,
    locationText: opts.locationText ?? 'Riverside Primary School',
    resolvedFacilityId: opts.facilityId ?? 'fac_riverside_primary',
    resolvedLat: 0.028,
    resolvedLng: -30.031,
    locationConfirmed: opts.confirmed ?? true,
  });
  return createRequest(db, draft, {
    districtId: 'dist_riverbend',
    inputMode: 'text',
    extractionProvider: 'test',
  });
}

export function itemIdFor(db: DB, requestId: string, categoryId: string): string {
  const row = db
    .prepare('SELECT id FROM request_items WHERE request_id = ? AND category_id = ?')
    .get(requestId, categoryId) as { id: string };
  return row.id;
}

export function lotQty(db: DB, lotId: string): { total: number; committed: number; available: number } {
  const row = db
    .prepare('SELECT qty_total, qty_committed FROM inventory_lots WHERE id = ?')
    .get(lotId) as { qty_total: number; qty_committed: number };
  return {
    total: row.qty_total,
    committed: row.qty_committed,
    available: row.qty_total - row.qty_committed,
  };
}
