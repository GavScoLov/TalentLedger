-- ============================================================
-- Add: report_email_automations table
-- Run in: Supabase Dashboard → SQL Editor
-- https://supabase.com/dashboard/project/txhyfogbyzwueazhrqax/sql
-- ============================================================

CREATE TABLE IF NOT EXISTS report_email_automations (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  name          text        NOT NULL,
  report_keys   text[]      NOT NULL DEFAULT '{}',
  recipients    jsonb       NOT NULL DEFAULT '[]',
  -- recipients format:
  --   [{ "type": "user"|"custom", "id": "<uuid>"|null, "email": "...", "name": "..." }]
  frequency     text        NOT NULL DEFAULT 'weekly'
                            CHECK (frequency IN ('once','daily','weekly','monthly')),
  schedule_days int[]       NOT NULL DEFAULT '{}',
  -- weekly:  day-of-week numbers  (0=Sun … 6=Sat)
  -- monthly: day-of-month numbers (1 … 28)
  -- once:    empty (use schedule_date instead)
  schedule_date date,                      -- used when frequency = 'once'
  schedule_time text        NOT NULL DEFAULT '09:00',   -- HH:MM
  schedule_tz   text        NOT NULL DEFAULT 'America/Chicago',
  is_active     boolean     NOT NULL DEFAULT true,
  last_sent_at  timestamptz,
  created_by    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE report_email_automations ENABLE ROW LEVEL SECURITY;

-- Only admins can manage automations
CREATE POLICY "Admins manage report email automations"
  ON report_email_automations FOR ALL
  TO authenticated
  USING  (get_my_role() IN ('super_admin','admin'))
  WITH CHECK (get_my_role() IN ('super_admin','admin'));
