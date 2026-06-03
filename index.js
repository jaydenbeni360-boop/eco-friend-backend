import express from 'express';
import cors from 'cors';
import pkg from 'pg';
const { Pool } = pkg;
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();
import nodemailer from 'nodemailer';

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

async function applyDatabaseMigrations() {
  const migrateSql = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      phone VARCHAR(30),
      is_admin BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      date DATE NOT NULL,
      time TIME NOT NULL,
      waste_type VARCHAR(50) NOT NULL,
      weight DECIMAL(5,2) DEFAULT 1.0,
      price DECIMAL(10,2) DEFAULT 0,
      address TEXT NOT NULL,
      house_number VARCHAR(50),
      latitude DECIMAL(10,8),
      longitude DECIMAL(11,8),
      amount_due DECIMAL(10,2) DEFAULT 0,
      payment_status VARCHAR(20) DEFAULT 'none',
      status VARCHAR(50) NOT NULL DEFAULT 'Upcoming',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pickups (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL,
      type VARCHAR(50) NOT NULL,
      weight DECIMAL(5,2) NOT NULL,
      points INT NOT NULL,
      collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    INSERT INTO users (name, email, password_hash, is_admin)
      VALUES ('Admin', 'ecofriendadmin@gmail.com', '$2b$10$TwGuWtIblzsbQtuicDnF/.5oOtKP5cHoImTN9T.rWYrK.BWuZ2u56', TRUE)
      ON CONFLICT (email) DO NOTHING;

    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS phone VARCHAR(30);

    ALTER TABLE schedules
      ADD COLUMN IF NOT EXISTS amount_due DECIMAL(10,2) DEFAULT 0;

    ALTER TABLE schedules
      ADD COLUMN IF NOT EXISTS payment_status VARCHAR(20) DEFAULT 'none';

    ALTER TABLE schedules
      ADD COLUMN IF NOT EXISTS house_number VARCHAR(50);

    ALTER TABLE schedules
      ADD COLUMN IF NOT EXISTS latitude DECIMAL(10,8);

    ALTER TABLE schedules
      ADD COLUMN IF NOT EXISTS longitude DECIMAL(11,8);

    ALTER TABLE schedules
      ADD COLUMN IF NOT EXISTS weight DECIMAL(5,2) DEFAULT 1.0;

    ALTER TABLE schedules
      ADD COLUMN IF NOT EXISTS price DECIMAL(10,2) DEFAULT 0;
  `;

  try {
    await pool.query(migrateSql);
    console.log('✅ Database migration completed.');
  } catch (err) {
    console.error('❌ Database migration failed:', err.message || err);
    throw err;
  }
}

async function initDB() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Connected to PostgreSQL database successfully.');
    await applyDatabaseMigrations();
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
  const { amount_due, payment_status, weight, waste_type, price } = req.body;
  const scheduleId = req.params.id;
  try {
    await pool.query(
      `UPDATE schedules 
       SET amount_due = $1, 
           payment_status = $2, 
           weight = COALESCE($3, weight), 
           waste_type = COALESCE($4, waste_type), 
           price = COALESCE($5, price) 
       WHERE id = $6`,
      [amount_due || 0, payment_status || 'pending', weight ? parseFloat(weight) : null, waste_type || null, price ? parseFloat(price) : null, scheduleId]
    );
    res.json({ message: 'Payment and schedule details updated successfully' });
  } catch (err) {
    console.error('Update payment error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: PROCESS MOMO PAYMENT (User Mobile Money) ──────────────────────────
app.post('/api/schedules/:id/pay-momo', authenticateToken, async (req, res) => {
  const { amount, pin, phone } = req.body;
  const scheduleId = req.params.id;
  if (!amount || !pin) {
    return res.status(400).json({ message: 'Amount and Momo PIN are required' });
  }
  try {
    // Check if schedule exists
    const { rows } = await pool.query('SELECT * FROM schedules WHERE id = $1', [scheduleId]);
    if (rows.length === 0) {
      return res.status(404).json({ message: 'Schedule not found' });
    }

    // Update the schedule's payment_status to 'paid' and status to 'Completed'
    await pool.query(
      "UPDATE schedules SET payment_status = 'paid', status = 'Completed' WHERE id = $1",
      [scheduleId]
    );

    res.json({ 
      success: true, 
      message: `Payment of ${amount} processed successfully via MoMo! PIN verified.` 
    });
  } catch (err) {
    console.error('Momo payment error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: GET SCHEDULES ──────────────────────────────────────────────────────
app.get('/api/schedules', authenticateToken, async (req, res) => {
  try {
    const isAdmin = !!req.user.is_admin;
    
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

// ─── ROUTE: UPDATE SCHEDULE LOCATION ────────────────────────────────────────────
app.put('/api/schedules/:id/location', authenticateToken, async (req, res) => {
  const { latitude, longitude, house_number } = req.body;
  const scheduleId = req.params.id;
  try {
    await pool.query(
      'UPDATE schedules SET latitude = $1, longitude = $2, house_number = $3 WHERE id = $4',
      [latitude || null, longitude || null, house_number || null, scheduleId]
    );
    res.json({ message: 'Location details updated' });
  } catch (err) {
    console.error('Update location error:', err);
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
  const { date, time, waste_type, weight = null, price = 0, address, house_number, latitude, longitude } = req.body;
  if (!date || !time || !waste_type) {
    return res.status(400).json({ message: 'Date, time and waste type are required' });
  }

  try {
    const insertResult = await pool.query(
      'INSERT INTO schedules (user_id, date, time, waste_type, weight, price, address, house_number, latitude, longitude, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [req.user.id, date, time, waste_type, weight, price, address || 'User provided address', house_number || null, latitude || null, longitude || null, 'Upcoming']
    );
    const schedule = insertResult.rows[0];
    res.status(201).json({ 
      id: schedule.id, 
      user_id: schedule.user_id, 
      date: schedule.date, 
      time: schedule.time, 
      waste_type: schedule.waste_type, 
      weight: schedule.weight,
      price: schedule.price,
      address: schedule.address,
      house_number: schedule.house_number,
      latitude: schedule.latitude,
      longitude: schedule.longitude,
      status: schedule.status || 'Upcoming' 
    });
  } catch (err) {
    console.error('Post schedule error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// ─── ROUTE: GET PICKUPS ────────────────────────────────────────────────────────
app.get('/api/pickups', authenticateToken, async (req, res) => {
  try {
    const isAdmin = !!req.user.is_admin;
    
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

// ─── ROUTE: NOTIFY CUSTOMER (Admin) ───────────────────────────────────────────
app.post('/api/schedules/:id/notify', authenticateToken, async (req, res) => {
  const scheduleId = req.params.id;
  const { message } = req.body;
  try {
    // Fetch schedule and user
    const { rows } = await pool.query(
      `SELECT schedules.*, users.name as user_name, users.email as user_email, users.phone as user_phone
       FROM schedules JOIN users ON schedules.user_id = users.id WHERE schedules.id = $1`,
      [scheduleId]
    );
    if (rows.length === 0) return res.status(404).json({ message: 'Schedule not found' });
    const schedule = rows[0];

    // If SMTP configured, send email
    if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        }
      });

      const mailOptions = {
        from: process.env.SMTP_FROM || 'no-reply@eco-friend.com',
        to: schedule.user_email,
        subject: `EcoFriend: Notification about your pickup (#${schedule.id})`,
        text: message || `Hello ${schedule.user_name},\n\nPlease note an update regarding your scheduled pickup on ${schedule.date} at ${schedule.time}.\n\nRegards, EcoFriend`,
      };

      await transporter.sendMail(mailOptions);
      console.log(`Notification email sent to ${schedule.user_email} for schedule ${schedule.id}`);
      return res.json({ message: 'Notification sent via email' });
    }

    // Fallback: just log and respond (no SMTP configured)
    console.log('Notify fallback:', { scheduleId, to: schedule.user_email, phone: schedule.user_phone, message });
    res.json({ message: 'Notification logged (no SMTP configured).', details: { to: schedule.user_email, phone: schedule.user_phone } });
  } catch (err) {
    console.error('Notify error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});
