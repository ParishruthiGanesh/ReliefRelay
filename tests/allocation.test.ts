import { describe, expect, it } from 'vitest';
import {
  canSayHelpIsOnTheWay,
  computeItemAllocation,
  deriveRequestStatus,
  type ItemFacts,
} from '@/lib/domain/allocation';
import {
  cancelCommitment,
  commitStock,
  recordDispatch,
  recordReceipt,
  AllocationError,
} from '@/lib/domain/commitments';
import { getAllocations, getRequestById, setItemQuantity } from '@/lib/domain/requests';
import { freshDb, itemIdFor, lotQty, makeRequest } from './helpers';

function facts(partial: Partial<ItemFacts>): ItemFacts {
  return {
    itemId: 'itm1',
    categoryId: 'meal_packs',
    unit: 'packs',
    requestedQty: 100,
    requestedUncertain: false,
    commitments: [],
    ...partial,
  };
}

describe('allocation arithmetic (pure)', () => {
  it('walks the brief’s worked example end to end', () => {
    // 100 requested, A commits 60
    let a = computeItemAllocation(
      facts({
        commitments: [
          { id: 'A', organizationId: 'orgA', qty: 60, status: 'committed', receivedQty: 0, dispatchedQty: 0 },
        ],
      }),
    );
    expect(a.outstandingQty).toBe(40);

    // B commits the remaining 40
    a = computeItemAllocation(
      facts({
        commitments: [
          { id: 'A', organizationId: 'orgA', qty: 60, status: 'committed', receivedQty: 0, dispatchedQty: 0 },
          { id: 'B', organizationId: 'orgB', qty: 40, status: 'committed', receivedQty: 0, dispatchedQty: 0 },
        ],
      }),
    );
    expect(a.outstandingQty).toBe(0);
    expect(a.openCommittedQty).toBe(100);
    expect(a.receivedQty).toBe(0);

    // A delivers only 50: the commitment settles short
    a = computeItemAllocation(
      facts({
        commitments: [
          { id: 'A', organizationId: 'orgA', qty: 60, status: 'partially_received', receivedQty: 50, dispatchedQty: 60 },
          { id: 'B', organizationId: 'orgB', qty: 40, status: 'committed', receivedQty: 0, dispatchedQty: 0 },
        ],
      }),
    );
    expect(a.outstandingQty).toBe(10);
    expect(a.receivedQty).toBe(50);
    expect(a.shortfallQty).toBe(10);
    expect(a.hasDiscrepancy).toBe(true);
  });

  it('keeps an unknown requested quantity unknown', () => {
    const a = computeItemAllocation(facts({ requestedQty: null, requestedUncertain: true }));
    expect(a.outstandingQty).toBeNull();
    expect(a.needsQuantityConfirmation).toBe(true);
  });

  it('reopens need when a commitment is cancelled', () => {
    const a = computeItemAllocation(
      facts({
        commitments: [
          { id: 'A', organizationId: 'orgA', qty: 60, status: 'cancelled', receivedQty: 0, dispatchedQty: 0 },
          { id: 'B', organizationId: 'orgB', qty: 40, status: 'committed', receivedQty: 0, dispatchedQty: 0 },
        ],
      }),
    );
    expect(a.outstandingQty).toBe(60);
    expect(a.cancelledQty).toBe(60);
  });

  it('does not double-count a partial receipt against a still-open commitment', () => {
    const a = computeItemAllocation(
      facts({
        requestedQty: 100,
        commitments: [
          { id: 'A', organizationId: 'orgA', qty: 100, status: 'dispatched', receivedQty: 30, dispatchedQty: 100 },
        ],
      }),
    );
    // 30 confirmed + 70 still promised = 100 covered, not 130.
    expect(a.outstandingQty).toBe(0);
    expect(a.receivedQty).toBe(30);
    expect(a.inTransitQty).toBe(70);
  });
});

describe('request status derivation', () => {
  const base = { reviewed: false, manualStatus: null, anyDisputed: false };

  it('a submitted request with no cover stays submitted', () => {
    const allocations = [computeItemAllocation(facts({}))];
    expect(deriveRequestStatus({ ...base, allocations })).toBe('submitted');
  });

  it('never reports fulfilled while a quantity is unknown', () => {
    const allocations = [
      computeItemAllocation(
        facts({
          requestedQty: null,
          commitments: [
            { id: 'A', organizationId: 'o', qty: 20, status: 'received', receivedQty: 20, dispatchedQty: 20 },
          ],
        }),
      ),
    ];
    expect(deriveRequestStatus({ ...base, allocations })).not.toBe('fulfilled');
  });

  it('reaches fulfilled only when receipts cover the request', () => {
    const allocations = [
      computeItemAllocation(
        facts({
          commitments: [
            { id: 'A', organizationId: 'o', qty: 100, status: 'received', receivedQty: 100, dispatchedQty: 100 },
          ],
        }),
      ),
    ];
    expect(deriveRequestStatus({ ...base, allocations })).toBe('fulfilled');
  });

  it('gates "help is on the way" behind a real assignment', () => {
    expect(canSayHelpIsOnTheWay('submitted', false)).toBe(false);
    expect(canSayHelpIsOnTheWay('fully_allocated', true)).toBe(false);
    expect(canSayHelpIsOnTheWay('delivery_in_progress', false)).toBe(false);
    expect(canSayHelpIsOnTheWay('delivery_in_progress', true)).toBe(true);
  });
});

describe('allocation against the database', () => {
  it('runs the two-organisation partial allocation and short delivery', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 100 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');

    const a = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_meals',
      qty: 60,
      approvedBy: 'usr_coordinator',
    });
    expect(a.outstandingAfter).toBe(40);
    expect(a.requestStatus).toBe('partially_allocated');

    const b = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_trust_meals',
      qty: 40,
      approvedBy: 'usr_coordinator2',
    });
    expect(b.outstandingAfter).toBe(0);
    expect(b.requestStatus).toBe('fully_allocated');

    // Committing one more pack must be refused: nothing is outstanding.
    expect(() =>
      commitStock(db, {
        requestItemId: itemId,
        inventoryLotId: 'lot_foods_meals',
        qty: 1,
        approvedBy: 'usr_coordinator',
      }),
    ).toThrowError(AllocationError);

    recordDispatch(db, { commitmentId: a.commitmentId, qty: 60, actorUserId: 'usr_coordinator' });
    expect(getRequestById(db, requestId)!.status).toBe('delivery_in_progress');

    const receipt = recordReceipt(db, {
      commitmentId: a.commitmentId,
      qtyReceived: 50,
      confirmedByKind: 'recipient',
    });
    expect(receipt.commitmentStatus).toBe('partially_received');
    expect(receipt.shortfallQty).toBe(10);
    expect(receipt.outstandingAfter).toBe(10);

    // The 10 that never arrived are available for allocation again; the 50 that
    // did are gone from the lot.
    const lot = lotQty(db, 'lot_aid_meals');
    expect(lot.total).toBe(210);
    expect(lot.committed).toBe(0);
    expect(lot.available).toBe(210);

    // A third organisation covers the reopened 10.
    const c = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_foods_meals',
      qty: 10,
      approvedBy: 'usr_coordinator',
    });
    expect(c.outstandingAfter).toBe(0);
  });

  it('refuses to commit against an unconfirmed quantity, then allows it once a human sets one', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, {
      items: [{ categoryId: 'drinking_water', quantity: null, quantityUncertain: true }],
      groupSize: 25,
    });
    const itemId = itemIdFor(db, requestId, 'drinking_water');

    expect(() =>
      commitStock(db, {
        requestItemId: itemId,
        inventoryLotId: 'lot_aid_water',
        qty: 100,
        approvedBy: 'usr_coordinator',
      }),
    ).toThrowError(/not yet known/i);

    setItemQuantity(db, itemId, 150, { kind: 'coordinator', userId: 'usr_coordinator' });
    const result = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_water',
      qty: 100,
      approvedBy: 'usr_coordinator',
    });
    expect(result.outstandingAfter).toBe(50);
  });

  it('reopens the need and releases stock when a commitment is cancelled', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 80 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');

    const c = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_meals',
      qty: 80,
      approvedBy: 'usr_coordinator',
    });
    expect(lotQty(db, 'lot_aid_meals').available).toBe(180);

    const cancelled = cancelCommitment(db, {
      commitmentId: c.commitmentId,
      reason: 'Vehicle broke down, no replacement available.',
      actorUserId: 'usr_coordinator',
    });
    expect(cancelled.outstandingAfter).toBe(80);
    expect(lotQty(db, 'lot_aid_meals').available).toBe(260);
    expect(getRequestById(db, requestId)!.status).toBe('under_review');
  });

  it('records a total delivery failure and restores the full outstanding need', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'hygiene_kits', quantity: 40 }] });
    const itemId = itemIdFor(db, requestId, 'hygiene_kits');
    const c = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_trust_hygiene',
      qty: 40,
      approvedBy: 'usr_coordinator',
    });
    recordDispatch(db, { commitmentId: c.commitmentId, qty: 40, actorUserId: 'usr_coordinator' });
    const receipt = recordReceipt(db, {
      commitmentId: c.commitmentId,
      qtyReceived: 0,
      note: 'Road closed; load returned to the hub.',
      confirmedByKind: 'coordinator',
      confirmedByUserId: 'usr_coordinator',
    });
    expect(receipt.outstandingAfter).toBe(40);
    expect(lotQty(db, 'lot_trust_hygiene').available).toBe(220);
    const alloc = getAllocations(db, requestId)[0];
    expect(alloc.shortfallQty).toBe(40);
    expect(alloc.hasDiscrepancy).toBe(true);
  });

  it('refuses a category or unit mismatch', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 20 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');
    expect(() =>
      commitStock(db, {
        requestItemId: itemId,
        inventoryLotId: 'lot_aid_water',
        qty: 20,
        approvedBy: 'usr_coordinator',
      }),
    ).toThrowError(/different resource category/i);
  });
});
