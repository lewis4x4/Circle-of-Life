-- Seed one published KB document for the Circle of Life org so semantic + keyword retrieval
-- returns at least one row in dev/demo (retrieve_evidence keyword fallback when semantic is empty).
-- Idempotent: fixed UUIDs + ON CONFLICT DO NOTHING.

INSERT INTO public.documents (
  id,
  workspace_id,
  title,
  source,
  mime_type,
  raw_text,
  audience,
  status,
  metadata,
  word_count
)
VALUES (
  'a1000000-0000-4000-8000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  'Haven Knowledge Base — Getting started',
  'seed_migration',
  'text/plain',
  $seed$
Welcome to the Haven knowledge assistant for Circle of Life assisted living facilities in Florida.

This seed document helps staff and leadership find answers about policies, procedures, compliance,
resident safety, medication administration, infection control, staff training, dietary orders,
incident reporting, admissions, discharge planning, visitor policies, and day-to-day operations.

Upload your real handbooks, AHCA Chapter 429 references, facility-specific procedures, and
training materials from Admin → Knowledge → Knowledge admin so every answer can cite your documents.

Questions about policies, procedures, compliance, training, residents, staff, medications,
emergency preparedness, transportation, billing, or quality metrics should first run a knowledge
base search against uploaded PDFs and SOPs.
$seed$,
  'company_wide',
  'published',
  '{"seed": true, "purpose": "kb_demo_retrieval"}'::jsonb,
  120
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.chunks (
  id,
  document_id,
  workspace_id,
  chunk_index,
  content,
  content_stripped,
  chunk_type,
  section_title,
  embedding
)
VALUES (
  'a1000000-0000-4000-8000-000000000102',
  'a1000000-0000-4000-8000-000000000101',
  '00000000-0000-0000-0000-000000000001',
  0,
  $chunk$
Welcome to the Haven knowledge assistant for Circle of Life assisted living facilities in Florida.

This seed document helps staff and leadership find answers about policies, procedures, compliance,
resident safety, medication administration, infection control, staff training, dietary orders,
incident reporting, admissions, discharge planning, visitor policies, and day-to-day operations.

Upload your real handbooks, AHCA Chapter 429 references, facility-specific procedures, and
training materials from Admin → Knowledge → Knowledge admin so every answer can cite your documents.

Questions about policies, procedures, compliance, training, residents, staff, medications,
emergency preparedness, transportation, billing, or quality metrics should first run a knowledge
base search against uploaded PDFs and SOPs.
$chunk$,
  $chunk$
Welcome to the Haven knowledge assistant for Circle of Life assisted living facilities in Florida.

This seed document helps staff and leadership find answers about policies, procedures, compliance,
resident safety, medication administration, infection control, staff training, dietary orders,
incident reporting, admissions, discharge planning, visitor policies, and day-to-day operations.

Upload your real handbooks, AHCA Chapter 429 references, facility-specific procedures, and
training materials from Admin → Knowledge → Knowledge admin so every answer can cite your documents.

Questions about policies, procedures, compliance, training, residents, staff, medications,
emergency preparedness, transportation, billing, or quality metrics should first run a knowledge
base search against uploaded PDFs and SOPs.
$chunk$,
  'paragraph',
  'Introduction',
  ( '[' || array_to_string (array_fill (0.001::float8, ARRAY[1536]), ',') || ']' )::vector
)
ON CONFLICT (id) DO NOTHING;
