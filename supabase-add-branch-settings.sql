CREATE TABLE IF NOT EXISTS branch_settings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    branch TEXT NOT NULL,
    acronym TEXT DEFAULT '',
    address TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(branch)
);

ALTER TABLE branch_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage branch_settings"
    ON branch_settings FOR ALL TO authenticated
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_branch_settings_branch ON branch_settings(branch);
