-- TalentLedger: Add Roster Tracker tables (prefixed with roster_)
-- Run this in your Supabase SQL Editor

-- ============================================================
-- 1. ROSTER COMPANY DATA TABLE (recruitment metrics)
-- ============================================================
create table if not exists roster_company_data (
  id serial primary key,
  company text default 'TRC',
  week integer not null,
  date date,
  open_order integer default 0,
  scheduled integer default 0,
  interviewed integer default 0,
  accepted integer default 0,
  rom integer default 0,
  car integer default 0,
  aus integer default 0,
  created_at timestamptz default now()
);

-- ============================================================
-- 2. ROSTER COMPANIES TABLE
-- ============================================================
create table if not exists roster_companies (
  id serial primary key,
  name text unique not null,
  slug text unique not null,
  created_at timestamptz default now()
);

-- ============================================================
-- 3. ROSTER USER-COMPANY ASSIGNMENTS (many-to-many)
-- ============================================================
create table if not exists roster_user_companies (
  id serial primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  company_id integer references roster_companies(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, company_id)
);

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================
alter table roster_company_data enable row level security;
alter table roster_companies enable row level security;
alter table roster_user_companies enable row level security;

-- Company Data RLS
create policy "Authenticated users can view roster_company_data" on roster_company_data for select to authenticated using (true);
create policy "Authenticated users can insert roster_company_data" on roster_company_data for insert to authenticated with check (true);
create policy "Authenticated users can update roster_company_data" on roster_company_data for update to authenticated using (true);
create policy "Authenticated users can delete roster_company_data" on roster_company_data for delete to authenticated using (true);

-- Companies RLS
create policy "Authenticated users can view roster_companies" on roster_companies for select to authenticated using (true);
create policy "Admins can insert roster_companies" on roster_companies for insert to authenticated
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Admins can update roster_companies" on roster_companies for update to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Admins can delete roster_companies" on roster_companies for delete to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- User-Companies RLS
create policy "Authenticated users can view roster_user_companies" on roster_user_companies for select to authenticated using (true);
create policy "Admins can insert roster_user_companies" on roster_user_companies for insert to authenticated
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Admins can delete roster_user_companies" on roster_user_companies for delete to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- SEED: Default Company
-- ============================================================
insert into roster_companies (name, slug) values ('TRC', 'trc')
on conflict (name) do nothing;
