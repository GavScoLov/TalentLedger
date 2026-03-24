-- ═══════════════════════════════════════════════════════════════
-- TimeTracker Tables
-- Run this in the Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

-- Employers (client companies)
CREATE TABLE IF NOT EXISTS time_employers (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    contact_name TEXT DEFAULT '',
    contact_email TEXT DEFAULT '',
    contact_phone TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Work locations (each location gets daily QR codes)
CREATE TABLE IF NOT EXISTS time_locations (
    id SERIAL PRIMARY KEY,
    employer_id INTEGER NOT NULL REFERENCES time_employers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    address TEXT DEFAULT '',
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    clock_in_time TIME DEFAULT '08:00',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Workers (managed by internal team)
CREATE TABLE IF NOT EXISTS time_workers (
    id SERIAL PRIMARY KEY,
    employee_id TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    employer_id INTEGER REFERENCES time_employers(id) ON DELETE SET NULL,
    location_id INTEGER REFERENCES time_locations(id) ON DELETE SET NULL,
    hourly_rate NUMERIC(10,2) DEFAULT 0,
    bill_rate NUMERIC(10,2) DEFAULT 0,
    device_fingerprint TEXT DEFAULT '',
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Daily QR codes (rotated each day)
CREATE TABLE IF NOT EXISTS time_qr_codes (
    id SERIAL PRIMARY KEY,
    location_id INTEGER NOT NULL REFERENCES time_locations(id) ON DELETE CASCADE,
    code TEXT NOT NULL UNIQUE,
    valid_date DATE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(location_id, valid_date)
);

-- Clock events (individual punch records)
CREATE TABLE IF NOT EXISTS time_punches (
    id SERIAL PRIMARY KEY,
    worker_id INTEGER NOT NULL REFERENCES time_workers(id) ON DELETE CASCADE,
    location_id INTEGER NOT NULL REFERENCES time_locations(id) ON DELETE CASCADE,
    qr_code_id INTEGER REFERENCES time_qr_codes(id) ON DELETE SET NULL,
    punch_type TEXT NOT NULL CHECK (punch_type IN ('clock_in', 'lunch_out', 'lunch_in', 'clock_out')),
    punch_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    device_fingerprint TEXT DEFAULT '',
    device_info TEXT DEFAULT '',
    device_mismatch BOOLEAN DEFAULT false,
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Weekly timesheets (aggregated from punches, reviewed by employer)
CREATE TABLE IF NOT EXISTS time_weekly (
    id SERIAL PRIMARY KEY,
    worker_id INTEGER NOT NULL REFERENCES time_workers(id) ON DELETE CASCADE,
    employer_id INTEGER NOT NULL REFERENCES time_employers(id) ON DELETE CASCADE,
    week_ending DATE NOT NULL,
    mon_hours NUMERIC(5,2) DEFAULT 0,
    tue_hours NUMERIC(5,2) DEFAULT 0,
    wed_hours NUMERIC(5,2) DEFAULT 0,
    thu_hours NUMERIC(5,2) DEFAULT 0,
    fri_hours NUMERIC(5,2) DEFAULT 0,
    sat_hours NUMERIC(5,2) DEFAULT 0,
    sun_hours NUMERIC(5,2) DEFAULT 0,
    reg_hours NUMERIC(5,2) DEFAULT 0,
    ot_hours NUMERIC(5,2) DEFAULT 0,
    total_hours NUMERIC(5,2) DEFAULT 0,
    hourly_rate NUMERIC(10,2) DEFAULT 0,
    bill_rate NUMERIC(10,2) DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'approved', 'rejected', 'edited')),
    employer_notes TEXT DEFAULT '',
    internal_notes TEXT DEFAULT '',
    submitted_at TIMESTAMPTZ,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(worker_id, week_ending)
);

-- ═══════════════════════════════════════════════════════════════
-- RLS Policies
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE time_employers ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_qr_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_weekly ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users full access (internal team)
CREATE POLICY "time_employers_all" ON time_employers FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "time_locations_all" ON time_locations FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "time_workers_all" ON time_workers FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "time_qr_codes_all" ON time_qr_codes FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "time_punches_all" ON time_punches FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "time_weekly_all" ON time_weekly FOR ALL USING (auth.role() = 'authenticated');

-- ═══════════════════════════════════════════════════════════════
-- Indexes
-- ═══════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_time_punches_worker ON time_punches(worker_id);
CREATE INDEX IF NOT EXISTS idx_time_punches_date ON time_punches(punch_time);
CREATE INDEX IF NOT EXISTS idx_time_weekly_week ON time_weekly(week_ending);
CREATE INDEX IF NOT EXISTS idx_time_weekly_status ON time_weekly(status);
CREATE INDEX IF NOT EXISTS idx_time_weekly_employer ON time_weekly(employer_id);
CREATE INDEX IF NOT EXISTS idx_time_workers_employer ON time_workers(employer_id);
CREATE INDEX IF NOT EXISTS idx_time_qr_codes_date ON time_qr_codes(valid_date);
