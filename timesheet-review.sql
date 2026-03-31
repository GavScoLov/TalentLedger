-- ============================================================
-- Timesheet Review — Supabase Migration
-- Run in the Supabase SQL Editor. Safe to run multiple times.
-- ============================================================

create table if not exists timesheet_approvals (
  id                uuid  default gen_random_uuid() primary key,
  ts_shift_id       text  not null unique,        -- TimeStation shift_id
  employee_id       text  not null,               -- TimeStation employee_id
  worker_name       text,
  department        text,                         -- TS department/company
  shift_date        date,
  -- Original times as returned by TimeStation (preserved for audit)
  original_time_in  text,
  original_time_out text,
  -- Edited times (null = not edited, use originals)
  edited_time_in    text,
  edited_time_out   text,
  total_minutes     integer,
  -- Approval workflow
  status            text  default 'pending',      -- pending | edited | approved
  approved_by       text,
  approved_at       timestamptz,
  notes             text,
  -- TimeStation write-back tracking
  pushed_to_ts      boolean default false,
  pushed_at         timestamptz,
  push_error        text,                         -- last push error message if any
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index if not exists idx_ta_employee  on timesheet_approvals(employee_id);
create index if not exists idx_ta_date      on timesheet_approvals(shift_date);
create index if not exists idx_ta_status    on timesheet_approvals(status);
create index if not exists idx_ta_dept      on timesheet_approvals(department);

alter table timesheet_approvals enable row level security;

do $$ begin
  drop policy if exists "auth_select_ta" on timesheet_approvals;
  drop policy if exists "auth_insert_ta" on timesheet_approvals;
  drop policy if exists "auth_update_ta" on timesheet_approvals;
exception when others then null;
end $$;

create policy "auth_select_ta" on timesheet_approvals for select to authenticated using (true);
create policy "auth_insert_ta" on timesheet_approvals for insert to authenticated with check (true);
create policy "auth_update_ta" on timesheet_approvals for update to authenticated using (true);
