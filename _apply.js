const { Client } = require('pg');
const sql = process.argv[2];
const url = process.argv[3];
(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query(sql);
  await c.end();
  console.log('OK');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
