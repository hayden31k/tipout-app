-- Optional hourly wage tracking: hours logged per shift, and the
-- restaurant's hourly wage rate used to compute wages/net pay in Stats.
alter table public.shifts
  add column if not exists hours_worked numeric;

alter table public.restaurants
  add column if not exists hourly_wage numeric;
