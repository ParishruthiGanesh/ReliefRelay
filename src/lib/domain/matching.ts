import type { DB } from '@/lib/db';
import { categoryLabel } from '@/lib/util/units';
import { distanceKm } from '@/lib/util/time';
import { listInventory, type LotView } from './inventory';
import { getAllocations, type RequestRow } from './requests';

/**
 * Proposed matches between outstanding need and recorded stock.
 *
 * This proposes; a coordinator decides. Every suggestion carries the reasons
 * behind it in plain words, so the coordinator is approving an argument rather
 * than a number from a black box.
 *
 * It is deliberately deterministic rather than model-generated: the ranking has
 * to be explainable and identical every time a coordinator reloads the page. A
 * language model can be given these same facts to phrase a summary, but it
 * never decides an allocation and never writes one.
 */

export interface MatchSuggestion {
  requestItemId: string;
  categoryId: string;
  categoryLabel: string;
  unit: string;
  outstandingQty: number;
  lotId: string;
  organizationName: string;
  lotLocation: string;
  availableQty: number;
  /** What this lot could cover of the outstanding amount. */
  suggestedQty: number;
  distanceKm: number | null;
  reasons: string[];
  cautions: string[];
}

export function suggestMatches(
  db: DB,
  request: RequestRow,
  limitPerItem = 3,
): MatchSuggestion[] {
  const allocations = getAllocations(db, request.id);
  const inventory = listInventory(db);
  const facilities = db
    .prepare('SELECT id, lat, lng FROM facilities')
    .all() as Array<{ id: string; lat: number; lng: number }>;

  const suggestions: MatchSuggestion[] = [];

  for (const allocation of allocations) {
    // An unknown requested quantity cannot be matched: there is no number to
    // cover. The dashboard shows this as an action for a human instead.
    if (allocation.outstandingQty === null || allocation.outstandingQty <= 0) continue;

    const candidates = inventory
      .filter((lot) => lot.categoryId === allocation.categoryId && lot.qtyAvailable > 0)
      .map((lot) => {
        const lotFacility = facilities.find((f) => f.id === lot.facilityId);
        const km =
          lotFacility && request.resolved_lat !== null && request.resolved_lng !== null
            ? Math.round(
                distanceKm(request.resolved_lat, request.resolved_lng, lotFacility.lat, lotFacility.lng) * 10,
              ) / 10
            : null;
        return { lot, km };
      })
      .sort((a, b) => {
        // Prefer a lot that can cover the whole outstanding amount, then
        // proximity, then the larger lot.
        const aCovers = a.lot.qtyAvailable >= allocation.outstandingQty! ? 1 : 0;
        const bCovers = b.lot.qtyAvailable >= allocation.outstandingQty! ? 1 : 0;
        if (aCovers !== bCovers) return bCovers - aCovers;
        if (a.km !== null && b.km !== null && a.km !== b.km) return a.km - b.km;
        return b.lot.qtyAvailable - a.lot.qtyAvailable;
      })
      .slice(0, limitPerItem);

    for (const { lot, km } of candidates) {
      suggestions.push({
        requestItemId: allocation.itemId,
        categoryId: allocation.categoryId,
        categoryLabel: categoryLabel(allocation.categoryId),
        unit: allocation.unit,
        outstandingQty: allocation.outstandingQty,
        lotId: lot.id,
        organizationName: lot.organizationName,
        lotLocation: lot.generalLocation,
        availableQty: lot.qtyAvailable,
        suggestedQty: Math.min(lot.qtyAvailable, allocation.outstandingQty),
        distanceKm: km,
        reasons: buildReasons(allocation.outstandingQty, allocation.unit, lot, km),
        cautions: buildCautions(lot),
      });
    }
  }

  return suggestions;
}

function buildReasons(
  outstanding: number,
  unit: string,
  lot: LotView,
  km: number | null,
): string[] {
  const reasons: string[] = [];
  reasons.push(
    lot.qtyAvailable >= outstanding
      ? `${lot.organizationName} has ${lot.qtyAvailable} ${unit} uncommitted, enough to cover the whole outstanding ${outstanding} ${unit}.`
      : `${lot.organizationName} has ${lot.qtyAvailable} ${unit} uncommitted, which would cover part of the outstanding ${outstanding} ${unit}.`,
  );
  if (km !== null) {
    reasons.push(`The stock is about ${km} km from the request location.`);
  } else {
    reasons.push('The stock is not tied to a mapped facility, so distance is unknown.');
  }
  if (lot.handover === 'delivery') reasons.push('This organisation can deliver.');
  if (lot.handover === 'collection') reasons.push('Collection only — a delivery team would be needed.');
  return reasons;
}

function buildCautions(lot: LotView): string[] {
  const cautions: string[] = [];
  if (lot.expiryNote) cautions.push(`Expiry: ${lot.expiryNote}`);
  if (lot.storageNote) cautions.push(`Storage: ${lot.storageNote}`);
  if (lot.availableUntil) cautions.push(`Available only until ${lot.availableUntil}.`);
  return cautions;
}

/**
 * A plain-language situation summary built from counted records.
 *
 * Every sentence here is a figure from the database. There is no estimate of
 * anything the database cannot evidence.
 */
export function situationSummary(db: DB): { lines: string[]; generatedBy: string } {
  const open = db
    .prepare(
      `SELECT COUNT(*) AS n FROM requests
        WHERE intent = 'need' AND status NOT IN ('fulfilled','cancelled')`,
    )
    .get() as { n: number };
  const unreviewed = db
    .prepare(
      `SELECT COUNT(*) AS n FROM requests WHERE intent = 'need' AND reviewed_at IS NULL`,
    )
    .get() as { n: number };
  const missing = db
    .prepare(`SELECT COUNT(*) AS n FROM requests WHERE missing_fields != '[]'`)
    .get() as { n: number };
  const danger = db
    .prepare(
      `SELECT COUNT(*) AS n FROM requests WHERE danger_reported = 1 AND status NOT IN ('fulfilled','cancelled')`,
    )
    .get() as { n: number };
  const shortfalls = db
    .prepare('SELECT COUNT(*) AS n FROM receipts WHERE is_shortfall = 1')
    .get() as { n: number };
  const staleFacilities = db
    .prepare(
      `SELECT COUNT(*) AS n FROM facilities f
        WHERE (SELECT MAX(created_at) FROM facility_updates WHERE facility_id = f.id) < datetime('now','-8 hours')
           OR (SELECT MAX(created_at) FROM facility_updates WHERE facility_id = f.id) IS NULL`,
    )
    .get() as { n: number };

  const lines = [
    `${open.n} ${open.n === 1 ? 'request is' : 'requests are'} open; ${unreviewed.n} ${unreviewed.n === 1 ? 'has' : 'have'} not been reviewed yet.`,
    `${missing.n} ${missing.n === 1 ? 'request is' : 'requests are'} missing essential information a coordinator needs before allocating.`,
    danger.n > 0
      ? `${danger.n} open ${danger.n === 1 ? 'request reports' : 'requests report'} immediate danger and need escalating to the responders you work with. ReliefRelay has not notified anyone.`
      : 'No open request reports immediate danger.',
    shortfalls.n > 0
      ? `${shortfalls.n} ${shortfalls.n === 1 ? 'delivery has' : 'deliveries have'} been confirmed short, so the difference is unmet again.`
      : 'No delivery has been confirmed short.',
    staleFacilities.n > 0
      ? `${staleFacilities.n} ${staleFacilities.n === 1 ? 'facility figure is' : 'facility figures are'} more than eight hours old and should be re-confirmed before anyone is sent there.`
      : 'Every facility figure has been confirmed within the last eight hours.',
  ];

  return {
    lines,
    generatedBy:
      'Counted directly from this database. No model wrote these figures, and nothing here is estimated.',
  };
}
