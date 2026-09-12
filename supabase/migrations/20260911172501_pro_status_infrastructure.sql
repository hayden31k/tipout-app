-- Pro-status infrastructure: a per-user is_pro flag plus a separate global
-- enforcement switch, so Pro gating logic can be wired up and tested without
-- changing real behavior for anyone until premium_enforcement_enabled is
-- deliberately flipped to true.

-- ---- Per-user Pro flag ----
-- user_settings rows are otherwise client-writable (e.g. display_name), so
-- this column is protected from client self-escalation by a trigger below -
-- RLS alone is row-scoped ("you may touch your own row"), not column-scoped,
-- so a normal owner-write policy would otherwise let any signed-in user
-- grant themselves Pro for free via a direct REST call.
alter table public.user_settings
  add column if not exists is_pro boolean not null default false;

create or replace function public.protect_user_settings_is_pro()
returns trigger
language plpgsql
as $$
begin
  -- auth.role() reflects the JWT role PostgREST assigns per request - 'anon'
  -- or 'authenticated' for ordinary client calls, 'service_role' for
  -- privileged backend calls, and null for a direct SQL/dashboard session
  -- (e.g. manually flipping a test user to Pro). Only the first two are
  -- restricted here.
  if auth.role() in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.is_pro := false;
    elsif tg_op = 'UPDATE' and new.is_pro is distinct from old.is_pro then
      new.is_pro := old.is_pro;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_user_settings_is_pro on public.user_settings;
create trigger trg_protect_user_settings_is_pro
  before insert or update on public.user_settings
  for each row execute function public.protect_user_settings_is_pro();

-- ---- Global enforcement master switch ----
-- Exactly one row, enforced permanently via a boolean primary key that must
-- be true (the classic single-row-table trick: a second row would need
-- id = false, which the check constraint rejects, and a duplicate id = true
-- row is rejected by the primary key itself).
create table if not exists public.app_config (
  id boolean primary key default true,
  premium_enforcement_enabled boolean not null default false,
  constraint app_config_single_row check (id)
);

insert into public.app_config (id, premium_enforcement_enabled)
values (true, false)
on conflict (id) do nothing;

-- Publicly readable (the client checks this before any Pro gate even runs,
-- including for signed-out visitors), writable only from the
-- dashboard/SQL editor or a service_role call - never by anon/authenticated
-- REST calls, since flipping this is a deliberate, global, manual act.
alter table public.app_config enable row level security;

drop policy if exists "app_config readable by anyone" on public.app_config;
create policy "app_config readable by anyone"
  on public.app_config for select
  to anon, authenticated
  using (true);
