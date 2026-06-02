import pkg from 'pg';
import fs from 'fs';
import path from 'path';

const { Pool } = pkg;

// Use DATABASE_URL from env if provided, otherwise fallback to the URL passed in by the user
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://eco_friend_db_user:xZFsUdvk05BVNzj1QNwxN5auxFhPBBRw@dpg-d8fc00favr4c73a44ud0-a.virginia-postgres.render.com/eco_friend_db';

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function runSqlFile(filePath) {
  const sql = await fs.promises.readFile(filePath, 'utf8');
  // Split on semicolon followed by newline to avoid very large single queries; execute sequentially
  const statements = sql.split(/;\s*\n/).map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    try {
      await pool.query(stmt);
    } catch (err) {
      // log and continue (some statements may depend on preexisting state)
      console.warn('SQL statement error (continuing):', err.message.slice(0, 200));
    }
  }
}

async function insertRows(table, rows) {
  if (!rows || !rows.length) return 0;
  const cols = Object.keys(rows[0]);
  const colList = cols.map(c => `"${c}"`).join(', ');
  let inserted = 0;
  for (const r of rows) {
    const vals = cols.map(c => r[c]);
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');
    const q = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders})`;
    try {
      await pool.query(q, vals);
      inserted++;
    } catch (err) {
      console.warn(`Insert into ${table} failed:`, err.message.slice(0, 200));
    }
  }
  // reset sequence if id column exists
  try {
    const seqRes = await pool.query(`SELECT pg_get_serial_sequence($1, 'id') as seq`, [table]);
    const seqName = seqRes.rows[0] && seqRes.rows[0].seq;
    if (seqName) {
      const maxRes = await pool.query(`SELECT MAX(id) as max FROM "${table}"`);
      const maxId = maxRes.rows[0].max || 0;
      await pool.query(`ALTER SEQUENCE ${seqName} RESTART WITH ${Number(maxId) + 1}`);
    }
  } catch (err) {
    // ignore
  }
  return inserted;
}

async function main() {
  try {
    console.log('Using DATABASE_URL:', DATABASE_URL.replace(/:[^:@]+@/, ':*****@'));

    // Apply base schema if present
    const schemaPath = path.resolve('..', 'db_schema.sql');
    if (fs.existsSync(schemaPath)) {
      console.log('Applying db_schema.sql...');
      await runSqlFile(schemaPath);
    } else if (fs.existsSync('db_schema.sql')) {
      console.log('Applying db_schema.sql (local)...');
      await runSqlFile('db_schema.sql');
    } else {
      console.log('No db_schema.sql found in repo root; assuming schema exists.');
    }

    // Ensure backups folder exists
    const backupsDir = path.resolve('backups');
    if (!fs.existsSync(backupsDir)) {
      console.error('No backups directory found at backend/backups. Nothing to restore.');
      process.exit(1);
    }

    // Import order: users, waste_pricing, schedules, pickups
    const order = ['users', 'waste_pricing', 'schedules', 'pickups'];
    for (const t of order) {
      const f = path.join(backupsDir, `${t}.json`);
      if (!fs.existsSync(f)) {
        console.log(`Backup file not found for ${t}, skipping.`);
        continue;
      }
      const content = await fs.promises.readFile(f, 'utf8');
      const rows = JSON.parse(content);
      console.log(`Inserting ${rows.length} rows into ${t}...`);
      const count = await insertRows(t, rows);
      console.log(`Inserted ${count} rows into ${t}.`);
    }

    console.log('Restore finished.');
  } catch (err) {
    console.error('Restore error:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
