-- Run this in the Supabase SQL Editor to add the branch_overheads table
-- This stores monthly overhead expenses per branch for P&L calculations

CREATE TABLE IF NOT EXISTS branch_overheads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    branch TEXT NOT NULL,
    rent NUMERIC(12,2) DEFAULT 0,
    producer_amount NUMERIC(12,2) DEFAULT 0,
    ss_sm_amount NUMERIC(12,2) DEFAULT 0,
    utilities NUMERIC(12,2) DEFAULT 0,
    insurance NUMERIC(12,2) DEFAULT 0,
    other NUMERIC(12,2) DEFAULT 0,
    notes TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(branch)
);

ALTER TABLE branch_overheads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage branch_overheads"
    ON branch_overheads FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_branch_overheads_branch ON branch_overheads(branch);
