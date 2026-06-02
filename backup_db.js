import pkg from 'pg';
import fs from 'fs';

const { Pool } = pkg;

const DATABASE_URL = 'postgresql://ecofriend_arc8_user:ZPTmT1Z8B7PbNWwTsVKjLEKbSgANpdzc@dpg-d8c25osp3tds73athcn0-a.virginia-postgres.render.com/ecofriend_arc8';

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

(async () => {
  try {
    await fs.promises.mkdir('backups', { recursive: true });
    console.log('Fetching table list...');
    const tablesRes = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema='public' AND table_type='BASE TABLE'
    `);
    const tables = tablesRes.rows.map(r => r.table_name);
    const manifest = { generated_at: new Date().toISOString(), tables: {} };

    for (const t of tables) {
      console.log(`Backing up table: ${t}`);
      const res = await pool.query(`SELECT * FROM "${t}"`);
      const file = `backups/${t}.json`;
      await fs.promises.writeFile(file, JSON.stringify(res.rows, null, 2));
      manifest.tables[t] = { rows: res.rowCount, file };
    }

    console.log('Saving schema info...');
    const schemaRes = await pool.query(`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema='public'
      ORDER BY table_name, ordinal_position
    `);
    await fs.promises.writeFile('backups/schema.json', JSON.stringify(schemaRes.rows, null, 2));
    await fs.promises.writeFile('backups/manifest.json', JSON.stringify(manifest, null, 2));

    console.log('✅ Backup completed. Files are in backend/backups/');
  } catch (err) {
    console.error('Backup error:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
