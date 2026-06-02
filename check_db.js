import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: 'postgresql://ecofriend_arc8_user:ZPTmT1Z8B7PbNWwTsVKjLEKbSgANpdzc@dpg-d8c25osp3tds73athcn0-a.virginia-postgres.render.com/ecofriend_arc8',
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    console.log('--- USERS COLUMNS ---');
    const usersCol = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'users';");
    console.log(usersCol.rows);

    console.log('--- SCHEDULES COLUMNS ---');
    const schedCol = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'schedules';");
    console.log(schedCol.rows);

    await pool.end();
  } catch (err) {
    console.error('Error:', err);
    await pool.end();
  }
}

check();
