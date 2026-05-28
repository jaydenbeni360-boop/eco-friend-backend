import pkg from 'pg';
const { Pool } = pkg;
import fs from 'fs';

const pool = new Pool({
  connectionString: 'postgresql://ecofriend_arc8_user:ZPTmT1Z8B7PbNWwTsVKjLEKbSgANpdzc@dpg-d8c25osp3tds73athcn0-a.virginia-postgres.render.com/ecofriend_arc8',
  ssl: { rejectUnauthorized: false }
});

const schema = fs.readFileSync('./schema_postgres.sql', 'utf8');

(async () => {
  try {
    await pool.query(schema);
    console.log('✅ Database tables created successfully!');
    await pool.end();
  } catch (err) {
    console.error('❌ Error creating tables:', err.message);
    await pool.end();
    process.exit(1);
  }
})();
