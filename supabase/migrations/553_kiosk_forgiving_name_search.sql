-- Kiosk name search that forgives the person typing (Brian, 2026-09-25: "I don't want
-- people frustrated that they typed a name wrong entering and can't sign out").
--
-- One matcher, haven.kiosk_name_match_rank, shared by visitor sign-out and the
-- resident picker. Every word typed must match some word of the name, in any order:
--   0  the word starts with what was typed          ("hal" -> Hall, "abb" -> Abbigail)
--   1  a letter or two off (two from 6 letters), a swap counting as one
--                                                  ("abigail" -> Abbigail, "hlal" -> Hall)
--   2  sounds the same (double metaphone)           ("abi" -> Abbigail, "katy" -> Katie)
-- The same test runs whichever side was misspelled: what is typed now, or what was
-- typed at sign-in. Exact matches list first. The screens keep their limits: nothing
-- before 3 letters; sign-out lists at most 5 open visits as first name and last
-- initial; the resident picker lists at most 6 and forgives only from 4 letters, so
-- three letters never widen what the tablet shows about the census.

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA extensions;

-- Letters only, lower case, one entry per word. With p_join, a name of several words
-- also offers itself run together, so O'Brien matches "obrien" and Mary-Kate "marykate".
CREATE OR REPLACE FUNCTION haven.kiosk_name_words(p_value text, p_join boolean DEFAULT false)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
  WITH cleaned AS (
    SELECT btrim(regexp_replace(lower(COALESCE(p_value, '')), '[^[:alpha:]]+', ' ', 'g')) AS v
  )
  SELECT CASE
    WHEN v = '' THEN '{}'::text[]
    WHEN p_join AND position(' ' IN v) > 0 THEN string_to_array(v, ' ') || replace(v, ' ', '')
    ELSE string_to_array(v, ' ')
  END
  FROM cleaned;
$function$;

-- Edit distance where two neighbouring letters swapped count as one mistake
-- ("hlal" is one away from "hall"), optimal string alignment. Names are short.
CREATE OR REPLACE FUNCTION haven.kiosk_name_distance(p_a text, p_b text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  la integer := char_length(p_a);
  lb integer := char_length(p_b);
  d integer[];
  i integer;
  j integer;
  cost integer;
  w integer := lb + 1;
BEGIN
  IF la = 0 THEN RETURN lb; END IF;
  IF lb = 0 THEN RETURN la; END IF;
  d := array_fill(0, ARRAY[(la + 1) * (lb + 1)]);
  FOR i IN 0..la LOOP d[i * w + 1] := i; END LOOP;
  FOR j IN 0..lb LOOP d[j + 1] := j; END LOOP;
  FOR i IN 1..la LOOP
    FOR j IN 1..lb LOOP
      cost := CASE WHEN substr(p_a, i, 1) = substr(p_b, j, 1) THEN 0 ELSE 1 END;
      d[i * w + j + 1] := LEAST(d[(i - 1) * w + j + 1] + 1, d[i * w + j] + 1, d[(i - 1) * w + j] + cost);
      IF i > 1 AND j > 1 AND substr(p_a, i, 1) = substr(p_b, j - 1, 1) AND substr(p_a, i - 1, 1) = substr(p_b, j, 1) THEN
        d[i * w + j + 1] := LEAST(d[i * w + j + 1], d[(i - 2) * w + j - 1] + 1);
      END IF;
    END LOOP;
  END LOOP;
  RETURN d[la * w + lb + 1];
END;
$function$;

-- 0, 1 or 2 as above, or NULL when some typed word matches nothing.
CREATE OR REPLACE FUNCTION haven.kiosk_name_match_rank(p_query text, p_names text[], p_forgive boolean DEFAULT true)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tokens text[] := haven.kiosk_name_words(p_query);
  v_words text[] := '{}';
  v_name text;
  v_token text;
  v_word text;
  v_best integer;
  v_rank integer := 0;
  v_allow integer;
  v_sound text;
  v_joined integer;
BEGIN
  FOREACH v_name IN ARRAY COALESCE(p_names, '{}'::text[]) LOOP
    v_words := v_words || haven.kiosk_name_words(v_name, true);
  END LOOP;
  IF cardinality(v_tokens) = 0 OR cardinality(v_words) = 0 THEN
    RETURN NULL;
  END IF;

  FOREACH v_token IN ARRAY v_tokens LOOP
    v_best := NULL;
    v_allow := CASE WHEN char_length(v_token) >= 6 THEN 2 ELSE 1 END;
    v_sound := CASE WHEN p_forgive AND char_length(v_token) >= 3 THEN dmetaphone(v_token) END;
    FOREACH v_word IN ARRAY v_words LOOP
      IF v_word LIKE v_token || '%' THEN
        v_best := 0;
        EXIT;
      ELSIF p_forgive AND char_length(v_token) >= 3
            AND (haven.kiosk_name_distance(v_token, left(v_word, char_length(v_token))) <= v_allow
                 OR haven.kiosk_name_distance(v_token, v_word) <= v_allow) THEN
        v_best := 1;
      ELSIF p_forgive AND v_best IS NULL AND char_length(COALESCE(v_sound, '')) >= 2
            AND left(dmetaphone(v_word), char_length(v_sound)) = v_sound THEN
        v_best := 2;
      END IF;
    END LOOP;
    IF v_best IS NULL THEN
      v_rank := NULL;
      EXIT;
    END IF;
    v_rank := GREATEST(v_rank, v_best);
  END LOOP;

  -- Several typed words may be one name typed with a space ("mary kate", "o brien").
  IF cardinality(v_tokens) > 1 THEN
    v_joined := haven.kiosk_name_match_rank(array_to_string(v_tokens, ''), p_names, p_forgive);
    IF v_joined IS NOT NULL AND (v_rank IS NULL OR v_joined < v_rank) THEN
      v_rank := v_joined;
    END IF;
  END IF;
  RETURN v_rank;
END;
$function$;

REVOKE ALL ON FUNCTION haven.kiosk_name_words(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION haven.kiosk_name_distance(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION haven.kiosk_name_match_rank(text, text[], boolean) FROM PUBLIC, anon, authenticated;

-- Sign-out: same shape as migration 494 (entry id, first name and last initial, type,
-- time in), same limits, now matched by the forgiving rank.
CREATE OR REPLACE FUNCTION public.visitor_kiosk_open_matches(p_device_token text, p_prefix text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dev record;
  v_prefix text := left(btrim(COALESCE(p_prefix, '')), 60);
BEGIN
  SELECT * INTO v_dev FROM haven.visitor_kiosk_device(p_device_token);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  IF haven.visitor_kiosk_throttled(v_dev.id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_throttled');
  END IF;
  IF char_length(regexp_replace(v_prefix, '[^[:alpha:]]', '', 'g')) < 3 THEN
    RETURN jsonb_build_object('ok', true, 'matches', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object('ok', true, 'matches', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'entry_id', m.id,
      'display_name', haven.visitor_kiosk_display_name(m.visitor_name),
      'type_label', haven.visitor_kiosk_type_label(m.visitor_type),
      'checked_in_at', m.checked_in_at
    ) ORDER BY m.rank, m.checked_in_at DESC)
    FROM (
      SELECT c.id, c.visitor_name, c.visitor_type, c.checked_in_at, c.rank
      FROM (
        SELECT v.id, v.visitor_name, v.visitor_type, v.checked_in_at,
               haven.kiosk_name_match_rank(v_prefix, ARRAY[v.visitor_name]) AS rank
        FROM public.visitor_log_entries v
        WHERE v.organization_id = v_dev.organization_id
          AND v.facility_id = v_dev.facility_id
          AND v.deleted_at IS NULL AND v.voided_at IS NULL AND v.checked_out_at IS NULL
          AND v.checked_in_at >= now() - interval '24 hours'
      ) c
      WHERE c.rank IS NOT NULL
      ORDER BY c.rank, c.checked_in_at DESC
      LIMIT 5
    ) m
  ), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.visitor_kiosk_open_matches(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_kiosk_open_matches(text, text) TO service_role;

-- Resident picker: same shape as migration 551. Forgives only from 4 letters.
CREATE OR REPLACE FUNCTION public.visitor_kiosk_resident_matches(p_device_token text, p_prefix text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_dev record;
  v_prefix text := left(btrim(COALESCE(p_prefix, '')), 60);
  v_letters integer := char_length(regexp_replace(v_prefix, '[^[:alpha:]]', '', 'g'));
BEGIN
  SELECT * INTO v_dev FROM haven.visitor_kiosk_device(p_device_token);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_unknown');
  END IF;
  IF haven.visitor_kiosk_throttled(v_dev.id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'device_throttled');
  END IF;
  -- Nothing is returned until 3 letters are typed, so the tablet never lists the census.
  IF v_letters < 3 THEN
    RETURN jsonb_build_object('ok', true, 'matches', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object('ok', true, 'matches', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'resident_id', m.id,
      'display_name', m.display_name,
      'room', m.room_number
    ) ORDER BY m.rank, m.last_key, m.first_key)
    FROM (
      SELECT c.* FROM (
        SELECT r.id,
               COALESCE(NULLIF(btrim(r.preferred_name), ''), btrim(r.first_name))
                 || ' ' || upper(left(btrim(r.last_name), 1)) || '.' AS display_name,
               rm.room_number,
               lower(btrim(r.last_name)) AS last_key,
               lower(btrim(r.first_name)) AS first_key,
               haven.kiosk_name_match_rank(v_prefix, ARRAY[r.first_name, r.preferred_name, r.last_name], v_letters >= 4) AS rank
        FROM public.residents r
        LEFT JOIN public.beds b ON b.id = r.bed_id
        LEFT JOIN public.rooms rm ON rm.id = b.room_id
        WHERE r.organization_id = v_dev.organization_id
          AND r.facility_id = v_dev.facility_id
          AND r.deleted_at IS NULL
          AND r.status IN ('active', 'hospital_hold', 'loa')
      ) c
      WHERE c.rank IS NOT NULL
      ORDER BY c.rank, c.last_key, c.first_key
      LIMIT 6
    ) m
  ), '[]'::jsonb));
END;
$function$;

REVOKE ALL ON FUNCTION public.visitor_kiosk_resident_matches(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.visitor_kiosk_resident_matches(text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
