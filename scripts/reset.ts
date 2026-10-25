import fs from 'node:fs';
import { applySchema, openDatabase, resolveDbPath } from '../src/lib/db';
import { clearAll, seed } from '../src/lib/db/seed';

const file = resolveDbPath();
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  const path = `${file}${suffix}`;
  if (fs.existsSync(path)) {
    fs.rmSync(path);
    console.log(`removed ${path}`);
  }
}
const db = openDatabase(file);
applySchema(db);
clearAll(db);
seed(db);
console.log(`Reset complete: ${file} rebuilt and reseeded.`);
db.close();
