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

    // Add weight and price columns to schedules table
    await client.query(`
      ALTER TABLE schedules 
      ADD COLUMN IF NOT EXISTS weight DECIMAL(5,2) DEFAULT 1.0
    `);
    console.log('✅ Added weight column to schedules');

    await client.query(`
      ALTER TABLE schedules 
      ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) DEFAULT 0
    `);
    console.log('✅ Added price column to schedules');

    // Create pricing table
    await client.query(`
      CREATE TABLE IF NOT EXISTS waste_pricing (
        id SERIAL PRIMARY KEY,
        waste_type VARCHAR(50) NOT NULL UNIQUE,
        price_per_kg DECIMAL(10,2) NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Created waste_pricing table');

    // Insert pricing rules
    await client.query(`
      INSERT INTO waste_pricing (waste_type, price_per_kg, description) VALUES
      ('Household Waste', 2.50, 'General household garbage'),
      ('Bulky Waste', 5.00, 'Large items like furniture'),
      ('Recyclable Waste', 1.50, 'Paper, plastic, metal'),
      ('Electronic Waste', 10.00, 'Old electronics and appliances')
      ON CONFLICT (waste_type) DO NOTHING
    `);
    console.log('✅ Inserted pricing rules');

    console.log('\n✨ Migration completed successfully!');
  } catch (err) {
    console.error('❌ Migration error:', err);
  } finally {
    await client.release();
    await pool.end();
  }
}

runMigration();
