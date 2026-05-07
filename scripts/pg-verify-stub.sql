-- Minimal Supabase-compatible stubs so Haven migrations apply on vanilla Postgres (local verify only).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Supabase Realtime ships a `supabase_realtime` publication; migrations may ADD TABLE to it.
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$do$;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END
$do$;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid ()
  RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = public
  AS $f$
  SELECT
    NULL::uuid
$f$;

-- Supabase exposes auth.jwt(); return configured claims or empty payload
-- so migrations that read app_metadata can compile in vanilla Postgres replay.
CREATE OR REPLACE FUNCTION auth.jwt ()
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path = public
  AS $f$
  SELECT
    COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$f$;

-- Match columns used by 033_seed_oakridge_demo_data.sql (Supabase GoTrue shape) for Docker replay.
CREATE TABLE auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  instance_id uuid,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  aud text,
  role text,
  created_at timestamptz,
  updated_at timestamptz,
  confirmation_token text,
  recovery_token text DEFAULT '',
  email_change_token_new text DEFAULT '',
  email_change text DEFAULT '',
  email_change_token_current text DEFAULT '',
  email_change_confirm_status smallint DEFAULT 0,
  phone_change text DEFAULT '',
  phone_change_token text DEFAULT '',
  reauthentication_token text DEFAULT ''
);

CREATE TABLE auth.identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  identity_data jsonb,
  provider text NOT NULL,
  provider_id text NOT NULL,
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_id)
);

-- GoTrue tables referenced by demo-auth repair migrations (164–166); Docker replay only.
CREATE TABLE IF NOT EXISTS auth.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth.mfa_factors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE
);

-- Sentinel auth row for migrations that set created_by to the COL org placeholder UUID
-- (e.g. 102–104 phase-1 seeds). Real Supabase uses GoTrue; Docker replay only.
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  aud,
  role,
  created_at,
  updated_at,
  confirmation_token
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'system-placeholder@haven.seed',
  '',
  now(),
  '{}',
  '{}',
  'authenticated',
  'authenticated',
  now(),
  now(),
  ''
);

-- Minimal Storage API stubs (Supabase). Lets migrations create buckets + storage.objects policies.
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  public boolean DEFAULT false,
  avif_autodetection boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid (),
  bucket_id text NOT NULL REFERENCES storage.buckets (id) ON DELETE CASCADE,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb DEFAULT '{}'::jsonb,
  UNIQUE (bucket_id, name)
);

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Supabase splits storage object paths into folder segments; facility-documents RLS
-- uses (storage.foldername(name))[1]::uuid as the facility_id prefix.
CREATE OR REPLACE FUNCTION storage.foldername(name text)
  RETURNS text[]
  LANGUAGE sql
  IMMUTABLE
  SET search_path = public, storage
  AS $f$
  SELECT
    CASE
      WHEN name IS NULL OR btrim(name, '/') = '' THEN
        ARRAY[]::text[]
      ELSE
        string_to_array(btrim(name, '/'), '/')
    END;
$f$;
