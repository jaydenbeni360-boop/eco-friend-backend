import pkg from 'pg';
const { Pool } = pkg;

const DATABASE_URL = 'postgresql://ecofriend_arc8_user:ZPTmT1Z8B7PbNWwTsVKjLEKbSgANpdzc@dpg-d8c25osp3tds73athcn0-a.virginia-postgres.render.com/ecofriend_arc8';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migration to add location fields...');

    // Add latitude and longitude to schedules
    await client.query(`
      ALTER TABLE schedules 
      ADD COLUMN IF NOT EXISTS latitude DECIMAL(10, 8)
    `);
    console.log('✅ Added latitude column to schedules');

    await client.query(`
      ALTER TABLE schedules 
      ADD COLUMN IF NOT EXISTS longitude DECIMAL(11, 8)
    `);
    console.log('✅ Added longitude column to schedules');

    // Add house_number to schedules
    await client.query(`
      ALTER TABLE schedules 
      ADD COLUMN IF NOT EXISTS house_number VARCHAR(50)
    `);
    console.log('✅ Added house_number column to schedules');

    console.log('\n✨ Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration error:', err);
  } finally {
    await client.release();
    await pool.end();
  }
}

runMigration();
