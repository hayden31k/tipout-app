-- The default "Forest Green" bg_color was an approximation (#16211B) of
-- icon-512.png's actual background - too dark. Replaced with the true
-- color sampled from the icon's own pixels (#133D26). Only changes the
-- column default for future inserts; existing rows already at the old
-- default are intentionally left as-is (this doesn't touch existing data).
alter table public.restaurants
  alter column bg_color set default '#133D26';
