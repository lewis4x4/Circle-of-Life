-- Minimal Supabase-compatible stubs so Haven migrations apply on vanilla Postgres (local verify only).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
  confirmation_token text
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
