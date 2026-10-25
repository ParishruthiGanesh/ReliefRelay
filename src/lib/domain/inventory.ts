import type { DB } from '@/lib/db';
import { transact } from '@/lib/db';
import { id, nowIso } from '@/lib/util/ids';
import { unitFor } from '@/lib/util/units';
import { lotAvailable, type LotRow } from './commitments';

export interface LotView {
  id: string;
  organizationId: string;
  organizationName: string;
  categoryId: string;
  unit: string;
  qtyTotal: number;
  qtyCommitted: number;
  qtyAvailable: number;
  generalLocation: string;
  facilityId: string | null;
  availableFrom: string | null;
  availableUntil: string | null;
  expiryNote: string | null;
  storageNote: string | null;
  handover: string;
  updatedAt: string;
}

export function listInventory(db: DB, categoryId?: string): LotView[] {
  const rows = (
    categoryId
      ? db
          .prepare(
            `SELECT l.*, o.name AS org_name FROM inventory_lots l
               JOIN organizations o ON o.id = l.organization_id
              WHERE l.category_id = ? ORDER BY o.name`,
          )
          .all(categoryId)
      : db
          .prepare(
            `SELECT l.*, o.name AS org_name FROM inventory_lots l
               JOIN organizations o ON o.id = l.organization_id
              ORDER BY l.category_id, o.name`,
          )
          .all()
  ) as Array<LotRow & { org_name: string; updated_at: string }>;

  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.org_name,
    categoryId: row.category_id,
    unit: row.unit,
    qtyTotal: row.qty_total,
    qtyCommitted: row.qty_committed,
    qtyAvailable: lotAvailable(row),
    generalLocation: row.general_location,
    facilityId: row.facility_id,
    availableFrom: row.available_from,
    availableUntil: row.available_until,
    expiryNote: row.expiry_note,
    storageNote: row.storage_note,
    handover: row.handover,
    updatedAt: row.updated_at,
  }));
}

export interface OfferInput {
  organizationId?: string | null;
  contactName?: string | null;
  contactMethod?: string | null;
  contactValue?: string | null;
  categoryId: string;
  qty: number;
  generalLocation: string;
  availableFrom?: string | null;
  availableUntil?: string | null;
  handover: 'collection' | 'delivery' | 'either';
  storageNote?: string | null;
  expiryNote?: string | null;
  idempotencyKey: string;
}

/**
 * Records a donor offer.
 *
 * An offer is not stock. It waits for a coordinator to accept it, and only
 * then becomes an inventory lot that can be committed against a request. That
 * keeps "someone said they might have pallets" apart from "there are pallets
 * we can allocate".
 */
export function createOffer(db: DB, input: OfferInput): { offerId: string; deduplicated: boolean } {
  const scope = 'offer';
  const existing = db
    .prepare('SELECT response_json FROM idempotency_keys WHERE key = ? AND scope = ?')
    .get(input.idempotencyKey, scope) as { response_json: string } | undefined;
  if (existing) {
    return { ...(JSON.parse(existing.response_json) as { offerId: string }), deduplicated: true };
  }

  return transact(db, (tx) => {
    const offerId = id('ofr');
    const now = nowIso();
    tx.prepare(
      `INSERT INTO offers (
         id, organization_id, contact_name, contact_method, contact_value,
         category_id, qty, unit, general_location, available_from, available_until,
         handover, storage_note, expiry_note, status, created_at
       ) VALUES (@id, @orgId, @contactName, @contactMethod, @contactValue,
                 @categoryId, @qty, @unit, @location, @from, @until,
                 @handover, @storageNote, @expiryNote, 'pending_review', @now)`,
    ).run({
      id: offerId,
      orgId: input.organizationId ?? null,
      contactName: input.contactName ?? null,
      contactMethod: input.contactMethod ?? null,
      contactValue: input.contactValue ?? null,
      categoryId: input.categoryId,
      qty: input.qty,
      unit: unitFor(input.categoryId),
      location: input.generalLocation,
      from: input.availableFrom ?? null,
      until: input.availableUntil ?? null,
      handover: input.handover,
      storageNote: input.storageNote ?? null,
      expiryNote: input.expiryNote ?? null,
      now,
    });
    tx.prepare(
      'INSERT INTO idempotency_keys (key, scope, response_json, created_at) VALUES (?, ?, ?, ?)',
    ).run(input.idempotencyKey, scope, JSON.stringify({ offerId }), now);
    return { offerId, deduplicated: false };
  });
}

export function listOffers(db: DB, status = 'pending_review') {
  return db
    .prepare(
      `SELECT o.*, org.name AS org_name FROM offers o
         LEFT JOIN organizations org ON org.id = o.organization_id
        WHERE o.status = ? ORDER BY o.created_at DESC`,
    )
    .all(status) as Array<{
    id: string;
    org_name: string | null;
    contact_name: string | null;
    category_id: string;
    qty: number;
    unit: string;
    general_location: string;
    available_from: string | null;
    available_until: string | null;
    handover: string;
    storage_note: string | null;
    expiry_note: string | null;
    status: string;
    created_at: string;
  }>;
}

/** A coordinator accepts an offer, turning it into allocatable stock. */
export function acceptOffer(
  db: DB,
  input: { offerId: string; organizationId: string; facilityId?: string | null },
): { inventoryLotId: string } {
  return transact(db, (tx) => {
    const offer = tx.prepare('SELECT * FROM offers WHERE id = ?').get(input.offerId) as
      | {
          id: string;
          category_id: string;
          qty: number;
          unit: string;
          general_location: string;
          available_from: string | null;
          available_until: string | null;
          handover: string;
          storage_note: string | null;
          expiry_note: string | null;
          status: string;
        }
      | undefined;
    if (!offer) throw new Error('No such offer.');
    if (offer.status !== 'pending_review') throw new Error('That offer has already been decided.');

    const lotId = id('lot');
    const now = nowIso();
    tx.prepare(
      `INSERT INTO inventory_lots (
         id, organization_id, category_id, facility_id, general_location, unit,
         qty_total, qty_committed, available_from, available_until, expiry_note,
         storage_note, handover, created_at, updated_at
       ) VALUES (@id, @orgId, @categoryId, @facilityId, @location, @unit,
                 @qty, 0, @from, @until, @expiryNote, @storageNote, @handover, @now, @now)`,
    ).run({
      id: lotId,
      orgId: input.organizationId,
      categoryId: offer.category_id,
      facilityId: input.facilityId ?? null,
      location: offer.general_location,
      unit: offer.unit,
      qty: offer.qty,
      from: offer.available_from,
      until: offer.available_until,
      expiryNote: offer.expiry_note,
      storageNote: offer.storage_note,
      handover: offer.handover,
      now,
    });
    tx.prepare(`UPDATE offers SET status = 'accepted', inventory_lot_id = ? WHERE id = ?`).run(
      lotId,
      input.offerId,
    );
    return { inventoryLotId: lotId };
  });
}

export function declineOffer(db: DB, offerId: string): void {
  db.prepare(`UPDATE offers SET status = 'declined' WHERE id = ? AND status = 'pending_review'`).run(
    offerId,
  );
}
