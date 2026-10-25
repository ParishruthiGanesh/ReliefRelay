import type { DB } from '@/lib/db';
import { transact } from '@/lib/db';
import { id, nowIso } from '@/lib/util/ids';
import { queueAttestation } from './attestations';
import {
  appendEvent,
  getAllocations,
  getRequestById,
  recomputeRequestStatus,
  type RequestItemRow,
} from './requests';

export class AllocationError extends Error {
  constructor(
    public code:
      | 'unknown_item'
      | 'unknown_lot'
      | 'category_mismatch'
      | 'unit_mismatch'
      | 'quantity_unconfirmed'
      | 'exceeds_outstanding'
      | 'insufficient_stock'
      | 'invalid_state'
      | 'request_closed',
    message: string,
    public detail: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AllocationError';
  }
}

export interface LotRow {
  id: string;
  organization_id: string;
  category_id: string;
  facility_id: string | null;
  general_location: string;
  unit: string;
  qty_total: number;
  qty_committed: number;
  available_from: string | null;
  available_until: string | null;
  expiry_note: string | null;
  storage_note: string | null;
  handover: string;
}

export function lotAvailable(lot: Pick<LotRow, 'qty_total' | 'qty_committed'>): number {
  return Math.round((lot.qty_total - lot.qty_committed) * 1000) / 1000;
}

/**
 * Reserves `qty` from a lot.
 *
 * The guard lives in the WHERE clause, so the check and the write are one
 * statement and cannot be split by another writer. Combined with the
 * BEGIN IMMEDIATE in `transact`, two coordinators allocating the same stock at
 * the same moment produce one success and one `insufficient_stock` — never two
 * successes totalling more than the lot holds.
 */
export function reserveStock(db: DB, lotId: string, qty: number): boolean {
  const result = db
    .prepare(
      `UPDATE inventory_lots
          SET qty_committed = qty_committed + @qty, updated_at = @now
        WHERE id = @id AND (qty_total - qty_committed) >= @qty`,
    )
    .run({ id: lotId, qty, now: nowIso() });
  return result.changes === 1;
}

/** Returns reserved-but-unused stock to the available pool. */
export function releaseStock(db: DB, lotId: string, qty: number): void {
  db.prepare(
    `UPDATE inventory_lots
        SET qty_committed = MAX(0, qty_committed - @qty), updated_at = @now
      WHERE id = @id`,
  ).run({ id: lotId, qty, now: nowIso() });
}

/** Removes stock that physically left and was confirmed received. */
function consumeStock(db: DB, lotId: string, qty: number): void {
  db.prepare(
    `UPDATE inventory_lots
        SET qty_total = MAX(0, qty_total - @qty), updated_at = @now
      WHERE id = @id`,
  ).run({ id: lotId, qty, now: nowIso() });
}

export interface CommitInput {
  requestItemId: string;
  inventoryLotId: string;
  qty: number;
  approvedBy: string;
}

export interface CommitResult {
  commitmentId: string;
  attestationId: string;
  outstandingAfter: number | null;
  requestStatus: string;
}

/**
 * A coordinator-approved commitment of recorded stock against one request item.
 * Runs entirely inside one immediate transaction: either the stock is reserved,
 * the commitment exists and the attestation is queued, or nothing happened.
 */
export function commitStock(db: DB, input: CommitInput): CommitResult {
  if (!(input.qty > 0)) {
    throw new AllocationError('invalid_state', 'Quantity must be greater than zero.');
  }

  return transact(db, (tx) => {
    const item = tx
      .prepare('SELECT * FROM request_items WHERE id = ?')
      .get(input.requestItemId) as RequestItemRow | undefined;
    if (!item) throw new AllocationError('unknown_item', 'No such request item.');

    const request = getRequestById(tx, item.request_id);
    if (!request) throw new AllocationError('unknown_item', 'No such request.');
    if (request.status === 'cancelled') {
      throw new AllocationError('request_closed', 'This request was cancelled.');
    }

    const lot = tx
      .prepare('SELECT * FROM inventory_lots WHERE id = ?')
      .get(input.inventoryLotId) as LotRow | undefined;
    if (!lot) throw new AllocationError('unknown_lot', 'No such inventory lot.');

    if (lot.category_id !== item.category_id) {
      throw new AllocationError(
        'category_mismatch',
        'That stock is a different resource category from the request.',
        { lotCategory: lot.category_id, itemCategory: item.category_id },
      );
    }
    // Units are never converted. Litres are not bottles; packs are not kits.
    if (lot.unit !== item.unit) {
      throw new AllocationError('unit_mismatch', 'The units do not match.', {
        lotUnit: lot.unit,
        itemUnit: item.unit,
      });
    }

    const allocations = getAllocations(tx, item.request_id);
    const allocation = allocations.find((a) => a.itemId === item.id);
    if (!allocation) throw new AllocationError('unknown_item', 'Allocation not found.');

    if (allocation.outstandingQty === null) {
      throw new AllocationError(
        'quantity_unconfirmed',
        'The requested quantity is not yet known. A coordinator must confirm a number before stock can be committed against it.',
        { categoryId: item.category_id },
      );
    }
    if (input.qty > allocation.outstandingQty) {
      throw new AllocationError(
        'exceeds_outstanding',
        `Only ${allocation.outstandingQty} ${item.unit} are still unmet for this item.`,
        { outstanding: allocation.outstandingQty, requested: input.qty },
      );
    }

    if (!reserveStock(tx, lot.id, input.qty)) {
      const current = tx
        .prepare('SELECT qty_total, qty_committed FROM inventory_lots WHERE id = ?')
        .get(lot.id) as Pick<LotRow, 'qty_total' | 'qty_committed'>;
      throw new AllocationError(
        'insufficient_stock',
        `That stock is no longer available. ${lotAvailable(current)} ${lot.unit} remain uncommitted.`,
        { available: lotAvailable(current), requested: input.qty },
      );
    }

    const commitmentId = id('cmt');
    const now = nowIso();
    tx.prepare(
      `INSERT INTO commitments (
         id, request_item_id, request_id, inventory_lot_id, organization_id,
         qty, unit, status, approved_by, created_at, updated_at
       ) VALUES (@id, @itemId, @requestId, @lotId, @orgId, @qty, @unit, 'committed', @approvedBy, @now, @now)`,
    ).run({
      id: commitmentId,
      itemId: item.id,
      requestId: item.request_id,
      lotId: lot.id,
      orgId: lot.organization_id,
      qty: input.qty,
      unit: item.unit,
      approvedBy: input.approvedBy,
      now,
    });

    const org = tx
      .prepare('SELECT chain_org_ref FROM organizations WHERE id = ?')
      .get(lot.organization_id) as { chain_org_ref: string };

    const { attestationId } = queueAttestation(tx, {
      eventType: 'commitment',
      chainOrgRef: org.chain_org_ref,
      requestId: item.request_id,
      commitmentId,
      categoryId: item.category_id,
      unit: item.unit,
      qty: input.qty,
      occurredAt: now,
    });

    if (!request.first_allocated_at) {
      tx.prepare('UPDATE requests SET first_allocated_at = ? WHERE id = ?').run(
        now,
        item.request_id,
      );
    }
    // Approving a commitment is itself an act of coordinator review, so the
    // request must not fall back to "submitted" if that commitment is later
    // cancelled. It also gives the time-to-review metric an honest timestamp.
    if (!request.reviewed_at) {
      tx.prepare(
        `UPDATE requests SET reviewed_at = @now, source_kind = 'coordinator_reviewed' WHERE id = @id`,
      ).run({ now, id: item.request_id });
    }

    appendEvent(tx, {
      requestId: item.request_id,
      kind: 'commitment_recorded',
      detail: {
        commitmentId,
        organizationId: lot.organization_id,
        categoryId: item.category_id,
        qty: input.qty,
        unit: item.unit,
      },
      actorKind: 'coordinator',
      actorUserId: input.approvedBy,
    });

    const requestStatus = recomputeRequestStatus(tx, item.request_id);
    const after = getAllocations(tx, item.request_id).find((a) => a.itemId === item.id);

    return {
      commitmentId,
      attestationId,
      outstandingAfter: after?.outstandingQty ?? null,
      requestStatus,
    };
  });
}

export interface CommitmentRow {
  id: string;
  request_item_id: string;
  request_id: string;
  inventory_lot_id: string;
  organization_id: string;
  qty: number;
  unit: string;
  status:
    | 'committed'
    | 'dispatched'
    | 'received'
    | 'partially_received'
    | 'cancelled'
    | 'disputed';
  cancel_reason: string | null;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

function loadCommitment(db: DB, commitmentId: string): CommitmentRow {
  const row = db.prepare('SELECT * FROM commitments WHERE id = ?').get(commitmentId) as
    | CommitmentRow
    | undefined;
  if (!row) throw new AllocationError('invalid_state', 'No such commitment.');
  return row;
}

function orgRef(db: DB, organizationId: string): string {
  const org = db
    .prepare('SELECT chain_org_ref FROM organizations WHERE id = ?')
    .get(organizationId) as { chain_org_ref: string } | undefined;
  if (!org) throw new AllocationError('invalid_state', 'No such organisation.');
  return org.chain_org_ref;
}

/** Cancelling a commitment releases the stock and reopens the need. */
export function cancelCommitment(
  db: DB,
  input: { commitmentId: string; reason: string; actorUserId: string },
): { requestStatus: string; outstandingAfter: number | null } {
  return transact(db, (tx) => {
    const commitment = loadCommitment(tx, input.commitmentId);
    if (!['committed', 'dispatched'].includes(commitment.status)) {
      throw new AllocationError(
        'invalid_state',
        `A commitment that is already ${commitment.status} cannot be cancelled.`,
      );
    }
    const now = nowIso();
    tx.prepare(
      `UPDATE commitments SET status = 'cancelled', cancel_reason = @reason, updated_at = @now WHERE id = @id`,
    ).run({ id: commitment.id, reason: input.reason, now });

    // The goods never left, so the stock goes back to available.
    releaseStock(tx, commitment.inventory_lot_id, commitment.qty);

    // Any volunteer carrying it is released too.
    tx.prepare(
      `UPDATE assignments SET status = 'withdrawn', updated_at = @now
        WHERE commitment_id = @id AND status IN ('offered','accepted')`,
    ).run({ id: commitment.id, now });

    const item = tx
      .prepare('SELECT * FROM request_items WHERE id = ?')
      .get(commitment.request_item_id) as RequestItemRow;

    queueAttestation(tx, {
      eventType: 'discrepancy',
      chainOrgRef: orgRef(tx, commitment.organization_id),
      requestId: commitment.request_id,
      commitmentId: commitment.id,
      categoryId: item.category_id,
      unit: commitment.unit,
      qty: 0,
      shortfallQty: commitment.qty,
      occurredAt: now,
    });

    appendEvent(tx, {
      requestId: commitment.request_id,
      kind: 'commitment_cancelled',
      detail: {
        commitmentId: commitment.id,
        qty: commitment.qty,
        unit: commitment.unit,
        reason: input.reason,
        reopenedQty: commitment.qty,
      },
      actorKind: 'coordinator',
      actorUserId: input.actorUserId,
    });

    const requestStatus = recomputeRequestStatus(tx, commitment.request_id);
    const after = getAllocations(tx, commitment.request_id).find(
      (a) => a.itemId === commitment.request_item_id,
    );
    return { requestStatus, outstandingAfter: after?.outstandingQty ?? null };
  });
}

export interface DispatchInput {
  commitmentId: string;
  qty: number;
  volunteerId?: string | null;
  instructions?: string | null;
  accessNote?: string | null;
  accessNoteSource?: string | null;
  actorUserId: string;
}

/**
 * Records that goods left. Note that this does not reduce outstanding need:
 * the commitment already covered it, and only a receipt settles it.
 */
export function recordDispatch(db: DB, input: DispatchInput): { requestStatus: string } {
  return transact(db, (tx) => {
    const commitment = loadCommitment(tx, input.commitmentId);
    if (commitment.status !== 'committed' && commitment.status !== 'dispatched') {
      throw new AllocationError(
        'invalid_state',
        `A commitment that is ${commitment.status} cannot be dispatched.`,
      );
    }
    const alreadyRow = tx
      .prepare('SELECT COALESCE(SUM(qty),0) AS q FROM dispatches WHERE commitment_id = ?')
      .get(commitment.id) as { q: number };
    if (alreadyRow.q + input.qty > commitment.qty) {
      throw new AllocationError(
        'exceeds_outstanding',
        `Only ${commitment.qty - alreadyRow.q} ${commitment.unit} of this commitment remain undispatched.`,
        { remaining: commitment.qty - alreadyRow.q },
      );
    }

    const now = nowIso();
    tx.prepare(
      `INSERT INTO dispatches (
         id, commitment_id, qty, unit, volunteer_id, instructions,
         access_note, access_note_source, access_note_at, created_at
       ) VALUES (@id, @commitmentId, @qty, @unit, @volunteerId, @instructions,
                 @accessNote, @accessNoteSource, @accessNoteAt, @now)`,
    ).run({
      id: id('dsp'),
      commitmentId: commitment.id,
      qty: input.qty,
      unit: commitment.unit,
      volunteerId: input.volunteerId ?? null,
      instructions: input.instructions ?? null,
      accessNote: input.accessNote ?? null,
      accessNoteSource: input.accessNoteSource ?? null,
      accessNoteAt: input.accessNote ? now : null,
      now,
    });

    tx.prepare(`UPDATE commitments SET status = 'dispatched', updated_at = @now WHERE id = @id`).run(
      { id: commitment.id, now },
    );

    const item = tx
      .prepare('SELECT * FROM request_items WHERE id = ?')
      .get(commitment.request_item_id) as RequestItemRow;

    queueAttestation(tx, {
      eventType: 'dispatch',
      chainOrgRef: orgRef(tx, commitment.organization_id),
      requestId: commitment.request_id,
      commitmentId: commitment.id,
      categoryId: item.category_id,
      unit: commitment.unit,
      qty: input.qty,
      occurredAt: now,
    });

    appendEvent(tx, {
      requestId: commitment.request_id,
      kind: 'dispatch_recorded',
      detail: { commitmentId: commitment.id, qty: input.qty, unit: commitment.unit },
      actorKind: 'coordinator',
      actorUserId: input.actorUserId,
    });

    return { requestStatus: recomputeRequestStatus(tx, commitment.request_id) };
  });
}

export interface ReceiptInput {
  commitmentId: string;
  qtyReceived: number;
  note?: string | null;
  confirmedByKind: 'recipient' | 'coordinator' | 'facility_rep';
  confirmedByUserId?: string | null;
}

export interface ReceiptResult {
  receiptId: string;
  commitmentStatus: CommitmentRow['status'];
  shortfallQty: number;
  outstandingAfter: number | null;
  requestStatus: string;
}

/**
 * The recipient confirms what actually arrived.
 *
 * This is where the worked example resolves: a 60-pack commitment confirmed at
 * 50 settles as `partially_received`, the 10 undelivered packs go back to the
 * lot, and the item's outstanding need rises from 0 to 10 with a visible
 * discrepancy. Nothing here is automatic on the model's say-so — a human
 * confirmed the number.
 */
export function recordReceipt(db: DB, input: ReceiptInput): ReceiptResult {
  if (input.qtyReceived < 0) {
    throw new AllocationError('invalid_state', 'A received quantity cannot be negative.');
  }
  return transact(db, (tx) => {
    const commitment = loadCommitment(tx, input.commitmentId);
    if (!['committed', 'dispatched'].includes(commitment.status)) {
      throw new AllocationError(
        'invalid_state',
        `A commitment that is already ${commitment.status} cannot take a new receipt.`,
      );
    }
    if (input.qtyReceived > commitment.qty) {
      throw new AllocationError(
        'exceeds_outstanding',
        `More cannot be received than was committed (${commitment.qty} ${commitment.unit}).`,
        { committed: commitment.qty },
      );
    }

    const now = nowIso();
    const shortfall = Math.round((commitment.qty - input.qtyReceived) * 1000) / 1000;
    const receiptId = id('rcp');

    tx.prepare(
      `INSERT INTO receipts (
         id, commitment_id, request_item_id, qty_received, unit,
         confirmed_by_kind, confirmed_by_user_id, note, is_shortfall, is_failure, created_at
       ) VALUES (@id, @commitmentId, @itemId, @qty, @unit, @byKind, @byUser, @note, @shortfall, @failure, @now)`,
    ).run({
      id: receiptId,
      commitmentId: commitment.id,
      itemId: commitment.request_item_id,
      qty: input.qtyReceived,
      unit: commitment.unit,
      byKind: input.confirmedByKind,
      byUser: input.confirmedByUserId ?? null,
      note: input.note ?? null,
      shortfall: shortfall > 0 ? 1 : 0,
      failure: input.qtyReceived === 0 ? 1 : 0,
      now,
    });

    const status: CommitmentRow['status'] = shortfall > 0 ? 'partially_received' : 'received';
    tx.prepare('UPDATE commitments SET status = @status, updated_at = @now WHERE id = @id').run({
      id: commitment.id,
      status,
      now,
    });

    // Stock settles: what arrived leaves the lot for good; what never left goes
    // back to the available pool so it can be allocated again.
    if (input.qtyReceived > 0) consumeStock(tx, commitment.inventory_lot_id, input.qtyReceived);
    releaseStock(tx, commitment.inventory_lot_id, commitment.qty);

    tx.prepare(
      `UPDATE assignments SET status = 'completed', updated_at = @now
        WHERE commitment_id = @id AND status IN ('offered','accepted')`,
    ).run({ id: commitment.id, now });

    const item = tx
      .prepare('SELECT * FROM request_items WHERE id = ?')
      .get(commitment.request_item_id) as RequestItemRow;
    const ref = orgRef(tx, commitment.organization_id);

    queueAttestation(tx, {
      eventType: 'receipt',
      chainOrgRef: ref,
      requestId: commitment.request_id,
      commitmentId: commitment.id,
      categoryId: item.category_id,
      unit: commitment.unit,
      qty: input.qtyReceived,
      occurredAt: now,
    });

    if (shortfall > 0) {
      // A correction is appended, never a rewrite of the earlier record.
      queueAttestation(tx, {
        eventType: 'discrepancy',
        chainOrgRef: ref,
        requestId: commitment.request_id,
        commitmentId: commitment.id,
        categoryId: item.category_id,
        unit: commitment.unit,
        qty: input.qtyReceived,
        shortfallQty: shortfall,
        occurredAt: now,
      });
    }

    appendEvent(tx, {
      requestId: commitment.request_id,
      kind: input.qtyReceived === 0 ? 'delivery_failed' : 'receipt_confirmed',
      detail: {
        commitmentId: commitment.id,
        committedQty: commitment.qty,
        receivedQty: input.qtyReceived,
        shortfallQty: shortfall,
        unit: commitment.unit,
        note: input.note ?? null,
      },
      actorKind: input.confirmedByKind === 'recipient' ? 'public' : input.confirmedByKind,
      actorUserId: input.confirmedByUserId ?? null,
    });

    const requestStatus = recomputeRequestStatus(tx, commitment.request_id);
    const after = getAllocations(tx, commitment.request_id).find(
      (a) => a.itemId === commitment.request_item_id,
    );

    return {
      receiptId,
      commitmentStatus: status,
      shortfallQty: shortfall,
      outstandingAfter: after?.outstandingQty ?? null,
      requestStatus,
    };
  });
}

export function disputeCommitment(
  db: DB,
  input: { commitmentId: string; reason: string; actorUserId: string },
): void {
  transact(db, (tx) => {
    const commitment = loadCommitment(tx, input.commitmentId);
    tx.prepare(
      `UPDATE commitments SET status = 'disputed', cancel_reason = @reason, updated_at = @now WHERE id = @id`,
    ).run({ id: commitment.id, reason: input.reason, now: nowIso() });
    appendEvent(tx, {
      requestId: commitment.request_id,
      kind: 'commitment_disputed',
      detail: { commitmentId: commitment.id, reason: input.reason },
      actorKind: 'coordinator',
      actorUserId: input.actorUserId,
    });
    recomputeRequestStatus(tx, commitment.request_id);
  });
}

// ───────────────────────────── assignments ─────────────────────────────────

export function createAssignment(
  db: DB,
  input: { commitmentId: string; volunteerId: string; instructions?: string; assignedBy: string },
): { assignmentId: string } {
  return transact(db, (tx) => {
    const commitment = loadCommitment(tx, input.commitmentId);
    if (!['committed', 'dispatched'].includes(commitment.status)) {
      throw new AllocationError(
        'invalid_state',
        'Only an open commitment can be assigned to a delivery team.',
      );
    }
    const volunteer = tx
      .prepare(`SELECT id, is_approved, role FROM users WHERE id = ?`)
      .get(input.volunteerId) as { id: string; is_approved: number; role: string } | undefined;
    if (!volunteer || volunteer.role !== 'volunteer' || volunteer.is_approved !== 1) {
      throw new AllocationError(
        'invalid_state',
        'Deliveries can only be assigned to an approved volunteer.',
      );
    }

    // Reassignment: stand down whoever currently holds it.
    const previous = tx
      .prepare(
        `SELECT id FROM assignments WHERE commitment_id = ? AND status IN ('offered','accepted')`,
      )
      .all(input.commitmentId) as Array<{ id: string }>;
    const now = nowIso();
    for (const prev of previous) {
      tx.prepare(`UPDATE assignments SET status = 'reassigned', updated_at = ? WHERE id = ?`).run(
        now,
        prev.id,
      );
    }

    const assignmentId = id('asg');
    tx.prepare(
      `INSERT INTO assignments (id, commitment_id, volunteer_id, status, assigned_by, instructions, created_at, updated_at)
       VALUES (@id, @commitmentId, @volunteerId, 'offered', @assignedBy, @instructions, @now, @now)`,
    ).run({
      id: assignmentId,
      commitmentId: input.commitmentId,
      volunteerId: input.volunteerId,
      assignedBy: input.assignedBy,
      instructions: input.instructions ?? null,
      now,
    });

    appendEvent(tx, {
      requestId: commitment.request_id,
      kind: previous.length > 0 ? 'delivery_reassigned' : 'delivery_assigned',
      detail: { commitmentId: input.commitmentId, volunteerId: input.volunteerId },
      actorKind: 'coordinator',
      actorUserId: input.assignedBy,
    });
    return { assignmentId };
  });
}

export function updateAssignment(
  db: DB,
  input: { assignmentId: string; volunteerId: string; status: 'accepted' | 'withdrawn' | 'completed' },
): void {
  transact(db, (tx) => {
    const row = tx
      .prepare('SELECT * FROM assignments WHERE id = ?')
      .get(input.assignmentId) as
      | { id: string; commitment_id: string; volunteer_id: string; status: string }
      | undefined;
    if (!row) throw new AllocationError('invalid_state', 'No such assignment.');
    // A volunteer may only act on their own assignment.
    if (row.volunteer_id !== input.volunteerId) {
      throw new AllocationError('invalid_state', 'That assignment belongs to someone else.');
    }
    tx.prepare('UPDATE assignments SET status = ?, updated_at = ? WHERE id = ?').run(
      input.status,
      nowIso(),
      input.assignmentId,
    );
    const commitment = loadCommitment(tx, row.commitment_id);
    appendEvent(tx, {
      requestId: commitment.request_id,
      kind: `assignment_${input.status}`,
      detail: { assignmentId: input.assignmentId },
      actorKind: 'volunteer',
      actorUserId: input.volunteerId,
    });
    recomputeRequestStatus(tx, commitment.request_id);
  });
}
