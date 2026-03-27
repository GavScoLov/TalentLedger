-- ============================================================
-- TalentLedger — Full Migration (Worker Sessions + Scheduler)
-- Run this in the Supabase SQL Editor.
-- Safe to run multiple times (all statements are idempotent).
-- ============================================================

-- ── Required extension ────────────────────────────────────────
create extension if not exists pgcrypto;

-- ============================================================
-- 1. WORKERS
-- ============================================================
create table if not exists workers (
  id             uuid    default gen_random_uuid() primary key,
  name           text    not null,
  email          text    unique,
  employee_id    text    unique,
  password_hash  text,
  pin_hash       text,
  company        text,
  role           text,
  is_active      boolean default true,
  created_at     timestamptz default now()
);

-- ============================================================
-- 2. EVENTS
-- ============================================================
create table if not exists events (
  id              uuid    default gen_random_uuid() primary key,
  invoice_number  text    unique not null,
  name            text    not null,
  description     text,
  event_date      date    not null,
  start_time      text,
  end_time        text,
  workers_needed  integer default 1,
  role            text,
  company         text,
  location        text,
  status          text    default 'pending',
  created_by      text,
  created_at      timestamptz default now()
);

-- ============================================================
-- 3. EVENT ASSIGNMENTS
-- ============================================================
create table if not exists event_assignments (
  id            uuid    default gen_random_uuid() primary key,
  event_id      uuid    references events(id)  on delete cascade,
  worker_id     uuid    references workers(id) on delete cascade,
  worker_name   text    not null,
  hours_assigned numeric(5,2),
  status        text    default 'assigned',
  notes         text,
  assigned_by   text,
  created_at    timestamptz default now(),
  unique(event_id, worker_id)
);

-- ============================================================
-- 4. WORKER SESSIONS
-- ============================================================
create table if not exists worker_sessions (
  id             uuid    default gen_random_uuid() primary key,
  worker_id      uuid    references workers(id),
  event_id       uuid    references events(id),
  assignment_id  uuid    references event_assignments(id),
  worker_name    text    not null,
  check_in_time  timestamptz not null default now(),
  check_out_time timestamptz,
  hours_worked   numeric(6,2),
  used_pin       boolean default false,
  date           date    default current_date,
  created_at     timestamptz default now()
);

-- ============================================================
-- 5. SHIFTS  (scheduler)
-- ============================================================
create table if not exists shifts (
  id          uuid    default gen_random_uuid() primary key,
  worker_id   uuid    references workers(id) on delete cascade,
  event_id    uuid    references events(id)  on delete set null,
  shift_date  date    not null,
  start_time  text    not null,   -- "HH:MM" 24h
  end_time    text    not null,   -- "HH:MM" 24h
  title       text,
  notes       text,
  color       text    default '#EA8938',
  status      text    default 'scheduled',  -- scheduled | confirmed | completed | cancelled
  created_by  text,
  created_at  timestamptz default now()
);

-- ── Indexes ───────────────────────────────────────────────────
create index if not exists idx_worker_sessions_worker   on worker_sessions(worker_id);
create index if not exists idx_worker_sessions_date     on worker_sessions(date);
create index if not exists idx_worker_sessions_event    on worker_sessions(event_id);
create index if not exists idx_event_assignments_event  on event_assignments(event_id);
create index if not exists idx_event_assignments_worker on event_assignments(worker_id);
create index if not exists idx_shifts_worker_date       on shifts(worker_id, shift_date);
create index if not exists idx_shifts_date              on shifts(shift_date);
create index if not exists idx_shifts_event             on shifts(event_id);

-- ============================================================
-- 6. RLS POLICIES
-- ============================================================
alter table workers           enable row level security;
alter table events            enable row level security;
alter table event_assignments enable row level security;
alter table worker_sessions   enable row level security;
alter table shifts            enable row level security;

-- Drop existing policies first so re-runs don't error
do $$ begin
  drop policy if exists "auth_select_workers"     on workers;
  drop policy if exists "admin_insert_workers"    on workers;
  drop policy if exists "admin_update_workers"    on workers;
  drop policy if exists "auth_select_events"      on events;
  drop policy if exists "auth_insert_events"      on events;
  drop policy if exists "auth_update_events"      on events;
  drop policy if exists "auth_select_assignments" on event_assignments;
  drop policy if exists "auth_insert_assignments" on event_assignments;
  drop policy if exists "auth_update_assignments" on event_assignments;
  drop policy if exists "auth_delete_assignments" on event_assignments;
  drop policy if exists "auth_select_sessions"    on worker_sessions;
  drop policy if exists "auth_select_shifts"      on shifts;
  drop policy if exists "auth_insert_shifts"      on shifts;
  drop policy if exists "auth_update_shifts"      on shifts;
  drop policy if exists "auth_delete_shifts"      on shifts;
exception when others then null;
end $$;

-- Workers
create policy "auth_select_workers"  on workers for select to authenticated using (true);
create policy "admin_insert_workers" on workers for insert to authenticated
  with check (exists (
    select 1 from profiles where id = auth.uid() and role in ('admin','super_admin')
  ));
create policy "admin_update_workers" on workers for update to authenticated
  using (exists (
    select 1 from profiles where id = auth.uid() and role in ('admin','super_admin')
  ));

-- Events
create policy "auth_select_events" on events for select to authenticated using (true);
create policy "auth_insert_events" on events for insert to authenticated with check (true);
create policy "auth_update_events" on events for update to authenticated using (true);

-- Assignments
create policy "auth_select_assignments" on event_assignments for select to authenticated using (true);
create policy "auth_insert_assignments" on event_assignments for insert to authenticated with check (true);
create policy "auth_update_assignments" on event_assignments for update to authenticated using (true);
create policy "auth_delete_assignments" on event_assignments for delete to authenticated using (true);

-- Sessions
create policy "auth_select_sessions" on worker_sessions for select to authenticated using (true);

-- Shifts
create policy "auth_select_shifts" on shifts for select to authenticated using (true);
create policy "auth_insert_shifts" on shifts for insert to authenticated with check (true);
create policy "auth_update_shifts" on shifts for update to authenticated using (true);
create policy "auth_delete_shifts" on shifts for delete to authenticated using (true);

-- ============================================================
-- 7. RPC: worker_get_status
--    Verifies worker credentials, returns check-in state
--    + today's scheduled shifts.
-- ============================================================
create or replace function worker_get_status(
  p_identifier text,
  p_credential text,
  p_is_pin     boolean default false
)
returns json
language plpgsql
security definer
as $$
declare
  v_worker  workers%rowtype;
  v_session worker_sessions%rowtype;
  v_event   events%rowtype;
  v_shifts  json;
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
    return json_build_object('success', false, 'error', 'Invalid credentials. Please try again.');
  end if;

  select * into v_session from worker_sessions
  where worker_id = v_worker.id
    and check_out_time is null
    and date = current_date
  order by check_in_time desc
  limit 1;

  if found and v_session.event_id is not null then
    select * into v_event from events where id = v_session.event_id;
  end if;

  -- Today's scheduled shifts (for kiosk display)
  select coalesce(json_agg(
    json_build_object(
      'id',         s.id,
      'title',      s.title,
      'start_time', s.start_time,
      'end_time',   s.end_time,
      'color',      s.color,
      'status',     s.status,
      'event_name', e.name
    ) order by s.start_time
  ), '[]'::json)
  into v_shifts
  from shifts s
  left join events e on e.id = s.event_id
  where s.worker_id = v_worker.id
    and s.shift_date = current_date
    and s.status != 'cancelled';

  return json_build_object(
    'success',       true,
    'worker_id',     v_worker.id,
    'worker_name',   v_worker.name,
    'is_checked_in', (v_session.id is not null),
    'session',       case when v_session.id is not null then row_to_json(v_session) else null end,
    'event_name',    case when v_event.id is not null then v_event.name else null end,
    'shifts_today',  v_shifts
  );
end;
$$;

grant execute on function worker_get_status(text, text, boolean) to anon;

-- ============================================================
-- 8. RPC: worker_check_in_out
-- ============================================================
create or replace function worker_check_in_out(
  p_identifier text,
  p_credential text,
  p_is_pin     boolean default false,
  p_event_id   uuid    default null
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
    update worker_sessions
    set
      check_out_time = now(),
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
    if p_event_id is not null then
      select * into v_assignment from event_assignments
      where worker_id = v_worker.id and event_id = p_event_id
      limit 1;
    end if;

    insert into worker_sessions (
      worker_id, worker_name, used_pin, date,
      event_id, assignment_id
    )
    values (
      v_worker.id, v_worker.name, p_is_pin, current_date,
      p_event_id,
      case when v_assignment.id is not null then v_assignment.id else null end
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

grant execute on function worker_check_in_out(text, text, boolean, uuid) to anon;

-- ============================================================
-- 9. RPC: hash_worker_credentials
-- ============================================================
create or replace function hash_worker_credentials(
  p_password text default null,
  p_pin      text default null
)
returns json
language plpgsql
security definer
as $$
begin
  return json_build_object(
    'password_hash', case when p_password is not null then crypt(p_password, gen_salt('bf')) else null end,
    'pin_hash',      case when p_pin      is not null then crypt(p_pin,      gen_salt('bf')) else null end
  );
end;
$$;

grant execute on function hash_worker_credentials(text, text) to authenticated;
