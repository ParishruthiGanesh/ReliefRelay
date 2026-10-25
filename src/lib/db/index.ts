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
  }
  return singleton;
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
