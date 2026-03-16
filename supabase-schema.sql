-- TalentLedger Supabase Schema
-- Run this in your Supabase SQL Editor

-- Profiles table (extends Supabase Auth)
create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique,
  email text,
  clearance text default 'viewer',
  created_at timestamptz default now()
);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, username)
  values (new.id, new.email, new.raw_user_meta_data->>'username');
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Tasks table
create table if not exists task_new (
  id serial primary key,
  branch_code text not null,
  title text,
  responsibility text,
  due_date date,
  maintenance_task_created integer default 0,
  stage text default 'assigned',
  repeat_every text,
  repeat_num integer,
  repeat_times integer,
  added text default 'no',
  vend text,
  descript text,
  created_at timestamptz default now()
);

-- Maintenance table
create table if not exists maintenance (
  id serial primary key,
  branch_code text not null,
  title text,
  responsibility text,
  due_date date,
  maintenance_task_created integer default 1,
  stage text default 'assigned',
  repeat_every text,
  repeat_num integer,
  repeat_times integer,
  added text default 'no',
  vend text,
  descript text,
  created_at timestamptz default now()
);

-- Vendors table
create table if not exists vendors (
  id serial primary key,
  first_name text,
  last_name text,
  phone text,
  email text,
  position text,
  company text,
  company_phone text,
  address text,
  created_at timestamptz default now()
);

-- Enable Row Level Security
alter table profiles enable row level security;
alter table task_new enable row level security;
alter table maintenance enable row level security;
alter table vendors enable row level security;

-- RLS Policies
create policy "Authenticated users can view profiles" on profiles for select to authenticated using (true);
create policy "Users can update own profile" on profiles for update to authenticated using (auth.uid() = id);

create policy "Authenticated users can view tasks" on task_new for select to authenticated using (true);
create policy "Authenticated users can insert tasks" on task_new for insert to authenticated with check (true);
create policy "Authenticated users can update tasks" on task_new for update to authenticated using (true);
create policy "Authenticated users can delete tasks" on task_new for delete to authenticated using (true);

create policy "Authenticated users can view maintenance" on maintenance for select to authenticated using (true);
create policy "Authenticated users can insert maintenance" on maintenance for insert to authenticated with check (true);
create policy "Authenticated users can update maintenance" on maintenance for update to authenticated using (true);
create policy "Authenticated users can delete maintenance" on maintenance for delete to authenticated using (true);

create policy "Authenticated users can view vendors" on vendors for select to authenticated using (true);
create policy "Authenticated users can insert vendors" on vendors for insert to authenticated with check (true);
