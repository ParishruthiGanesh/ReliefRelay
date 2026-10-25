import fs from 'node:fs';
import { applySchema, openDatabase, resolveDbPath } from '../src/lib/db';
import { clearAll, seed } from '../src/lib/db/seed';

/**
 * Rebuilds the fictional dataset.
 *
 * By default this clears and reseeds the tables **in place** rather than
 * deleting the file. That matters because a running dev server holds an open
 * handle: deleting the file leaves the server writing to a deleted inode while
 * a different, freshly seeded file sits on disk, and the two silently diverge
 * until the server restarts. Clearing in place means the reset takes effect
 * immediately in a server that is already running.
 *
 * `--hard` deletes and recreates the file, which is what you want after a
 * schema change. Stop the dev server first.
 */
const hard = process.argv.includes('--hard');
const file = resolveDbPath();

if (hard) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    const path = `${file}${suffix}`;
    if (fs.existsSync(path)) {
      fs.rmSync(path);
      console.log(`removed ${path}`);
    }
  }
}

const db = openDatabase(file);
applySchema(db);
clearAll(db);
seed(db);
db.close();

console.log(
  hard
    ? `Reset complete: ${file} deleted, rebuilt and reseeded. Restart the dev server.`
    : `Reset complete: ${file} cleared and reseeded in place. A running dev server picks this up immediately.`,
);
