CREATE DATABASE IF NOT EXISTS eco_friend;
USE eco_friend;

-- Users table (including admin flag)
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Schedules table
CREATE TABLE IF NOT EXISTS schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  date DATE NOT NULL,
  time TIME NOT NULL,
  waste_type VARCHAR(50) NOT NULL,
  address TEXT NOT NULL,
  status ENUM('Upcoming','Completed') NOT NULL DEFAULT 'Upcoming',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Pickups (logs) table
CREATE TABLE IF NOT EXISTS pickups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  type VARCHAR(50) NOT NULL,
  weight DECIMAL(5,2) NOT NULL,
  points INT NOT NULL,
  collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Insert default admin user (hash will be generated at runtime, placeholder used here)
INSERT INTO users (name, email, password_hash, is_admin) VALUES
('Admin', 'ecofriendadmin@gmail.com', '$2b$10$TwGuWtIblzsbQtuicDnF/.5oOtKP5cHoImTN9T.rWYrK.BWuZ2u56', TRUE);
