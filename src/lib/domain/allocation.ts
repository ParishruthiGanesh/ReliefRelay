/**
 * Allocation arithmetic.
 *
 * This file is pure: no database, no I/O, so the rules below can be tested
 * directly. Everything that changes stock or status goes through these
 * functions so there is one definition of "outstanding need".
 *
 * The four records are kept apart on purpose:
 *
 *   stock       what an organisation says it has          (inventory_lots)
 *   commitment  what it has promised to one request item  (commitments)
 *   dispatch    what has physically left                  (dispatches)
 *   receipt     what the recipient confirms arrived       (receipts)
 *
 * A commitment is not a delivery. Only a confirmed receipt reduces need
 * permanently; an open commitment covers need provisionally and that cover
 * disappears the moment the commitment is cancelled or settles short.
 *
 * Worked example from the brief:
 *   requested 100 packs
 *   A commits 60            -> open 60, received 0,  outstanding 40
 *   B commits 40            -> open 100, received 0, outstanding 0
 *   A dispatches 60         -> open 100, received 0, outstanding 0
 *   A's receipt confirms 50 -> A settles (partially_received, shortfall 10)
 *                              open 40 (B), received 50, outstanding 10
 */

export type CommitmentStatus =
  | 'committed'
  | 'dispatched'
  | 'received'
  | 'partially_received'
  | 'cancelled'
  | 'disputed';

/** Statuses where the commitment still provisionally covers the need. */
export const OPEN_COMMITMENT_STATUSES: CommitmentStatus[] = ['committed', 'dispatched'];

/** Statuses where the commitment has settled; only its receipts count. */
export const SETTLED_COMMITMENT_STATUSES: CommitmentStatus[] = [
  'received',
  'partially_received',
  'disputed',
];

export function isOpenCommitment(status: CommitmentStatus): boolean {
  return OPEN_COMMITMENT_STATUSES.includes(status);
}

export interface CommitmentFacts {
  id: string;
  organizationId: string;
  qty: number;
  status: CommitmentStatus;
  /** Sum of confirmed receipts against this commitment. */
  receivedQty: number;
  dispatchedQty: number;
}

export interface ItemFacts {
  itemId: string;
  categoryId: string;
  unit: string;
  /** null means "needed, amount not yet known". It must stay null. */
  requestedQty: number | null;
  requestedUncertain: boolean;
  commitments: CommitmentFacts[];
}

export interface ItemAllocation {
  itemId: string;
  categoryId: string;
  unit: string;
  requestedQty: number | null;
  requestedUncertain: boolean;
  /** Promised and not yet settled. Provisional cover. */
  openCommittedQty: number;
  /** Confirmed as actually arrived. Permanent cover. */
  receivedQty: number;
  /** Left on the road: dispatched but no receipt yet. */
  inTransitQty: number;
  /** Promised then settled short or disputed. The visible discrepancy. */
  shortfallQty: number;
  cancelledQty: number;
  /** null when the requested amount is unknown — we do not guess. */
  outstandingQty: number | null;
  /** True when a quantity cannot be computed and a human must confirm it. */
  needsQuantityConfirmation: boolean;
  hasDiscrepancy: boolean;
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Rounds away float noise from repeated additions of fractional litres. */
function tidy(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function computeItemAllocation(item: ItemFacts): ItemAllocation {
  const open = item.commitments.filter((c) => isOpenCommitment(c.status));
  const settled = item.commitments.filter((c) =>
    SETTLED_COMMITMENT_STATUSES.includes(c.status),
  );
  const cancelled = item.commitments.filter((c) => c.status === 'cancelled');

  const openCommittedQty = tidy(sum(open.map((c) => c.qty)));
  // Receipts count wherever they came from, including a receipt logged against
  // a commitment that is still open (a partial delivery mid-flight).
  const receivedQty = tidy(sum(item.commitments.map((c) => c.receivedQty)));
  const inTransitQty = tidy(
    sum(open.map((c) => Math.max(0, c.dispatchedQty - c.receivedQty))),
  );
  // A settled commitment that delivered less than promised leaves a shortfall.
  const shortfallQty = tidy(
    sum(settled.map((c) => Math.max(0, c.qty - c.receivedQty))),
  );
  const cancelledQty = tidy(sum(cancelled.map((c) => c.qty)));

  // Open commitments can themselves have logged partial receipts; counting both
  // in full would double-count, so an open commitment only covers the part of
  // its promise that has not already been confirmed as received.
  const openRemainingCover = tidy(
    sum(open.map((c) => Math.max(0, c.qty - c.receivedQty))),
  );

  const outstandingQty =
    item.requestedQty === null
      ? null
      : tidy(Math.max(0, item.requestedQty - openRemainingCover - receivedQty));

  return {
    itemId: item.itemId,
    categoryId: item.categoryId,
    unit: item.unit,
    requestedQty: item.requestedQty,
    requestedUncertain: item.requestedUncertain,
    openCommittedQty,
    receivedQty,
    inTransitQty,
    shortfallQty,
    cancelledQty,
    outstandingQty,
    needsQuantityConfirmation: item.requestedQty === null || item.requestedUncertain,
    hasDiscrepancy: shortfallQty > 0,
  };
}

/**
 * How much more of this item may still be committed.
 * Unknown requested quantity => null: a coordinator must set a number first,
 * because committing against an unknown need cannot be checked for over-commit.
 */
export function allocatableQty(allocation: ItemAllocation): number | null {
  return allocation.outstandingQty;
}

// ─────────────────────────── request-level status ───────────────────────────

export type RequestStatus =
  | 'submitted'
  | 'under_review'
  | 'partially_allocated'
  | 'fully_allocated'
  | 'delivery_in_progress'
  | 'partially_received'
  | 'fulfilled'
  | 'cancelled'
  | 'disputed';

/** Statuses that exist only before the server has acknowledged a request. */
export type ClientOnlyRequestStatus = 'draft' | 'waiting_to_send';

/** The full set a user can see, including the two client-side ones. */
export type AnyRequestStatus = RequestStatus | ClientOnlyRequestStatus;

export interface StatusInputs {
  allocations: ItemAllocation[];
  reviewed: boolean;
  /** Set by a coordinator; these are terminal and never recomputed away. */
  manualStatus?: 'cancelled' | 'disputed' | null;
  anyDisputed: boolean;
}

/**
 * Derives a request's status from facts, never from intent. In particular a
 * request that has merely been submitted can never reach a status that implies
 * anyone is on the way.
 */
export function deriveRequestStatus(input: StatusInputs): RequestStatus {
  if (input.manualStatus === 'cancelled') return 'cancelled';
  if (input.manualStatus === 'disputed' || input.anyDisputed) return 'disputed';

  const allocations = input.allocations;
  if (allocations.length === 0) return input.reviewed ? 'under_review' : 'submitted';

  const anyCover = allocations.some((a) => a.openCommittedQty > 0 || a.receivedQty > 0);
  if (!anyCover) return input.reviewed ? 'under_review' : 'submitted';

  const anyReceived = allocations.some((a) => a.receivedQty > 0);
  const anyInTransit = allocations.some((a) => a.inTransitQty > 0);

  // Fulfilled needs every item to have a known requested amount that has been
  // confirmed as received. An unknown quantity can never be "fulfilled".
  const allFulfilled = allocations.every(
    (a) => a.requestedQty !== null && a.receivedQty >= a.requestedQty,
  );
  if (allFulfilled) return 'fulfilled';

  const anyOutstanding = allocations.some(
    (a) => a.outstandingQty === null || a.outstandingQty > 0,
  );

  if (anyReceived) {
    // Something arrived but the request is not complete.
    return anyOutstanding || !anyInTransit ? 'partially_received' : 'delivery_in_progress';
  }
  if (anyInTransit) return 'delivery_in_progress';
  return anyOutstanding ? 'partially_allocated' : 'fully_allocated';
}

export const REQUEST_STATUS_LABELS: Record<AnyRequestStatus, string> = {
  draft: 'Draft',
  waiting_to_send: 'Waiting to send',
  submitted: 'Submitted',
  under_review: 'Under coordinator review',
  partially_allocated: 'Partially allocated',
  fully_allocated: 'Fully allocated',
  delivery_in_progress: 'Delivery in progress',
  partially_received: 'Partially received',
  fulfilled: 'Fulfilled',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
};

/**
 * Plain-language explanation shown to the person who asked for help.
 *
 * "Help is coming" only ever appears when an assignment actually exists —
 * see `canSayHelpIsOnTheWay`. A submitted request says only that it was
 * received, because that is all that has happened.
 */
export function explainStatus(status: AnyRequestStatus, hasAssignment: boolean): string {
  switch (status) {
    case 'draft':
      return 'Saved on this device — not yet sent.';
    case 'waiting_to_send':
      return 'Saved on this device — not yet sent. It will be sent when you are back online.';
    case 'submitted':
      return 'Your request has reached the coordination team. A coordinator has not yet accepted it.';
    case 'under_review':
      return 'A coordinator is reviewing your request. No supplies have been assigned yet.';
    case 'partially_allocated':
      return 'Part of what you asked for has been promised by a relief organisation. The rest is still unmet.';
    case 'fully_allocated':
      return 'All of what you asked for has been promised. Nothing has been delivered yet.';
    case 'delivery_in_progress':
      return hasAssignment
        ? 'A delivery team has been assigned and supplies are on the way.'
        : 'A delivery has been recorded as dispatched.';
    case 'partially_received':
      return 'Some supplies have arrived and been confirmed. An outstanding amount remains.';
    case 'fulfilled':
      return 'All requested supplies have been confirmed as received.';
    case 'cancelled':
      return 'This request was cancelled.';
    case 'disputed':
      return 'There is a disagreement about what was delivered. A coordinator is looking into it.';
  }
}

/**
 * Gate for any "help is on the way" wording. Requires a real assignment,
 * not merely a submitted request or even a commitment.
 */
export function canSayHelpIsOnTheWay(
  status: RequestStatus,
  hasActiveAssignment: boolean,
): boolean {
  if (!hasActiveAssignment) return false;
  return status === 'delivery_in_progress' || status === 'partially_received';
}
