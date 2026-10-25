import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applySchema, openDatabase, type DB } from '@/lib/db';
import { seed } from '@/lib/db/seed';
import { AllocationError, commitStock, lotAvailable, reserveStock } from '@/lib/domain/commitments';
import { makeRequest, itemIdFor, lotQty } from './helpers';

const run = promisify(execFile);

/**
 * Concurrent allocation.
 *
 * The thing being proven: two coordinators acting at the same instant cannot
 * commit the same stock twice. The guard is the conditional UPDATE inside an
 * immediate transaction, so it holds across separate connections and separate
 * processes — not just within one JavaScript event loop.
 */
describe('concurrent allocation of the same stock', () => {
  let dir: string;
  let dbPath: string;
  let db: DB;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reliefrelay-race-'));
    dbPath = path.join(dir, 'race.db');
    db = openDatabase(dbPath);
    applySchema(db);
    seed(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('lets exactly one of two simultaneous commits take the last of a lot', async () => {
    // A request for 90 packs, and a lot holding exactly 90.
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 90 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');
    expect(lotQty(db, 'lot_foods_meals').available).toBe(90);

    // Two coordinators, two processes, same stock, same moment.
    const results = await Promise.all([
      run('npx', ['tsx', 'tests/fixtures/race-commit.ts', dbPath, itemId, 'lot_foods_meals', '90', 'usr_coordinator']),
      run('npx', ['tsx', 'tests/fixtures/race-commit.ts', dbPath, itemId, 'lot_foods_meals', '90', 'usr_coordinator2']),
    ]);

    const parsed = results.map((r) => JSON.parse(r.stdout) as { ok: boolean; code?: string });
    const succeeded = parsed.filter((p) => p.ok);
    const failed = parsed.filter((p) => !p.ok);

    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    // The loser is told why, in terms that name the real cause.
    expect(['insufficient_stock', 'exceeds_outstanding']).toContain(failed[0].code);

    // And the stock was never oversubscribed.
    const lot = lotQty(db, 'lot_foods_meals');
    expect(lot.committed).toBe(90);
    expect(lot.available).toBe(0);

    const commitments = db
      .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(qty),0) AS total FROM commitments WHERE inventory_lot_id = ?')
      .get('lot_foods_meals') as { n: number; total: number };
    expect(commitments.n).toBe(1);
    expect(commitments.total).toBe(90);
  }, 60_000);

  it('refuses a commit built on a stale read of the available quantity', () => {
    // This is the race in its purest form: a coordinator reads 90 available,
    // another takes all 90, and the first then tries to commit against the
    // figure they read. The check lives in the UPDATE, so the stale read
    // cannot be acted on.
    const { requestId } = makeRequest(db, { items: [{ categoryId: 'meal_packs', quantity: 180 }] });
    const itemId = itemIdFor(db, requestId, 'meal_packs');

    const staleAvailable = lotAvailable(
      db.prepare('SELECT qty_total, qty_committed FROM inventory_lots WHERE id = ?').get('lot_foods_meals') as {
        qty_total: number;
        qty_committed: number;
      },
    );
    expect(staleAvailable).toBe(90);

    commitStock(db, {
      requestItemId: itemId,
      inventoryLotId: 'lot_foods_meals',
      qty: 90,
      approvedBy: 'usr_coordinator2',
    });

    expect(() =>
      commitStock(db, {
        requestItemId: itemId,
        inventoryLotId: 'lot_foods_meals',
        qty: staleAvailable,
        approvedBy: 'usr_coordinator',
      }),
    ).toThrowError(AllocationError);

    expect(lotQty(db, 'lot_foods_meals').committed).toBe(90);
  });

  it('keeps the stock invariant under a burst of reservations', () => {
    // 260 packs in the lot; twenty attempts at 20 each is 400 requested.
    // Thirteen must succeed and seven must fail, and the total can never
    // exceed what the lot holds.
    let succeeded = 0;
    for (let i = 0; i < 20; i += 1) {
      if (reserveStock(db, 'lot_aid_meals', 20)) succeeded += 1;
    }
    expect(succeeded).toBe(13);
    const lot = lotQty(db, 'lot_aid_meals');
    expect(lot.committed).toBe(260);
    expect(lot.committed).toBeLessThanOrEqual(lot.total);
  });

  it('never lets committed exceed total, which the database itself enforces', () => {
    expect(() =>
      db
        .prepare('UPDATE inventory_lots SET qty_committed = qty_total + 1 WHERE id = ?')
        .run('lot_aid_meals'),
    ).toThrowError(/CHECK constraint failed/i);
  });
});
