-- Run this in the Supabase SQL Editor to add the companies table
-- (Run AFTER supabase-setup.sql which created producers & producer_commissions)
-- Dashboard: https://supabase.com/dashboard → Your Project → SQL Editor

-- Persistent company list (grows over time as new companies appear in API data)
CREATE TABLE IF NOT EXISTS companies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_name TEXT NOT NULL,
    branch TEXT NOT NULL,
    is_dhp BOOLEAN DEFAULT false,
    first_seen TIMESTAMPTZ DEFAULT now(),
    UNIQUE(company_name, branch)
);

-- Enable Row Level Security
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Authenticated users can manage companies"
    ON companies FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_companies_branch ON companies(branch);
