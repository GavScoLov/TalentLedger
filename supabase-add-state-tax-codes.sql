-- Run this in the Supabase SQL Editor to create the state_tax_codes table

CREATE TABLE IF NOT EXISTS state_tax_codes (
    id BIGSERIAL PRIMARY KEY,
    state TEXT NOT NULL,
    county_name TEXT NOT NULL DEFAULT '',
    city_name TEXT NOT NULL DEFAULT '',
    county_code TEXT NOT NULL DEFAULT '',
    jurisdiction_code TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups by state + county name
CREATE INDEX IF NOT EXISTS idx_state_tax_codes_state ON state_tax_codes (state);
CREATE INDEX IF NOT EXISTS idx_state_tax_codes_county ON state_tax_codes (state, county_name);
CREATE INDEX IF NOT EXISTS idx_state_tax_codes_zip ON state_tax_codes (state, zip);

-- If table already exists, run:
-- ALTER TABLE state_tax_codes ADD COLUMN IF NOT EXISTS zip TEXT NOT NULL DEFAULT '';

-- Enable Row Level Security
ALTER TABLE state_tax_codes ENABLE ROW LEVEL SECURITY;

-- Allow all operations for authenticated users
CREATE POLICY "Allow all for authenticated users" ON state_tax_codes
    FOR ALL
    USING (true)
    WITH CHECK (true);
