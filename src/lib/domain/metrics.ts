import type { DB } from '@/lib/db';
import { ageMinutes, minutesBetween } from '@/lib/util/time';
import { CATEGORY_IDS, unitLabelFor } from '@/lib/util/units';
import { getAllocations } from './requests';

/**
 * Operational metrics.
 *
 * Only things the database can actually evidence. There are deliberately no
 * figures here for lives saved, carbon avoided, beneficiaries verified or any
 * other real-world outcome: this prototype has no way to know them, and
 * inventing them would make every honest number next to them worthless.
 */

export interface DurationStat {
  label: string;
  /** null when nothing has reached this stage yet. */
  medianMinutes: number | null;
  meanMinutes: number | null;
  count: number;
  note: string;
}

export interface CategoryTotals {
  categoryId: string;
  unitLabel: string;
  requested: number;
  requestedUnknownItems: number;
  committed: number;
  received: number;
  outstanding: number;
  shortfall: number;
}

export interface MetricsSnapshot {
  generatedAt: string;
  requestCounts: Record<string, number>;
  timeToReview: DurationStat;
  timeToFirstAllocation: DurationStat;
  categoryTotals: CategoryTotals[];
  delivery: {
    commitmentsTotal: number;
    commitmentsCancelled: number;
    commitmentsReassigned: number;
    dispatches: number;
    receiptsConfirmed: number;
    deliveriesShort: number;
    deliveriesFailed: number;
    /** Settled commitments that delivered in full, over all settled ones. */
    completionRatePercent: number | null;
    completionRateNote: string;
  };
  facilityUpdateAges: Array<{ facilityId: string; name: string; ageMinutes: number | null }>;
  requestsMissingInformation: number;
  isFictionalData: boolean;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return Math.round(value * 10) / 10;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
}

export function metricsSnapshot(db: DB): MetricsSnapshot {
  const statusRows = db
    .prepare('SELECT status, COUNT(*) AS n FROM requests GROUP BY status')
    .all() as Array<{ status: string; n: number }>;
  const requestCounts = Object.fromEntries(statusRows.map((r) => [r.status, r.n]));

  const reviewRows = db
    .prepare('SELECT created_at, reviewed_at FROM requests WHERE reviewed_at IS NOT NULL')
    .all() as Array<{ created_at: string; reviewed_at: string }>;
  const reviewMinutes = reviewRows.map((r) => minutesBetween(r.created_at, r.reviewed_at));

  const allocationRows = db
    .prepare('SELECT created_at, first_allocated_at FROM requests WHERE first_allocated_at IS NOT NULL')
    .all() as Array<{ created_at: string; first_allocated_at: string }>;
  const allocationMinutes = allocationRows.map((r) =>
    minutesBetween(r.created_at, r.first_allocated_at),
  );

  // Category totals are built from the same allocation function the dashboard
  // uses, so a number here can never disagree with a number on a request.
  const requestIds = db.prepare('SELECT id FROM requests').all() as Array<{ id: string }>;
  const totals = new Map<string, CategoryTotals>();
  for (const categoryId of CATEGORY_IDS) {
    totals.set(categoryId, {
      categoryId,
      unitLabel: unitLabelFor(categoryId),
      requested: 0,
      requestedUnknownItems: 0,
      committed: 0,
      received: 0,
      outstanding: 0,
      shortfall: 0,
    });
  }
  for (const { id: requestId } of requestIds) {
    for (const allocation of getAllocations(db, requestId)) {
      const entry = totals.get(allocation.categoryId);
      if (!entry) continue;
      if (allocation.requestedQty === null) entry.requestedUnknownItems += 1;
      else entry.requested += allocation.requestedQty;
      entry.committed += allocation.openCommittedQty;
      entry.received += allocation.receivedQty;
      entry.outstanding += allocation.outstandingQty ?? 0;
      entry.shortfall += allocation.shortfallQty;
    }
  }

  const commitmentCounts = db
    .prepare('SELECT status, COUNT(*) AS n FROM commitments GROUP BY status')
    .all() as Array<{ status: string; n: number }>;
  const byStatus = Object.fromEntries(commitmentCounts.map((r) => [r.status, r.n]));
  const commitmentsTotal = commitmentCounts.reduce((sum, r) => sum + r.n, 0);

  const reassigned = db
    .prepare(`SELECT COUNT(*) AS n FROM assignments WHERE status = 'reassigned'`)
    .get() as { n: number };
  const dispatches = db.prepare('SELECT COUNT(*) AS n FROM dispatches').get() as { n: number };
  const receipts = db.prepare('SELECT COUNT(*) AS n FROM receipts').get() as { n: number };
  const short = db
    .prepare('SELECT COUNT(*) AS n FROM receipts WHERE is_shortfall = 1')
    .get() as { n: number };
  const failed = db
    .prepare('SELECT COUNT(*) AS n FROM receipts WHERE is_failure = 1')
    .get() as { n: number };

  const settled = (byStatus.received ?? 0) + (byStatus.partially_received ?? 0) + (byStatus.disputed ?? 0);
  const completionRatePercent =
    settled > 0 ? Math.round(((byStatus.received ?? 0) / settled) * 1000) / 10 : null;

  const facilityAges = (
    db
      .prepare(
        `SELECT f.id, f.name,
                (SELECT MAX(created_at) FROM facility_updates WHERE facility_id = f.id) AS last_update
           FROM facilities f ORDER BY f.name`,
      )
      .all() as Array<{ id: string; name: string; last_update: string | null }>
  ).map((row) => ({
    facilityId: row.id,
    name: row.name,
    ageMinutes: row.last_update ? Math.round(ageMinutes(row.last_update)) : null,
  }));

  const missing = db
    .prepare(`SELECT COUNT(*) AS n FROM requests WHERE missing_fields != '[]'`)
    .get() as { n: number };

  return {
    generatedAt: new Date().toISOString(),
    requestCounts,
    timeToReview: {
      label: 'Submission to coordinator review',
      medianMinutes: median(reviewMinutes),
      meanMinutes: mean(reviewMinutes),
      count: reviewMinutes.length,
      note: 'Measured from the server acknowledging a request to the first coordinator action on it. Requests never reviewed are excluded rather than counted as zero.',
    },
    timeToFirstAllocation: {
      label: 'Submission to first allocation',
      medianMinutes: median(allocationMinutes),
      meanMinutes: mean(allocationMinutes),
      count: allocationMinutes.length,
      note: 'Measured to the first commitment of stock. A commitment is a promise, not a delivery.',
    },
    categoryTotals: [...totals.values()],
    delivery: {
      commitmentsTotal,
      commitmentsCancelled: byStatus.cancelled ?? 0,
      commitmentsReassigned: reassigned.n,
      dispatches: dispatches.n,
      receiptsConfirmed: receipts.n,
      deliveriesShort: short.n,
      deliveriesFailed: failed.n,
      completionRatePercent,
      completionRateNote:
        'Share of settled commitments where the confirmed receipt matched the promised quantity in full. Open commitments are excluded; a short delivery counts against the rate.',
    },
    facilityUpdateAges: facilityAges,
    requestsMissingInformation: missing.n,
    isFictionalData: true,
  };
}

/**
 * Prioritisation factors, shown and adjustable rather than hidden in a score.
 *
 * Note what is absent and must stay absent: nothing about how well someone
 * writes or speaks, which language they used, what device they have, or
 * whether they could produce identification. None of those indicate need.
 */
export interface PriorityWeights {
  ageMinutes: number;
  unmetQuantity: number;
  reportedUrgency: number;
  dangerReported: number;
  shelterCapacityPressure: number;
  underAdvisory: number;
}

export const DEFAULT_PRIORITY_WEIGHTS: PriorityWeights = {
  ageMinutes: 1,
  unmetQuantity: 1,
  reportedUrgency: 1,
  dangerReported: 2,
  shelterCapacityPressure: 1,
  underAdvisory: 1,
};

export const PRIORITY_FACTOR_LABELS: Record<keyof PriorityWeights, string> = {
  ageMinutes: 'How long the request has been waiting',
  unmetQuantity: 'How much of the request is still unmet',
  reportedUrgency: 'Urgency as the person reported it',
  dangerReported: 'Immediate danger was reported',
  shelterCapacityPressure: 'The shelter is full or nearly full',
  underAdvisory: 'The location falls inside an active advisory area',
};

export interface PriorityInput {
  ageMinutes: number;
  outstandingShare: number;
  reportedUrgency: string | null;
  dangerReported: boolean;
  shelterNearlyFull: boolean;
  underAdvisory: boolean;
}

/** A transparent weighted sum. Every term is shown to the coordinator. */
export function priorityScore(
  input: PriorityInput,
  weights: PriorityWeights = DEFAULT_PRIORITY_WEIGHTS,
): { score: number; terms: Array<{ factor: string; contribution: number }> } {
  const urgencyValue =
    input.reportedUrgency === 'critical'
      ? 1
      : input.reportedUrgency === 'high'
        ? 0.7
        : input.reportedUrgency === 'normal'
          ? 0.3
          : 0;

  const raw: Array<[keyof PriorityWeights, number]> = [
    ['ageMinutes', Math.min(1, input.ageMinutes / 240)],
    ['unmetQuantity', Math.max(0, Math.min(1, input.outstandingShare))],
    ['reportedUrgency', urgencyValue],
    ['dangerReported', input.dangerReported ? 1 : 0],
    ['shelterCapacityPressure', input.shelterNearlyFull ? 1 : 0],
    ['underAdvisory', input.underAdvisory ? 1 : 0],
  ];

  const terms = raw.map(([factor, value]) => ({
    factor: PRIORITY_FACTOR_LABELS[factor],
    contribution: Math.round(value * weights[factor] * 100) / 100,
  }));
  const score = Math.round(terms.reduce((sum, t) => sum + t.contribution, 0) * 100) / 100;
  return { score, terms };
}
