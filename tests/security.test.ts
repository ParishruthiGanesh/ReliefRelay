import { describe, expect, it } from 'vitest';
import {
  AuthorizationError,
  canUpdateFacility,
  canViewRequestPrivately,
  login,
  requireRole,
  resolveSession,
  type SessionUser,
} from '@/lib/auth/session';
import { buildManifest, canonicalJson, manifestHash } from '@/lib/domain/attestations';
import {
  AllocationError,
  commitStock,
  createAssignment,
  updateAssignment,
} from '@/lib/domain/commitments';
import { publicNeedSummaries, coordinatorRequestView, trackingView } from '@/lib/domain/dashboard';
import { listAdvisories } from '@/lib/domain/advisories';
import { getRequestById, getRequestByTrackingToken } from '@/lib/domain/requests';
import {
  decideDuplicate,
  listDuplicateSuggestions,
  refreshDuplicateCandidates,
} from '@/lib/domain/duplicates';
import { sha256Hex } from '@/lib/util/tokens';
import { freshDb, itemIdFor, makeRequest } from './helpers';

describe('private request access', () => {
  it('only the tracking token opens a request, never the reference code', () => {
    const db = freshDb();
    const created = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });

    expect(getRequestByTrackingToken(db, created.trackingToken)?.id).toBe(created.requestId);
    // The printable reference is not a credential.
    expect(getRequestByTrackingToken(db, created.referenceCode)).toBeUndefined();
    // Nor is a guess, a near miss, or an empty string.
    expect(getRequestByTrackingToken(db, `${created.trackingToken}x`)).toBeUndefined();
    expect(getRequestByTrackingToken(db, created.trackingToken.slice(0, -1))).toBeUndefined();
    expect(getRequestByTrackingToken(db, '')).toBeUndefined();
  });

  it('stores only a hash of the token, so the database holds nothing that grants access', () => {
    const db = freshDb();
    const created = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });
    const row = getRequestById(db, created.requestId)!;

    expect(row.tracking_token_hash).toBe(sha256Hex(created.trackingToken));
    expect(row.tracking_token_hash).not.toBe(created.trackingToken);

    // The raw token appears nowhere in the database.
    const dump = db
      .prepare('SELECT * FROM requests WHERE id = ?')
      .get(created.requestId) as Record<string, unknown>;
    expect(JSON.stringify(dump)).not.toContain(created.trackingToken);
  });

  it('a tracking token cannot be used to confirm a receipt on another request', () => {
    const db = freshDb();
    const mine = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });
    const theirs = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });

    const theirItem = itemIdFor(db, theirs.requestId, 'meal_packs');
    const commitment = commitStock(db, {
      requestItemId: theirItem,
      inventoryLotId: 'lot_aid_meals',
      qty: 10,
      approvedBy: 'usr_coordinator',
    });

    // The route checks that the commitment belongs to the token's request;
    // this asserts the underlying fact that check relies on.
    const owner = db
      .prepare('SELECT request_id FROM commitments WHERE id = ?')
      .get(commitment.commitmentId) as { request_id: string };
    expect(owner.request_id).toBe(theirs.requestId);
    expect(owner.request_id).not.toBe(mine.requestId);
  });
});

describe('role authorisation', () => {
  it('rejects a signed-out user and the wrong role', () => {
    expect(() => requireRole(null, 'coordinator')).toThrowError(AuthorizationError);
    const volunteer: SessionUser = {
      id: 'u1',
      email: 'v@example.test',
      displayName: 'V',
      role: 'volunteer',
      organizationId: null,
      facilityId: null,
      isApproved: true,
    };
    expect(() => requireRole(volunteer, 'coordinator')).toThrowError(AuthorizationError);
    expect(requireRole(volunteer, 'volunteer').id).toBe('u1');
  });

  it('rejects an unapproved volunteer even for volunteer-only areas', () => {
    const pending: SessionUser = {
      id: 'u2',
      email: 'p@example.test',
      displayName: 'P',
      role: 'volunteer',
      organizationId: null,
      facilityId: null,
      isApproved: false,
    };
    expect(() => requireRole(pending, 'volunteer')).toThrowError(/not been approved/i);
  });

  it('refuses to assign a delivery to an unapproved volunteer, in the backend', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');
    const commitment = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_meals',
      qty: 10,
      approvedBy: 'usr_coordinator',
    });

    expect(() =>
      createAssignment(db, {
        commitmentId: commitment.commitmentId,
        volunteerId: 'usr_volunteer_3',
        assignedBy: 'usr_coordinator',
      }),
    ).toThrowError(/approved volunteer/i);

    // And it is not merely a role check: a coordinator id is refused too.
    expect(() =>
      createAssignment(db, {
        commitmentId: commitment.commitmentId,
        volunteerId: 'usr_coordinator2',
        assignedBy: 'usr_coordinator',
      }),
    ).toThrowError(AllocationError);
  });

  it('lets a volunteer act only on their own assignment', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');
    const commitment = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_meals',
      qty: 10,
      approvedBy: 'usr_coordinator',
    });
    const assignment = createAssignment(db, {
      commitmentId: commitment.commitmentId,
      volunteerId: 'usr_volunteer_1',
      assignedBy: 'usr_coordinator',
    });

    expect(() =>
      updateAssignment(db, {
        assignmentId: assignment.assignmentId,
        volunteerId: 'usr_volunteer_2',
        status: 'accepted',
      }),
    ).toThrowError(/belongs to someone else/i);

    updateAssignment(db, {
      assignmentId: assignment.assignmentId,
      volunteerId: 'usr_volunteer_1',
      status: 'accepted',
    });
    const row = db
      .prepare('SELECT status FROM assignments WHERE id = ?')
      .get(assignment.assignmentId) as { status: string };
    expect(row.status).toBe('accepted');
  });

  it('scopes a facility representative to their own facility', () => {
    const rep: SessionUser = {
      id: 'usr_shelter_rep',
      email: 'shelter@reliefrelay.test',
      displayName: 'R',
      role: 'facility_rep',
      organizationId: null,
      facilityId: 'fac_riverside_primary',
      isApproved: true,
    };
    expect(canUpdateFacility(rep, 'fac_riverside_primary')).toBe(true);
    expect(canUpdateFacility(rep, 'fac_old_bridge_hall')).toBe(false);
    expect(canViewRequestPrivately(rep, { resolved_facility_id: 'fac_riverside_primary' })).toBe(true);
    expect(canViewRequestPrivately(rep, { resolved_facility_id: 'fac_northfield_college' })).toBe(false);
    expect(canViewRequestPrivately(null, { resolved_facility_id: 'fac_riverside_primary' })).toBe(false);
  });

  it('authenticates with the seeded password and rejects a wrong one', () => {
    const db = freshDb();
    expect(login(db, 'coordinator@reliefrelay.test', 'wrong-password')).toBeNull();
    expect(login(db, 'nobody@reliefrelay.test', 'coordinator-demo')).toBeNull();

    const session = login(db, 'coordinator@reliefrelay.test', 'coordinator-demo');
    expect(session?.user.role).toBe('coordinator');
    expect(resolveSession(db, session!.token)?.id).toBe('usr_coordinator');
    // A session is stored only as a hash, so a stolen database row is not a cookie.
    expect(resolveSession(db, 'not-a-real-token')).toBeNull();
  });
});

describe('sensitive information stays where it belongs', () => {
  const SECRET_PHONE = '+00 000 5550101';
  const SECRET_TEXT = 'We are the third house past the broken gate, ask for Mrs Fictional.';

  function requestWithSensitiveData() {
    const db = freshDb();
    const created = makeRequest(db, {
      items: [{ categoryId: 'drinking_water', quantity: 100 }],
      groupSize: 6,
    });
    db.prepare(
      `UPDATE requests SET contact_method = 'phone', contact_value = ?, original_text = ?,
              transcript_text = ?, resolved_lat = 41.9901234, resolved_lng = -91.6749876
        WHERE id = ?`,
    ).run(SECRET_PHONE, SECRET_TEXT, SECRET_TEXT, created.requestId);
    return { db, created };
  }

  it('keeps contact details, transcripts and exact coordinates out of the public feed', () => {
    const { db } = requestWithSensitiveData();
    const serialized = JSON.stringify(publicNeedSummaries(db));

    expect(serialized).not.toContain(SECRET_PHONE);
    expect(serialized).not.toContain(SECRET_TEXT);
    expect(serialized).not.toContain('41.9901234');
    expect(serialized).not.toContain('-91.6749876');
    // Nor the group size or any quantity for an individual household.
    expect(serialized).not.toMatch(/"groupSize"/);
    expect(serialized).not.toMatch(/"quantity"/);
  });

  it('coarsens public map points to about a kilometre', () => {
    const { db, created } = requestWithSensitiveData();
    const row = getRequestById(db, created.requestId)!;
    // The exact point was stored, and a separate coarse point is what is published.
    expect(row.resolved_lat).toBe(41.9901234);
    expect(row.public_lat).toBe(41.99);
    expect(row.public_lng).toBe(-91.67);
  });

  it('shows sensitive fields to a coordinator, because that is who needs them', () => {
    const { db, created } = requestWithSensitiveData();
    const row = getRequestById(db, created.requestId)!;
    const view = coordinatorRequestView(db, row, listAdvisories(db));
    expect(view.contactValue).toBe(SECRET_PHONE);
    expect(view.originalText).toBe(SECRET_TEXT);
    expect(view.lat).toBe(41.9901234);
  });

  it('shows the requester their own request without coordinator-only notes', () => {
    const { db, created } = requestWithSensitiveData();
    const row = getRequestByTrackingToken(db, created.trackingToken)!;
    const view = trackingView(db, row);
    const serialized = JSON.stringify(view);
    // Their own location is theirs to see; coordinator-only material is not.
    expect(view.locationText).toBeTruthy();
    expect(serialized).not.toContain('reviewFlags');
    expect(serialized).not.toContain('priority');
    expect(serialized).not.toContain('extractionProvider');
  });

  it('writes nothing personal into an attestation manifest', () => {
    const manifest = buildManifest({
      eventType: 'commitment',
      chainOrgRef: '0x1111111111111111111111111111111111111111111111111111111111111111',
      requestId: 'req_abc123',
      commitmentId: 'cmt_def456',
      categoryId: 'drinking_water',
      unit: 'litres',
      qty: 100,
      occurredAt: '2026-01-02T03:04:05.678Z',
    });
    const serialized = canonicalJson(manifest);

    for (const forbidden of [
      SECRET_PHONE,
      SECRET_TEXT,
      'Mrs Fictional',
      'Riverbend',
      'Riverside',
      '41.9901234',
      '-91.6749876',
      'req_abc123',
      'cmt_def456',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }

    // Only opaque refs, a category, a unit, a quantity and a minute.
    expect(Object.keys(manifest).sort()).toEqual([
      'categoryId',
      'chainOrgRef',
      'commitmentRef',
      'eventType',
      'occurredAtMinute',
      'qty',
      'subjectRef',
      'unit',
      'v',
    ]);
    expect(manifest.subjectRef).toMatch(/^0x[0-9a-f]{64}$/);
    expect(manifest.occurredAtMinute).toBe('2026-01-02T03:04Z');
    // Truncated to the minute, so it is not a movement trace.
    expect(manifest.occurredAtMinute).not.toContain('05.678');
  });

  it('never shows a requester another person\u2019s request id through the timeline', () => {
    const db = freshDb();
    const mine = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });
    const theirs = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });

    // A duplicate decision writes an event on BOTH requests, and its detail
    // names the other request. The tracking view must not pass that through.
    refreshDuplicateCandidates(db);
    const suggestions = listDuplicateSuggestions(db);
    expect(suggestions.length).toBeGreaterThan(0);
    decideDuplicate(db, {
      candidateId: suggestions[0].id,
      decision: 'confirmed_duplicate',
      userId: 'usr_coordinator',
    });

    const row = getRequestByTrackingToken(db, mine.trackingToken)!;
    const serialized = JSON.stringify(trackingView(db, row));
    expect(serialized).not.toContain(theirs.requestId);
    expect(serialized).not.toContain('otherRequestId');
    expect(serialized).not.toContain('candidateId');
    expect(serialized).not.toContain('duplicate');
  });

  it('hashes the same facts to the same value regardless of key order', () => {
    const a = canonicalJson({ b: 2, a: 1, c: [3, { e: 5, d: 4 }] });
    const b = canonicalJson({ c: [3, { d: 4, e: 5 }], a: 1, b: 2 });
    expect(a).toBe(b);

    const base = {
      eventType: 'receipt' as const,
      chainOrgRef: '0x22',
      requestId: 'req_1',
      commitmentId: 'cmt_1',
      categoryId: 'meal_packs',
      unit: 'packs',
      qty: 50,
      occurredAt: '2026-01-02T03:04:00.000Z',
    };
    expect(manifestHash(buildManifest(base))).toBe(manifestHash(buildManifest(base)));
    expect(manifestHash(buildManifest(base))).not.toBe(
      manifestHash(buildManifest({ ...base, qty: 51 })),
    );
  });
});

describe('no API view leaks the stored token hash', () => {
  it('keeps tracking_token_hash out of every view a client receives', () => {
    const db = freshDb();
    const created = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 10 }] });
    const row = getRequestById(db, created.requestId)!;

    // The hash is on the row, because SELECT * returns it...
    expect(row.tracking_token_hash).toBeTruthy();

    // ...but no view handed to a client carries it.
    const views = [
      JSON.stringify(coordinatorRequestView(db, row, listAdvisories(db))),
      JSON.stringify(trackingView(db, row)),
      JSON.stringify(publicNeedSummaries(db)),
    ];
    for (const view of views) {
      expect(view).not.toContain('tracking_token_hash');
      expect(view).not.toContain(row.tracking_token_hash);
    }
  });
});
