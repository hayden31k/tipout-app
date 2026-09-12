-- Per-restaurant background color (Pro feature: color preset picker).
alter table public.restaurants
  add column if not exists bg_color text not null default '#16211B';
