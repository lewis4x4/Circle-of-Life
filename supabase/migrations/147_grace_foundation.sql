-- Grace companion foundation tables
-- Mirrors the Iron companion schema, adapted to Haven conventions.

CREATE TABLE IF NOT EXISTS public.grace_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  organization_id uuid NOT NULL DEFAULT haven.organization_id() REFERENCES public.organizations(id),
  input_mode text NOT NULL DEFAULT 'text',
  route_at_start text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grace_conversations_user_created
  ON public.grace_conversations (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_grace_conversations_org_updated
  ON public.grace_conversations (organization_id, updated_at DESC);

ALTER TABLE public.grace_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grace_conversations_own_rw ON public.grace_conversations;
CREATE POLICY grace_conversations_own_rw ON public.grace_conversations
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    AND organization_id = haven.organization_id()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = haven.organization_id()
  );

DROP TRIGGER IF EXISTS tr_grace_conversations_set_updated_at ON public.grace_conversations;
CREATE TRIGGER tr_grace_conversations_set_updated_at
  BEFORE UPDATE ON public.grace_conversations
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TABLE IF NOT EXISTS public.grace_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.grace_conversations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL DEFAULT haven.organization_id() REFERENCES public.organizations(id),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  role text NOT NULL CHECK (role IN ('user', 'grace')),
  content text NOT NULL,
  sources jsonb,
  classifier_output jsonb,
  tokens_in integer,
  tokens_out integer,
  model text,
  trace_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_grace_messages_conversation_created
  ON public.grace_messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_grace_messages_user_created
  ON public.grace_messages (user_id, created_at DESC);

ALTER TABLE public.grace_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grace_messages_own_rw ON public.grace_messages;
CREATE POLICY grace_messages_own_rw ON public.grace_messages
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    AND organization_id = haven.organization_id()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = haven.organization_id()
  );

CREATE TABLE IF NOT EXISTS public.grace_usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  organization_id uuid NOT NULL DEFAULT haven.organization_id() REFERENCES public.organizations(id),
  bucket_date date NOT NULL DEFAULT CURRENT_DATE,
  classifications integer NOT NULL DEFAULT 0,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  flow_executes integer NOT NULL DEFAULT 0,
  cost_usd_micro integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grace_usage_counters_user_bucket_unique UNIQUE (user_id, bucket_date)
);

CREATE INDEX IF NOT EXISTS idx_grace_usage_user_bucket
  ON public.grace_usage_counters (user_id, bucket_date DESC);

ALTER TABLE public.grace_usage_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grace_usage_counters_own_rw ON public.grace_usage_counters;
CREATE POLICY grace_usage_counters_own_rw ON public.grace_usage_counters
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    AND organization_id = haven.organization_id()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = haven.organization_id()
  );

DROP TRIGGER IF EXISTS tr_grace_usage_counters_set_updated_at ON public.grace_usage_counters;
CREATE TRIGGER tr_grace_usage_counters_set_updated_at
  BEFORE UPDATE ON public.grace_usage_counters
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE TABLE IF NOT EXISTS public.grace_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  organization_id uuid NOT NULL DEFAULT haven.organization_id() REFERENCES public.organizations(id),
  entity_type text NOT NULL CHECK (entity_type IN ('resident', 'room', 'medication', 'staff', 'incident', 'assessment', 'protocol')),
  entity_id uuid NOT NULL,
  entity_label text,
  interaction_count integer NOT NULL DEFAULT 1,
  last_interacted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT grace_memory_user_entity_unique UNIQUE (user_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_grace_memory_user_recent
  ON public.grace_memory (user_id, last_interacted_at DESC);

ALTER TABLE public.grace_memory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grace_memory_own_rw ON public.grace_memory;
CREATE POLICY grace_memory_own_rw ON public.grace_memory
  FOR ALL
  TO authenticated
  USING (
    user_id = auth.uid()
    AND organization_id = haven.organization_id()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = haven.organization_id()
  );

DROP TRIGGER IF EXISTS tr_grace_memory_set_updated_at ON public.grace_memory;
CREATE TRIGGER tr_grace_memory_set_updated_at
  BEFORE UPDATE ON public.grace_memory
  FOR EACH ROW
  EXECUTE PROCEDURE public.haven_set_updated_at();

CREATE OR REPLACE FUNCTION public.grace_increment_usage(
  p_user_id uuid,
  p_organization_id uuid,
  p_classifications integer DEFAULT 0,
  p_tokens_in integer DEFAULT 0,
  p_tokens_out integer DEFAULT 0,
  p_flow_executes integer DEFAULT 0,
  p_cost_usd_micro integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF auth.uid() IS NOT NULL AND p_organization_id <> haven.organization_id() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.grace_usage_counters (
    user_id,
    organization_id,
    bucket_date,
    classifications,
    tokens_in,
    tokens_out,
    flow_executes,
    cost_usd_micro
  )
  VALUES (
    p_user_id,
    p_organization_id,
    CURRENT_DATE,
    p_classifications,
    p_tokens_in,
    p_tokens_out,
    p_flow_executes,
    p_cost_usd_micro
  )
  ON CONFLICT (user_id, bucket_date) DO UPDATE SET
    classifications = public.grace_usage_counters.classifications + EXCLUDED.classifications,
    tokens_in = public.grace_usage_counters.tokens_in + EXCLUDED.tokens_in,
    tokens_out = public.grace_usage_counters.tokens_out + EXCLUDED.tokens_out,
    flow_executes = public.grace_usage_counters.flow_executes + EXCLUDED.flow_executes,
    cost_usd_micro = public.grace_usage_counters.cost_usd_micro + EXCLUDED.cost_usd_micro,
    updated_at = now();
END;
$func$;

CREATE OR REPLACE FUNCTION public.grace_top_flows(p_user_id uuid)
RETURNS TABLE (
  entity_type text,
  entity_id uuid,
  entity_label text,
  score float
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $func$
  SELECT
    gm.entity_type,
    gm.entity_id,
    gm.entity_label,
    (
      gm.interaction_count * 0.6 +
      EXTRACT(EPOCH FROM (now() - gm.last_interacted_at)) / -86400.0 * 0.4
    )::float AS score
  FROM public.grace_memory gm
  WHERE
    gm.user_id = p_user_id
    AND (auth.uid() IS NULL OR auth.uid() = p_user_id)
  ORDER BY score DESC
  LIMIT 50;
$func$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grace_conversations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grace_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grace_usage_counters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.grace_memory TO authenticated;

REVOKE ALL ON FUNCTION public.grace_increment_usage(uuid, uuid, integer, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grace_top_flows(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.grace_increment_usage(uuid, uuid, integer, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.grace_top_flows(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grace_top_flows(uuid) TO service_role;

COMMENT ON TABLE public.grace_conversations IS 'Grace companion conversations for Haven operators.';
COMMENT ON TABLE public.grace_messages IS 'Grace companion message history with redacted persisted content.';
COMMENT ON TABLE public.grace_usage_counters IS 'Per-user daily usage counters for Grace model cost ladder enforcement.';
COMMENT ON TABLE public.grace_memory IS 'Affinity memory used to rank Grace quick actions and likely entities.';
