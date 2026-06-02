import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function initDB() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL database successfully.');
  } catch (err) {
    console.error('❌ Could not connect to PostgreSQL database:', err.message);
    process.exit(1);
  }
}

// ─── AUTHENTICATION MIDDLEWARE ────────────────────────────────────────────────
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ message: 'Access token required' });
  
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// ─── ROUTE: REGISTER ──────────────────────────────────────────────────────────
app.post('/api/register', async (req, res) => {
  const { name, email, password, phone } = req.body;
  if (!name || !email || !password || !phone) {
    return res.status(400).json({ message: 'Name, email, password, and phone are required' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    // Check if user exists
    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (rows.length > 0) {
      return res.status(400).json({ message: 'Email already registered' });
    }

    // Insert new user
    const insertResult = await pool.query(
      'INSERT INTO users (name, email, password_hash, phone) VALUES ($1, $2, $3, $4) RETURNING id',
      [name, email, passwordHash, phone]
    );
    const userId = insertResult.rows[0].id;
    const token = jwt.sign({ id: userId, name, email, phone }, JWT_SECRET, { expiresIn: '24h' });
    return res.status(201).json({ token, user: { id: userId, name, email, phone } });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: LOGIN ─────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ message: 'Email and password are required' });
  }

  try {
    let user = null;

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (rows.length > 0) {
      user = rows[0];
    }

    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const isAdmin = !!user.is_admin || user.email === 'ecofriendadmin@gmail.com';
    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, phone: user.phone, is_admin: isAdmin }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, is_admin: isAdmin } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: SET PAYMENT AMOUNT (Admin) ────────────────────────────────────────
app.put('/api/schedules/:id/payment', authenticateToken, async (req, res) => {
  const { amount_due, payment_status } = req.body;
  const scheduleId = req.params.id;
  try {
    await pool.query(
      'UPDATE schedules SET amount_due = $1, payment_status = $2 WHERE id = $3',
      [amount_due || 0, payment_status || 'pending', scheduleId]
    );
    res.json({ message: 'Payment details updated' });
  } catch (err) {
    console.error('Update payment error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: GET SCHEDULES ──────────────────────────────────────────────────────
app.get('/api/schedules', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.email === 'ecofriendadmin@gmail.com';
    
    if (isAdmin) {
      const { rows } = await pool.query(`
        SELECT schedules.*, users.name as user_name, users.email as user_email, users.phone as user_phone 
        FROM schedules 
        JOIN users ON schedules.user_id = users.id 
        ORDER BY schedules.date DESC
      `);
      res.json(rows);
    } else {
      const { rows } = await pool.query('SELECT * FROM schedules WHERE user_id = $1 ORDER BY date DESC', [req.user.id]);
      res.json(rows);
    }
  } catch (err) {
    console.error('Fetch schedules error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: UPDATE SCHEDULE (MARK COMPLETED) ───────────────────────────────────
app.put('/api/schedules/:id/complete', authenticateToken, async (req, res) => {
  const scheduleId = req.params.id;
  try {
    await pool.query('UPDATE schedules SET status = $1 WHERE id = $2', ['Completed', scheduleId]);
    res.json({ message: 'Schedule updated to completed' });
  } catch (err) {
    console.error('Update schedule error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: POST SCHEDULE ──────────────────────────────────────────────────────
app.post('/api/schedules', authenticateToken, async (req, res) => {
  const { date, time, waste_type, weight = 1.0, price = 0, address } = req.body;
  if (!date || !time || !waste_type || !weight) {
    return res.status(400).json({ message: 'Date, time, waste type, and weight are required' });
  }

  try {
    const insertResult = await pool.query(
      'INSERT INTO schedules (user_id, date, time, waste_type, weight, price, address) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [req.user.id, date, time, waste_type, weight, price, address || 'User provided address']
    );
    const schedule = insertResult.rows[0];
    res.status(201).json({ 
      id: schedule.id, 
      user_id: schedule.user_id, 
      date, 
      time, 
      waste_type, 
      weight,
      price,
      address: schedule.address,
      status: 'Upcoming' 
    });
  } catch (err) {
    console.error('Post schedule error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: GET PICKUPS ────────────────────────────────────────────────────────
app.get('/api/pickups', authenticateToken, async (req, res) => {
  try {
    const isAdmin = req.user.email === 'ecofriendadmin@gmail.com';
    
    if (isAdmin) {
      const { rows } = await pool.query(`
        SELECT pickups.*, users.name as user_name, users.email as user_email 
        FROM pickups 
        JOIN users ON pickups.user_id = users.id 
        ORDER BY pickups.collected_at DESC
      `);
      res.json(rows);
    } else {
      const { rows } = await pool.query('SELECT * FROM pickups WHERE user_id = $1 ORDER BY collected_at DESC', [req.user.id]);
      res.json(rows);
    }
  } catch (err) {
    console.error('Fetch pickups error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: POST PICKUP ────────────────────────────────────────────────────────
app.post('/api/pickups', authenticateToken, async (req, res) => {
  const { type, weight, points } = req.body;
  if (!type || !weight || points === undefined) {
    return res.status(400).json({ message: 'Pickup details are required' });
  }

  try {
    // Convert weight string like '4.2kg' to a float 4.2
    const weightVal = typeof weight === 'string' ? parseFloat(weight) : weight;

    const insertResult = await pool.query(
      'INSERT INTO pickups (user_id, type, weight, points) VALUES ($1, $2, $3, $4) RETURNING id',
      [req.user.id, type, weightVal, points]
    );
    res.status(201).json({ id: insertResult.rows[0].id, user_id: req.user.id, type, weight: weightVal, points });
  } catch (err) {
    console.error('Post pickup error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Start Express App
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Eco Friend backend server running on port ${PORT}`);
  });
});
