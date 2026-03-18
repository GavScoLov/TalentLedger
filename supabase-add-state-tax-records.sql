-- Run this in the Supabase SQL Editor to create the state_tax_records table
-- This stores the processed CSV data with county lookup results

CREATE TABLE IF NOT EXISTS state_tax_records (
    id BIGSERIAL PRIMARY KEY,
    batch_id TEXT NOT NULL,
    batch_name TEXT DEFAULT '',
    uploaded_by TEXT DEFAULT '',
    company TEXT DEFAULT '',
    country TEXT DEFAULT '',
    city TEXT DEFAULT '',
    state TEXT NOT NULL DEFAULT '',
    zip TEXT DEFAULT '',
    county_name TEXT DEFAULT '',
    county_code TEXT DEFAULT '',
    jurisdiction_code TEXT DEFAULT '',
    total_sales NUMERIC(12,2) DEFAULT 0,
    net_sales NUMERIC(12,2) DEFAULT 0,
    taxes NUMERIC(12,2) DEFAULT 0,
    shipping_charges NUMERIC(12,2) DEFAULT 0,
    extra_data JSONB DEFAULT '{}',
    archived BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast filtering and grouping
CREATE INDEX IF NOT EXISTS idx_str_state ON state_tax_records (state);
CREATE INDEX IF NOT EXISTS idx_str_batch ON state_tax_records (batch_id);
CREATE INDEX IF NOT EXISTS idx_str_county_code ON state_tax_records (county_code);

-- Enable Row Level Security
ALTER TABLE state_tax_records ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all for authenticated users" ON state_tax_records
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- If you already created the table, run these ALTER statements instead:
-- ALTER TABLE state_tax_records RENAME COLUMN address TO country;
-- ALTER TABLE state_tax_records ADD COLUMN IF NOT EXISTS uploaded_by TEXT DEFAULT '';
-- ALTER TABLE state_tax_records ADD COLUMN IF NOT EXISTS total_sales NUMERIC(12,2) DEFAULT 0;
-- ALTER TABLE state_tax_records ADD COLUMN IF NOT EXISTS net_sales NUMERIC(12,2) DEFAULT 0;
-- ALTER TABLE state_tax_records ADD COLUMN IF NOT EXISTS taxes NUMERIC(12,2) DEFAULT 0;
-- ALTER TABLE state_tax_records ADD COLUMN IF NOT EXISTS shipping_charges NUMERIC(12,2) DEFAULT 0;
-- ALTER TABLE state_tax_records ADD COLUMN IF NOT EXISTS batch_name TEXT DEFAULT '';
-- ALTER TABLE state_tax_records ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;
