import pkg from 'pg';
import fs from 'fs';
const { Pool } = pkg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('Set DATABASE_URL environment variable before running this script');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    console.log('Reading db_schema.sql...');
      // prefer Postgres schema if available
      let sql = null;
      if (await fs.promises.stat('schema_postgres.sql').then(() => true).catch(() => false)) {
        sql = await fs.promises.readFile('schema_postgres.sql', 'utf8');
      } else if (await fs.promises.stat('../schema_postgres.sql').then(() => true).catch(() => false)) {
        sql = await fs.promises.readFile('../schema_postgres.sql', 'utf8');
      } else {
        sql = await fs.promises.readFile('../db_schema.sql', 'utf8').catch(() => fs.promises.readFile('db_schema.sql', 'utf8'));
      }
    console.log('Applying schema...');
    await pool.query(sql);
    console.log('Schema applied successfully');
  } catch (err) {
    console.error('Schema apply error:', err.message || err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
