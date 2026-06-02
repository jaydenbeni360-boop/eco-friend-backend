-- Add weight and price columns to schedules table
ALTER TABLE schedules ADD COLUMN weight DECIMAL(5,2) DEFAULT 1.0;
ALTER TABLE schedules ADD COLUMN price DECIMAL(10,2) DEFAULT 0;

-- Create pricing table for waste types
CREATE TABLE IF NOT EXISTS waste_pricing (
  id SERIAL PRIMARY KEY,
  waste_type VARCHAR(50) NOT NULL UNIQUE,
  price_per_kg DECIMAL(10,2) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert default pricing rules
INSERT INTO waste_pricing (waste_type, price_per_kg, description) VALUES
('Household Waste', 2.50, 'General household garbage'),
('Bulky Waste', 5.00, 'Large items like furniture'),
('Recyclable Waste', 1.50, 'Paper, plastic, metal'),
('Electronic Waste', 10.00, 'Old electronics and appliances')
ON CONFLICT (waste_type) DO NOTHING;
