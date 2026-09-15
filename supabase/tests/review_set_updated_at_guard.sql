-- Local rollback-only probe: haven_set_updated_at must work on tables without updated_by (migration 390).
BEGIN;
CREATE FUNCTION pg_temp.upd_assert(ok boolean, msg text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%', msg; END IF; END $$;

-- A table shaped like the 45 that only carry updated_at.
CREATE TABLE public.zz_probe_no_updated_by (id int PRIMARY KEY, label text, updated_at timestamptz NOT NULL DEFAULT '2000-01-01');
CREATE TRIGGER tr_zz_probe_no_updated_by BEFORE UPDATE ON public.zz_probe_no_updated_by FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();
INSERT INTO public.zz_probe_no_updated_by (id, label) VALUES (1, 'before');
UPDATE public.zz_probe_no_updated_by SET label = 'after' WHERE id = 1;
SELECT pg_temp.upd_assert((SELECT label = 'after' AND updated_at > '2000-01-02' FROM public.zz_probe_no_updated_by WHERE id = 1), 'UPDATE succeeds and stamps updated_at when updated_by is absent');

-- A table with updated_by keeps getting it stamped.
CREATE TABLE public.zz_probe_with_updated_by (id int PRIMARY KEY, label text, updated_at timestamptz NOT NULL DEFAULT '2000-01-01', updated_by uuid);
CREATE TRIGGER tr_zz_probe_with_updated_by BEFORE UPDATE ON public.zz_probe_with_updated_by FOR EACH ROW EXECUTE PROCEDURE public.haven_set_updated_at();
INSERT INTO public.zz_probe_with_updated_by (id, label, updated_by) VALUES (1, 'before', gen_random_uuid());
UPDATE public.zz_probe_with_updated_by SET label = 'after' WHERE id = 1;
-- No JWT in this session, so auth.uid() is null: the trigger must still own the column.
SELECT pg_temp.upd_assert((SELECT label = 'after' AND updated_at > '2000-01-02' AND updated_by IS NULL FROM public.zz_probe_with_updated_by WHERE id = 1), 'UPDATE stamps updated_by from auth.uid() when the column exists');

-- The real table that surfaced the defect.
INSERT INTO public.organizations (id, name) VALUES ('a1b2c3d4-0000-4000-8000-000000000001', 'Synthetic updated_by organization');
INSERT INTO public.ai_invocation_policies (organization_id, allow_phi) VALUES ('a1b2c3d4-0000-4000-8000-000000000001', false);
UPDATE public.ai_invocation_policies SET default_provider = 'anthropic' WHERE organization_id = 'a1b2c3d4-0000-4000-8000-000000000001';
SELECT pg_temp.upd_assert((SELECT count(*) = 1 FROM public.ai_invocation_policies WHERE organization_id = 'a1b2c3d4-0000-4000-8000-000000000001' AND updated_at > created_at - interval '1 second'), 'ai_invocation_policies is updatable');
ROLLBACK;
