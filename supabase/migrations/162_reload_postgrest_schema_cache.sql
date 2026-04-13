-- Reload PostgREST schema cache after batch migrations 155-161.
-- This fixes "Database error querying schema" for users who log in
-- before the schema cache auto-refreshes.
NOTIFY pgrst, 'reload schema';
