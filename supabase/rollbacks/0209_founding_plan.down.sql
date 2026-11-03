-- Undo 0209: the agences forget which founding plan they asked for.
-- Roll the code back first: SHOP_COLUMNS selects the column.
alter table public.shops drop column if exists founding_plan;
