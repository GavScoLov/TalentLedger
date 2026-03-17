-- Run this in the Supabase SQL Editor to create tables for the Commission page
-- Dashboard: https://supabase.com/dashboard → Your Project → SQL Editor

-- Producers table
CREATE TABLE IF NOT EXISTS producers (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Persistent company list (grows over time as new companies appear in API data)
CREATE TABLE IF NOT EXISTS companies (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_name TEXT NOT NULL,
    branch TEXT NOT NULL,
    is_dhp BOOLEAN DEFAULT false,
    first_seen TIMESTAMPTZ DEFAULT now(),
    UNIQUE(company_name, branch)
);

-- Producer commission assignments (% per company per branch)
CREATE TABLE IF NOT EXISTS producer_commissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    producer_id UUID NOT NULL REFERENCES producers(id) ON DELETE CASCADE,
    company_name TEXT NOT NULL,
    branch TEXT NOT NULL,
    dhp_pct NUMERIC(5,2) DEFAULT 0,
    gsp_pct NUMERIC(5,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(producer_id, company_name, branch)
);

-- Enable Row Level Security
ALTER TABLE producers ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE producer_commissions ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access
CREATE POLICY "Authenticated users can manage producers"
    ON producers FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can manage companies"
    ON companies FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

CREATE POLICY "Authenticated users can manage commissions"
    ON producer_commissions FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_commissions_producer ON producer_commissions(producer_id);
CREATE INDEX IF NOT EXISTS idx_commissions_branch ON producer_commissions(branch);
CREATE INDEX IF NOT EXISTS idx_companies_branch ON companies(branch);
