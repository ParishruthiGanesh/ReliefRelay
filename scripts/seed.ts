import { applySchema, openDatabase, resolveDbPath } from '../src/lib/db';
import { clearAll, seed } from '../src/lib/db/seed';

const file = resolveDbPath();
const db = openDatabase(file);
applySchema(db);
clearAll(db);
const result = seed(db);

console.log(`Seeded ${file} with fictional Riverbend District data.\n`);
console.log('Demonstration accounts (all fictional):');
for (const a of result.accounts) {
  console.log(`  ${a.email.padEnd(32)} ${a.password.padEnd(18)} ${a.role}`);
}
console.log('\nPublic users need no account. Open http://localhost:3000 to start.');
db.close();
