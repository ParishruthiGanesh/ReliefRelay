import { describe, expect, it } from 'vitest';
import { confirmAndSubmit, startConversation, submitTurn, viewConversation } from '@/lib/conversation/engine';
import {
  cancelCommitment,
  commitStock,
  createAssignment,
  recordDispatch,
  recordReceipt,
  updateAssignment,
} from '@/lib/domain/commitments';
import { coordinatorRequestView, listCoordinatorRequests, publicNeedSummaries, trackingView } from '@/lib/domain/dashboard';
import { listAdvisories, refreshAdvisories } from '@/lib/domain/advisories';
import { getAllocations, getRequestById, getRequestByTrackingToken, markReviewed, setItemQuantity } from '@/lib/domain/requests';
import { recordFacilityUpdate, getFacility } from '@/lib/domain/facilities';
import { metricsSnapshot } from '@/lib/domain/metrics';
import { suggestMatches, situationSummary } from '@/lib/domain/matching';
import { createOffer, acceptOffer, listOffers } from '@/lib/domain/inventory';
import { freshDb, itemIdFor, lotQty, makeRequest } from './helpers';

/**
 * The whole demonstration scenario, end to end, through the same functions the
 * API routes call. If this passes, the demo works.
 */
describe('the full demonstration scenario', () => {
  it('runs advisory, voice request, review, split allocation, short delivery, recovery and receipt', async () => {
    const db = freshDb();

    // ── 1. A sourced (here: clearly simulated) flood advisory ──────────────
    const refresh = await refreshAdvisories(db);
    expect(refresh.recordKind).toBe('scenario');
    const advisories = listAdvisories(db);
    expect(advisories.some((a) => a.isSimulated && a.status === 'active')).toBe(true);
    expect(advisories.some((a) => a.status === 'expired')).toBe(true);

    // ── 2-4. A community representative speaks, is asked, confirms ─────────
    const conversation = startConversation(db, {
      language: 'en',
      mode: 'request',
      behalfRole: 'community_rep',
    });
    await submitTurn(db, conversation.conversationId, {
      text: 'We are at the school near the old bridge. There are twenty-five people here. We need food and drinking water.',
      inputMode: 'voice',
      sttProvider: 'browser-webspeech',
    });
    await submitTurn(db, conversation.conversationId, {
      text: 'Riverside Primary School',
      inputMode: 'voice',
    });
    const ready = await submitTurn(db, conversation.conversationId, { text: 'Yes', inputMode: 'voice' });
    expect(ready.state).toBe('confirming');

    const submitted = confirmAndSubmit(db, conversation.conversationId, {
      idempotencyKey: 'demo-key-00000001',
      confirmedSummary: ready.readback!.summary,
      acceptIncomplete: true,
    });
    const requestId = submitted.requestId;
    expect(submitted.status).toBe('submitted');

    // The requester's own view says plainly that nothing is on the way.
    let tracked = trackingView(db, getRequestByTrackingToken(db, submitted.trackingToken)!);
    expect(tracked.canSayHelpIsOnTheWay).toBe(false);
    expect(tracked.statusExplanation).toMatch(/has not yet accepted/i);

    // ── 5. A coordinator reviews it and sees what is available ─────────────
    markReviewed(db, requestId, 'usr_coordinator');
    const inList = listCoordinatorRequests(db).find((r) => r.id === requestId);
    expect(inList?.status).toBe('under_review');
    expect(inList?.missingFields.some((f) => f.startsWith('quantity:'))).toBe(true);
    // In an advisory area, which the dashboard surfaces.
    expect(inList?.advisories.length).toBeGreaterThan(0);

    const situation = situationSummary(db);
    expect(situation.lines.join(' ')).toMatch(/missing essential information/);

    // Quantities were never invented, so stock cannot be committed yet.
    const mealItem = itemIdFor(db, requestId, 'meal_packs');
    expect(() =>
      commitStock(db, {
        requestItemId: mealItem,
        inventoryLotId: 'lot_aid_meals',
        qty: 100,
        approvedBy: 'usr_coordinator',
      }),
    ).toThrowError(/not yet known/i);

    // The coordinator confirms the figures with the representative.
    setItemQuantity(db, mealItem, 100, { kind: 'coordinator', userId: 'usr_coordinator' });
    const waterItem = itemIdFor(db, requestId, 'drinking_water');
    setItemQuantity(db, waterItem, 300, { kind: 'coordinator', userId: 'usr_coordinator' });

    const matches = suggestMatches(db, getRequestById(db, requestId)!);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].reasons.length).toBeGreaterThan(0);

    // ── 6. Two organisations commit partial quantities, without overlap ────
    const orgA = commitStock(db, {
      requestItemId: mealItem,
      inventoryLotId: 'lot_aid_meals',
      qty: 60,
      approvedBy: 'usr_coordinator',
    });
    expect(orgA.outstandingAfter).toBe(40);

    const orgB = commitStock(db, {
      requestItemId: mealItem,
      inventoryLotId: 'lot_trust_meals',
      qty: 40,
      approvedBy: 'usr_coordinator2',
    });
    expect(orgB.outstandingAfter).toBe(0);

    // Neither took the other's stock.
    expect(lotQty(db, 'lot_aid_meals').committed).toBe(60);
    expect(lotQty(db, 'lot_trust_meals').committed).toBe(40);

    // ── 7. A delivery is assigned and arrives short ────────────────────────
    const assignment = createAssignment(db, {
      commitmentId: orgA.commitmentId,
      volunteerId: 'usr_volunteer_1',
      instructions: 'Collect from Southgate, deliver to the shelter desk.',
      assignedBy: 'usr_coordinator',
    });
    updateAssignment(db, {
      assignmentId: assignment.assignmentId,
      volunteerId: 'usr_volunteer_1',
      status: 'accepted',
    });
    recordDispatch(db, {
      commitmentId: orgA.commitmentId,
      qty: 60,
      volunteerId: 'usr_volunteer_1',
      accessNote: 'Mill Lane passable with care, reported by the shelter desk.',
      accessNoteSource: 'Shelter representative (fictional)',
      actorUserId: 'usr_coordinator',
    });

    // Now, and only now, may the requester be told help is on the way.
    tracked = trackingView(db, getRequestByTrackingToken(db, submitted.trackingToken)!);
    expect(tracked.status).toBe('delivery_in_progress');
    expect(tracked.canSayHelpIsOnTheWay).toBe(true);

    const short = recordReceipt(db, {
      commitmentId: orgA.commitmentId,
      qtyReceived: 50,
      note: 'Ten packs were damaged in transit.',
      confirmedByKind: 'recipient',
    });
    expect(short.shortfallQty).toBe(10);

    // ── 8. The unmet quantity reappears by itself ──────────────────────────
    expect(short.outstandingAfter).toBe(10);
    const mealAllocation = getAllocations(db, requestId).find((a) => a.itemId === mealItem)!;
    expect(mealAllocation.receivedQty).toBe(50);
    expect(mealAllocation.shortfallQty).toBe(10);
    expect(mealAllocation.hasDiscrepancy).toBe(true);

    // ── 9. Another approved team covers the reopened need ──────────────────
    const orgC = commitStock(db, {
      requestItemId: mealItem,
      inventoryLotId: 'lot_foods_meals',
      qty: 10,
      approvedBy: 'usr_coordinator',
    });
    expect(orgC.outstandingAfter).toBe(0);
    createAssignment(db, {
      commitmentId: orgC.commitmentId,
      volunteerId: 'usr_volunteer_2',
      assignedBy: 'usr_coordinator',
    });
    recordDispatch(db, { commitmentId: orgC.commitmentId, qty: 10, actorUserId: 'usr_coordinator' });

    // ── 10. The recipient confirms receipt ────────────────────────────────
    recordReceipt(db, {
      commitmentId: orgC.commitmentId,
      qtyReceived: 10,
      confirmedByKind: 'recipient',
    });
    recordReceipt(db, {
      commitmentId: orgB.commitmentId,
      qtyReceived: 40,
      confirmedByKind: 'recipient',
    });

    const finalMeals = getAllocations(db, requestId).find((a) => a.itemId === mealItem)!;
    expect(finalMeals.receivedQty).toBe(100);
    expect(finalMeals.outstandingQty).toBe(0);

    // Water is still entirely unmet, so the request is not fulfilled.
    expect(getRequestById(db, requestId)!.status).toBe('partially_received');

    // ── 11. Shelter information and the acknowledgement trail ─────────────
    recordFacilityUpdate(db, {
      facilityId: 'fac_riverside_primary',
      capacityAvailable: 10,
      openingStatus: null,
      resourcesNote: 'Meal packs received; drinking water still short.',
      note: 'Confirmed at the shelter desk.',
      sourceKind: 'facility_confirmed',
      reportedBy: 'usr_shelter_rep',
    });
    const facility = getFacility(db, 'fac_riverside_primary')!;
    expect(facility.capacityAvailable).toBe(10);
    expect(facility.availabilityLabel).toBe('recently_confirmed');
    expect(facility.freshness).toBe('fresh');

    const attestations = db
      .prepare('SELECT event_type, status FROM attestations ORDER BY created_at')
      .all() as Array<{ event_type: string; status: string }>;
    // Four commitments' worth of acknowledgements, including the correction.
    expect(attestations.filter((a) => a.event_type === 'commitment')).toHaveLength(3);
    expect(attestations.filter((a) => a.event_type === 'discrepancy')).toHaveLength(1);
    expect(attestations.every((a) => a.status === 'pending')).toBe(true);

    // ── Metrics are all computed from these records ───────────────────────
    const metrics = metricsSnapshot(db);
    expect(metrics.timeToReview.count).toBe(1);
    expect(metrics.timeToFirstAllocation.count).toBe(1);
    expect(metrics.delivery.deliveriesShort).toBe(1);
    expect(metrics.delivery.commitmentsTotal).toBe(3);
    const meals = metrics.categoryTotals.find((c) => c.categoryId === 'meal_packs')!;
    expect(meals.requested).toBe(100);
    expect(meals.received).toBe(100);
    expect(meals.shortfall).toBe(10);
    const water = metrics.categoryTotals.find((c) => c.categoryId === 'drinking_water')!;
    expect(water.outstanding).toBe(300);

    // And the public view still exposes nothing sensitive.
    const publicFeed = publicNeedSummaries(db);
    expect(publicFeed.some((n) => n.referenceCode === submitted.referenceCode)).toBe(true);
    expect(JSON.stringify(publicFeed)).not.toContain('Ten packs were damaged');
  });

  it('reopens the need when a commitment is cancelled mid-flight', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'drinking_water', quantity: 500 }] });
    const itemId = itemIdFor(db, requestId, 'drinking_water');

    const first = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_water',
      qty: 500,
      approvedBy: 'usr_coordinator',
    });
    const assignment = createAssignment(db, {
      commitmentId: first.commitmentId,
      volunteerId: 'usr_volunteer_1',
      assignedBy: 'usr_coordinator',
    });

    cancelCommitment(db, {
      commitmentId: first.commitmentId,
      reason: 'The access road flooded.',
      actorUserId: 'usr_coordinator',
    });

    // The need is open, the stock is free, and the volunteer is stood down.
    expect(getAllocations(db, requestId)[0].outstandingQty).toBe(500);
    expect(lotQty(db, 'lot_aid_water').available).toBe(1800);
    const stoodDown = db
      .prepare('SELECT status FROM assignments WHERE id = ?')
      .get(assignment.assignmentId) as { status: string };
    expect(stoodDown.status).toBe('withdrawn');

    // Another organisation can then take it.
    const second = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_trust_water',
      qty: 500,
      approvedBy: 'usr_coordinator2',
    });
    expect(second.outstandingAfter).toBe(0);
  });

  it('reassigns a delivery and stands the previous volunteer down', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 30 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');
    const commitment = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_meals',
      qty: 30,
      approvedBy: 'usr_coordinator',
    });

    const first = createAssignment(db, {
      commitmentId: commitment.commitmentId,
      volunteerId: 'usr_volunteer_1',
      assignedBy: 'usr_coordinator',
    });
    updateAssignment(db, {
      assignmentId: first.assignmentId,
      volunteerId: 'usr_volunteer_1',
      status: 'withdrawn',
    });
    const second = createAssignment(db, {
      commitmentId: commitment.commitmentId,
      volunteerId: 'usr_volunteer_2',
      assignedBy: 'usr_coordinator',
    });

    const rows = db
      .prepare('SELECT volunteer_id, status FROM assignments WHERE commitment_id = ? ORDER BY created_at')
      .all(commitment.commitmentId) as Array<{ volunteer_id: string; status: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe('withdrawn');
    expect(rows[1].volunteer_id).toBe('usr_volunteer_2');
    expect(second.assignmentId).toBeTruthy();
  });

  it('turns an accepted offer into allocatable stock, but not before', () => {
    const db = freshDb();
    const offer = createOffer(db, {
      categoryId: 'hygiene_kits',
      qty: 75,
      generalLocation: 'Southgate Industrial Estate',
      handover: 'collection',
      idempotencyKey: 'offer-key-0001',
      organizationId: 'org_southgate_foods',
    });
    expect(offer.deduplicated).toBe(false);
    // The same key again returns the same offer rather than a second one.
    expect(createOffer(db, {
      categoryId: 'hygiene_kits',
      qty: 75,
      generalLocation: 'Southgate Industrial Estate',
      handover: 'collection',
      idempotencyKey: 'offer-key-0001',
      organizationId: 'org_southgate_foods',
    })).toEqual({ offerId: offer.offerId, deduplicated: true });

    const { requestId } = makeRequest(db, { items: [{ categoryId: 'hygiene_kits', quantity: 75 }] });
    const itemId = itemIdFor(db, requestId, 'hygiene_kits');

    // An offer awaiting review is not stock: it does not appear as a match.
    expect(listOffers(db)).toHaveLength(1);
    const beforeLots = db
      .prepare("SELECT COUNT(*) AS n FROM inventory_lots WHERE general_location LIKE 'Southgate Industrial%'")
      .get() as { n: number };
    expect(beforeLots.n).toBe(0);

    const lot = acceptOffer(db, {
      offerId: offer.offerId,
      organizationId: 'org_southgate_foods',
      facilityId: 'fac_depot_south',
    });
    const committed = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: lot.inventoryLotId,
      qty: 75,
      approvedBy: 'usr_coordinator',
    });
    expect(committed.outstandingAfter).toBe(0);
    expect(listOffers(db)).toHaveLength(0);
  });

  it('never reports a request as submitted before the server has acknowledged it', async () => {
    const db = freshDb();
    const conversation = startConversation(db, { language: 'en', mode: 'request' });
    await submitTurn(db, conversation.conversationId, {
      text: 'We need 20 hygiene kits at Northfield College Gymnasium.',
      inputMode: 'text',
    });

    // Before confirmation there is no request, no reference and no status.
    const beforeCount = db.prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number };
    expect(beforeCount.n).toBe(0);
    const pending = viewConversation(db, conversation.conversationId);
    expect(pending.submitted).toBeNull();
    expect(pending.state).toBe('confirming');

    const result = confirmAndSubmit(db, conversation.conversationId, {
      idempotencyKey: 'ack-key-00000001',
      confirmedSummary: pending.readback!.summary,
      acceptIncomplete: true,
    });
    // The reference and status come from the server, not from the client.
    expect(result.referenceCode).toMatch(/^RR-\d+$/);
    expect(getRequestById(db, result.requestId)!.status).toBe('submitted');

    // A second confirmation of the same conversation with a new key is refused
    // rather than quietly creating a duplicate.
    expect(() =>
      confirmAndSubmit(db, conversation.conversationId, {
        idempotencyKey: 'ack-key-00000002',
        confirmedSummary: pending.readback!.summary,
        acceptIncomplete: true,
      }),
    ).toThrowError(/already submitted/i);
    const afterCount = db.prepare('SELECT COUNT(*) AS n FROM requests').get() as { n: number };
    expect(afterCount.n).toBe(1);
  });

  it('shows a coordinator the provenance and freshness of everything', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });
    const view = coordinatorRequestView(db, getRequestById(db, requestId)!, listAdvisories(db));
    expect(view.provenance.sourceLabel).toBe('User reported');
    expect(view.provenance.lastUpdatedAge).toBeTruthy();
    markReviewed(db, requestId, 'usr_coordinator');
    const reviewed = coordinatorRequestView(db, getRequestById(db, requestId)!, listAdvisories(db));
    expect(reviewed.provenance.sourceLabel).toBe('Coordinator reviewed');
  });
});
