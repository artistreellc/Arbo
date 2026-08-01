-- Pin the trigger function's search_path (Supabase advisor 0011,
-- function_search_path_mutable). It only calls now() from pg_catalog, so an
-- empty search_path is safe and removes the warning.
alter function public.arbor_touch_updated_at() set search_path = '';
