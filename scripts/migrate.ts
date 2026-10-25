import { applySchema, openDatabase, resolveDbPath } from '../src/lib/db';

const file = resolveDbPath();
const db = openDatabase(file);
applySchema(db);
const tables = db
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
  .all() as Array<{ name: string }>;
console.log(`Applied schema to ${file}`);
console.log(`${tables.length} tables: ${tables.map((t) => t.name).join(', ')}`);
db.close();
