const Database = require('better-sqlite3');
const path = 'D:/FlowTix-Data/egypt db/Iraq.db';
const db = new Database(path, { readonly: true });

const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('Iraq Tables:', tables.map(t => t.name));

const tName = tables.find(t => t.name === 'data')?.name || tables[0]?.name;
if (tName) {
  const cols = db.prepare(`PRAGMA table_info("${tName}")`).all();
  console.log('Columns:', cols.map(c => c.name));
  try {
    const testId = '61592151762380';
    const found = db.prepare(`SELECT * FROM "${tName}" WHERE FBID = ? LIMIT 1`).get(testId);
    console.log('Test lookup:', found ? 'FOUND' : 'NOT FOUND');
  } catch (e) {
    console.log('Lookup error:', e.message);
  }
  const integrity = db.prepare("PRAGMA integrity_check").get();
  console.log('Integrity:', JSON.stringify(integrity).substring(0, 200));
}
db.close();

db.close();
