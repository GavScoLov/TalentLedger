-- ============================================================
-- Time Tracker — Incremental Migration
-- Run AFTER shifts-migration.sql (or after the combined one).
-- All statements are idempotent.
-- ============================================================

-- ── 1. Add columns to existing tables ─────────────────────

-- Worker pay rate
alter table workers add column if not exists pay_rate numeric(8,2);

-- Session enhancements: lunch, GPS, review
alter table worker_sessions add column if not exists lunch_start   timestamptz;
alter table worker_sessions add column if not exists lunch_end     timestamptz;
alter table worker_sessions add column if not exists clock_in_lat  numeric(10,7);
alter table worker_sessions add column if not exists clock_in_lng  numeric(10,7);
alter table worker_sessions add column if not exists clock_out_lat numeric(10,7);
alter table worker_sessions add column if not exists clock_out_lng numeric(10,7);
alter table worker_sessions add column if not exists reviewed      boolean default false;
alter table worker_sessions add column if not exists review_notes  text;
alter table worker_sessions add column if not exists review_flag   text;  -- ok | late | absent | flagged

-- Event geocoords (for location validation)
alter table events add column if not exists lat numeric(10,7);
alter table events add column if not exists lng numeric(10,7);

-- ── 2. Allow authenticated users to update sessions ────────
do $$ begin
  drop policy if exists "auth_update_sessions" on worker_sessions;
exception when others then null;
end $$;
create policy "auth_update_sessions" on worker_sessions
  for update to authenticated using (true);

-- ── 3. EMPLOYER SETTINGS ───────────────────────────────────
create table if not exists employer_settings (
  id                     uuid    default gen_random_uuid() primary key,
  company_name           text    unique not null,
  -- Clock-in tolerance
  early_tolerance_value  integer default 15,
  early_tolerance_unit   text    default 'minutes',  -- minutes | hours
  late_tolerance_value   integer default 15,
  late_tolerance_unit    text    default 'minutes',
  -- Location
  track_location         boolean default false,
  location_radius_miles  numeric(4,2) default 1.0,
  -- Lunch
  lunch_min_minutes      integer default 0,
  lunch_max_minutes      integer default 60,
  -- Daily limit
  daily_hour_limit       numeric(4,2) default 12,
  -- Notification actions
  late_action            text    default 'notify_internal',  -- none | notify_employer | notify_internal | both
  noshow_action          text    default 'notify_internal',
  notification_email     text,
  -- Timestamps
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

alter table employer_settings enable row level security;

do $$ begin
  drop policy if exists "auth_select_employer_settings" on employer_settings;
  drop policy if exists "auth_insert_employer_settings" on employer_settings;
  drop policy if exists "auth_update_employer_settings" on employer_settings;
exception when others then null;
end $$;

create policy "auth_select_employer_settings" on employer_settings
  for select to authenticated using (true);
create policy "auth_insert_employer_settings" on employer_settings
  for insert to authenticated with check (true);
create policy "auth_update_employer_settings" on employer_settings
  for update to authenticated using (true);

-- ── 4. RPC: worker_check_in_out — updated to accept GPS coords
create or replace function worker_check_in_out(
  p_identifier text,
  p_credential text,
  p_is_pin     boolean default false,
  p_event_id   uuid    default null,
  p_lat        numeric default null,
  p_lng        numeric default null
)
returns json
language plpgsql
security definer
as $$
declare
  v_worker     workers%rowtype;
  v_session    worker_sessions%rowtype;
  v_assignment event_assignments%rowtype;
  v_action     text;
begin
  if p_is_pin then
    select * into v_worker from workers
    where employee_id = p_identifier
      and pin_hash = crypt(p_credential, pin_hash)
      and is_active = true;
  else
    select * into v_worker from workers
    where (email = p_identifier or employee_id = p_identifier)
      and password_hash = crypt(p_credential, password_hash)
      and is_active = true;
  end if;

  if not found then
    return json_build_object('success', false, 'error', 'Invalid credentials.');
  end if;

  select * into v_session from worker_sessions
  where worker_id = v_worker.id
    and check_out_time is null
    and date = current_date
  order by check_in_time desc
  limit 1;

  if found then
    -- CHECK OUT
    update worker_sessions
    set
      check_out_time = now(),
      clock_out_lat  = p_lat,
      clock_out_lng  = p_lng,
      hours_worked   = round(
        (extract(epoch from (now() - check_in_time)) / 3600)::numeric, 2
      )
    where id = v_session.id
    returning * into v_session;

    if v_session.assignment_id is not null then
      update event_assignments set status = 'completed'
      where id = v_session.assignment_id;
    end if;

    v_action := 'check_out';
  else
    -- CHECK IN
    if p_event_id is not null then
      select * into v_assignment from event_assignments
      where worker_id = v_worker.id and event_id = p_event_id
      limit 1;
    end if;

    insert into worker_sessions (
      worker_id, worker_name, used_pin, date,
      event_id, assignment_id, clock_in_lat, clock_in_lng
    )
    values (
      v_worker.id, v_worker.name, p_is_pin, current_date,
      p_event_id,
      case when v_assignment.id is not null then v_assignment.id else null end,
      p_lat, p_lng
    )
    returning * into v_session;

    if v_assignment.id is not null then
      update event_assignments set status = 'confirmed' where id = v_assignment.id;
    end if;

    if p_event_id is not null then
      update events set status = 'in_progress'
      where id = p_event_id and status = 'open';
    end if;

    v_action := 'check_in';
  end if;

  return json_build_object(
    'success',     true,
    'action',      v_action,
    'worker_name', v_worker.name,
    'session',     row_to_json(v_session)
  );
end;
$$;

grant execute on function worker_check_in_out(text, text, boolean, uuid, numeric, numeric) to anon;
