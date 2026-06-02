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
    console.log('🔄 Running migration...');

    // Add phone to users
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS phone VARCHAR(30)
    `);
    console.log('✅ Added phone column to users');

    // Add payment fields to schedules
    await client.query(`
      ALTER TABLE schedules 
      ADD COLUMN IF NOT EXISTS amount_due DECIMAL(10,2) DEFAULT 0
    `);
    console.log('✅ Added amount_due column to schedules');

    await client.query(`
      ALTER TABLE schedules 
      ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'none'
    `);
    console.log('✅ Added payment_status column to schedules');

    console.log('\n✨ Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration error:', err);
  } finally {
    await client.release();
    await pool.end();
  }
}

runMigration();
