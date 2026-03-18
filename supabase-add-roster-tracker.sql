-- TalentLedger: Add Roster Tracker tables
-- Run this in your Supabase SQL Editor

-- ============================================================
-- 1. COMPANY DATA TABLE (recruitment metrics)
-- ============================================================
create table if not exists company_data (
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
-- 2. COMPANIES TABLE
-- ============================================================
create table if not exists companies (
  id serial primary key,
  name text unique not null,
  slug text unique not null,
  created_at timestamptz default now()
);

-- ============================================================
-- 3. USER-COMPANY ASSIGNMENTS (many-to-many)
-- ============================================================
create table if not exists user_companies (
  id serial primary key,
  user_id uuid references profiles(id) on delete cascade not null,
  company_id integer references companies(id) on delete cascade not null,
  created_at timestamptz default now(),
  unique(user_id, company_id)
);

-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================
alter table company_data enable row level security;
alter table companies enable row level security;
alter table user_companies enable row level security;

-- Company Data RLS
create policy "Authenticated users can view company_data" on company_data for select to authenticated using (true);
create policy "Authenticated users can insert company_data" on company_data for insert to authenticated with check (true);
create policy "Authenticated users can update company_data" on company_data for update to authenticated using (true);
create policy "Authenticated users can delete company_data" on company_data for delete to authenticated using (true);

-- Companies RLS
create policy "Authenticated users can view companies" on companies for select to authenticated using (true);
create policy "Admins can insert companies" on companies for insert to authenticated
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Admins can update companies" on companies for update to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Admins can delete companies" on companies for delete to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- User-Companies RLS
create policy "Authenticated users can view user_companies" on user_companies for select to authenticated using (true);
create policy "Admins can insert user_companies" on user_companies for insert to authenticated
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));
create policy "Admins can delete user_companies" on user_companies for delete to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'admin'));

-- ============================================================
-- SEED: Default Company
-- ============================================================
insert into companies (name, slug) values ('TRC', 'trc')
on conflict (name) do nothing;
