/**
 * Child process used by the concurrency test.
 *
 * Runs one commitStock against a shared SQLite file and prints the outcome as
 * JSON. Two of these are launched at the same moment, in separate OS
 * processes, with separate database connections — which is the only way to
 * prove the guard really is in the database and not in JavaScript.
 */
import { applySchema, openDatabase } from '../../src/lib/db';
import { AllocationError, commitStock } from '../../src/lib/domain/commitments';

const [dbPath, requestItemId, inventoryLotId, qty, approvedBy] = process.argv.slice(2);

const db = openDatabase(dbPath);
applySchema(db);

try {
  const result = commitStock(db, {
    requestItemId,
    inventoryLotId,
    qty: Number(qty),
    approvedBy,
  });
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      code: error instanceof AllocationError ? error.code : 'unknown',
      message: (error as Error).message,
    }),
  );
} finally {
  db.close();
}
