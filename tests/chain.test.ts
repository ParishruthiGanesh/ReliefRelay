import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pendingAttestations, explainManifest, type AttestationManifest } from '@/lib/domain/attestations';
import { cancelCommitment, commitStock, recordDispatch, recordReceipt } from '@/lib/domain/commitments';
import { getAllocations, getRequestById } from '@/lib/domain/requests';
import { chainStatus, flushAttestations } from '@/lib/providers/chain';
import { freshDb, itemIdFor, lotQty, makeRequest } from './helpers';

const CHAIN_KEYS = ['CHAIN_ENABLED', 'CHAIN_RPC_URL', 'CHAIN_CONTRACT_ADDRESS', 'CHAIN_ATTESTER_PRIVATE_KEY'];

/**
 * Chain failure must never block relief work.
 *
 * Every test here runs the full relief flow with the chain unavailable in some
 * way, and asserts that the relief records are complete and correct while the
 * acknowledgements sit queued and retryable.
 */
describe('relief work continues when the chain does not', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of CHAIN_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of CHAIN_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('completes commit, dispatch and receipt with the chain disabled', async () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 100 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');

    const commitment = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_meals',
      qty: 100,
      approvedBy: 'usr_coordinator',
    });
    recordDispatch(db, { commitmentId: commitment.commitmentId, qty: 100, actorUserId: 'usr_coordinator' });
    const receipt = recordReceipt(db, {
      commitmentId: commitment.commitmentId,
      qtyReceived: 100,
      confirmedByKind: 'recipient',
    });

    // The relief side is fully correct.
    expect(receipt.requestStatus).toBe('fulfilled');
    expect(getAllocations(db, requestId)[0].receivedQty).toBe(100);
    expect(lotQty(db, 'lot_aid_meals').total).toBe(160);

    // The acknowledgements are durable and queued.
    const queued = pendingAttestations(db, 50);
    expect(queued.length).toBe(3);
    expect(queued.map((a) => a.event_type).sort()).toEqual(['commitment', 'dispatch', 'receipt']);
    expect(queued.every((a) => a.status === 'pending')).toBe(true);
    expect(queued.every((a) => a.manifest_hash.startsWith('0x'))).toBe(true);

    // Flushing is a no-op that explains itself rather than throwing.
    const flush = await flushAttestations(db);
    expect(flush.confirmed).toBe(0);
    expect(flush.failed).toBe(0);
    expect(flush.skippedReason).toMatch(/CHAIN_ENABLED/);
  });

  it('reports an unreachable chain without losing or failing anything', async () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'hygiene_kits', quantity: 20 }] });
    const itemId = itemIdFor(db, requestId, 'hygiene_kits');
    commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_trust_hygiene',
      qty: 20,
      approvedBy: 'usr_coordinator',
    });

    // Enabled, pointed at a port with nothing listening.
    process.env.CHAIN_ENABLED = 'true';
    process.env.CHAIN_RPC_URL = 'http://127.0.0.1:59999';
    process.env.CHAIN_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001';
    process.env.CHAIN_ATTESTER_PRIVATE_KEY =
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

    const status = await chainStatus();
    expect(status.enabled).toBe(true);
    expect(status.reachable).toBe(false);
    expect(status.note).toMatch(/could not be reached/i);
    expect(status.note).toMatch(/nothing else is affected/i);

    const flush = await flushAttestations(db);
    // Either a connection-level skip or a per-row failure; both keep the row.
    expect(flush.confirmed).toBe(0);
    const after = pendingAttestations(db, 50);
    expect(after.length).toBe(1);
    expect(['pending', 'failed']).toContain(after[0].status);

    // The request is untouched by any of it.
    expect(getRequestById(db, requestId)!.status).toBe('fully_allocated');
    expect(getAllocations(db, requestId)[0].openCommittedQty).toBe(20);
  }, 30_000);

  it('appends a correction rather than altering the original acknowledgement', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 60 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');
    const commitment = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_meals',
      qty: 60,
      approvedBy: 'usr_coordinator',
    });
    recordDispatch(db, { commitmentId: commitment.commitmentId, qty: 60, actorUserId: 'usr_coordinator' });
    recordReceipt(db, {
      commitmentId: commitment.commitmentId,
      qtyReceived: 50,
      confirmedByKind: 'recipient',
    });

    const rows = pendingAttestations(db, 50);
    const types = rows.map((r) => r.event_type);
    expect(types).toEqual(['commitment', 'dispatch', 'receipt', 'discrepancy']);

    // The original commitment acknowledgement still says 60.
    const original = JSON.parse(rows[0].manifest_json) as AttestationManifest;
    expect(original.qty).toBe(60);
    expect(original.shortfallQty).toBeUndefined();

    // The correction is a new record carrying the shortfall.
    const correction = JSON.parse(rows[3].manifest_json) as AttestationManifest;
    expect(correction.eventType).toBe('discrepancy');
    expect(correction.qty).toBe(50);
    expect(correction.shortfallQty).toBe(10);
  });

  it('records a correction when a commitment is cancelled', () => {
    const db = freshDb();
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'drinking_water', quantity: 300 }] });
    const itemId = itemIdFor(db, requestId, 'drinking_water');
    const commitment = commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_aid_water',
      qty: 300,
      approvedBy: 'usr_coordinator',
    });
    cancelCommitment(db, {
      commitmentId: commitment.commitmentId,
      reason: 'Lorry could not reach the hub.',
      actorUserId: 'usr_coordinator',
    });

    const rows = pendingAttestations(db, 50);
    expect(rows.map((r) => r.event_type)).toEqual(['commitment', 'discrepancy']);
    const correction = JSON.parse(rows[1].manifest_json) as AttestationManifest;
    expect(correction.qty).toBe(0);
    expect(correction.shortfallQty).toBe(300);

    // And the need is open again regardless of any chain state.
    expect(getAllocations(db, requestId)[0].outstandingQty).toBe(300);
  });

  it('explains what a hash covers, and what it does not prove', () => {
    const explanation = explainManifest({
      v: 1,
      eventType: 'receipt',
      chainOrgRef: '0x11',
      subjectRef: '0x22',
      commitmentRef: '0x33',
      categoryId: 'meal_packs',
      unit: 'packs',
      qty: 50,
      shortfallQty: 10,
      occurredAtMinute: '2026-01-02T03:04Z',
    });
    expect(explanation).toMatch(/50 packs/);
    expect(explanation).toMatch(/shortfall of 10 packs/);
    expect(explanation).toMatch(/no names, contact details, locations, transcripts or recordings/i);
    expect(explanation).toMatch(/not independent proof that goods changed hands/i);
  });
});
