import pkg from 'pg';
import fs from 'fs';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL environment variable before running this script');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function insertRows(table, rows) {
  if (!rows || rows.length === 0) return 0;
  const keys = Object.keys(rows[0]);
  const columns = keys.map(k => `"${k}"`).join(', ');
  let inserted = 0;
  for (const row of rows) {
    const vals = keys.map(k => row[k]);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO "${table}" (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;
    try {
      await pool.query(sql, vals);
      inserted++;
    } catch (err) {
      console.error('Insert error', table, err.message || err);
    }
  }
  return inserted;
}

async function resetSeqIfNeeded(table) {
  try {
    const seqRes = await pool.query(`SELECT pg_get_serial_sequence($1,'id') as seq`, [table]);
    const seq = seqRes.rows[0]?.seq;
    if (!seq) return;
    const maxRes = await pool.query(`SELECT MAX(id) as maxid FROM "${table}"`);
    const maxid = maxRes.rows[0].maxid || 0;
    await pool.query(`SELECT setval($1, $2, true)`, [seq, maxid]);
    console.log(`Sequence for ${table} set to ${maxid}`);
  } catch (err) {
    // ignore non-critical
  }
}

(async () => {
  try {
    console.log('Reading backups folder...');
    const files = await fs.promises.readdir('backups');
    const order = ['users.json','waste_pricing.json','schedules.json','pickups.json'];
    for (const name of order) {
      if (!files.includes(name)) {
        console.log(`Skipping missing ${name}`);
        continue;
      }
      const raw = await fs.promises.readFile(`backups/${name}`, 'utf8');
      const rows = JSON.parse(raw);
      const table = name.replace('.json','');
      console.log(`Inserting ${rows.length} rows into ${table}...`);
      const n = await insertRows(table, rows);
      console.log(`Inserted ${n} rows into ${table}`);
      await resetSeqIfNeeded(table);
    }
    console.log('Restore complete.');
  } catch (err) {
    console.error('Restore error:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
