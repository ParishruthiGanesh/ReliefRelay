import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

let singleton: DB | null = null;

function schemaPath(): string {
  // Resolve from the repository root so it works from Next, tsx and vitest.
  return path.join(process.cwd(), 'src', 'lib', 'db', 'schema.sql');
}

export function resolveDbPath(): string {
  const raw = process.env.RELIEFRELAY_DB_PATH ?? './data/reliefrelay.db';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

/** Applies the schema. Safe to run repeatedly: every statement is IF NOT EXISTS. */
export function applySchema(db: DB): void {
  db.exec(fs.readFileSync(schemaPath(), 'utf8'));
}

export function openDatabase(file: string): DB {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Wait rather than fail when another writer holds the lock. Combined with
  // BEGIN IMMEDIATE in `transact`, this is what serialises allocation.
  db.pragma('busy_timeout = 5000');
  return db;
}

export function getDb(): DB {
  if (!singleton) {
    singleton = openDatabase(resolveDbPath());
    applySchema(singleton);
    seedIfEmpty(singleton);
  }
  return singleton;
}

/**
 * Seeds the fictional dataset when the database has no reference data.
 *
 * This exists so a deployment works on first boot without a shell: a hosted
 * instance starts with an empty volume, and without this every page would
 * render an empty district and the demonstration would be unreachable.
 *
 * It only ever fires on a genuinely empty database — if a single district row
 * exists it does nothing, so it can never overwrite real activity. Set
 * RELIEFRELAY_NO_AUTOSEED=true to disable it entirely.
 */
function seedIfEmpty(db: DB): void {
  if (process.env.RELIEFRELAY_NO_AUTOSEED === 'true') return;
  const existing = db.prepare('SELECT COUNT(*) AS n FROM districts').get() as { n: number };
  if (existing.n > 0) return;
  try {
    // Required lazily: the seed module imports from here, and loading it at
    // module scope would be a cycle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { seed } = require('./seed') as typeof import('./seed');
    seed(db);
    console.log('[reliefrelay] empty database detected — seeded the fictional demonstration data');
  } catch (error) {
    // A failure here must not stop the server booting; the pages will simply
    // show an empty district and `npm run db:seed` fixes it.
    console.error('[reliefrelay] automatic seeding failed:', (error as Error).message);
  }
}

/** For tests: an isolated in-memory database with the schema applied. */
export function createTestDb(): DB {
  const db = openDatabase(':memory:');
  applySchema(db);
  return db;
}

export function setTestDb(db: DB | null): void {
  singleton = db;
}

/**
 * Runs `fn` in a write transaction that takes the write lock up front.
 *
 * BEGIN IMMEDIATE matters: with a deferred transaction two concurrent
 * allocations can both read the same available quantity and only collide at
 * COMMIT, which SQLite reports as SQLITE_BUSY rather than as a conflict we can
 * explain. Taking the lock first makes allocation serial and lets the
 * conditional UPDATE in `reserveStock` be the single source of truth.
 */
export function transact<T>(db: DB, fn: (db: DB) => T): T {
  const begin = db.prepare('BEGIN IMMEDIATE');
  const commit = db.prepare('COMMIT');
  const rollback = db.prepare('ROLLBACK');
  begin.run();
  try {
    const result = fn(db);
    commit.run();
    return result;
  } catch (error) {
    try {
      rollback.run();
    } catch {
      // Already rolled back by SQLite; the original error is what matters.
    }
    throw error;
  }
}
