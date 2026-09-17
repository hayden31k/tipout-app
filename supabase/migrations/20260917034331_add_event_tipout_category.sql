-- Optional dessert/event/other tipout category (e.g. a cake-cutting fee) -
-- a separate tipout rate some restaurants apply to event/dessert sales.
-- Both default to 0 so this has zero effect on any existing calculation
-- unless a restaurant/shift explicitly opts in.
alter table public.restaurants
  add column if not exists event_pct numeric not null default 0;

alter table public.shifts
  add column if not exists event_sales numeric not null default 0;
