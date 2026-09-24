-- Migration 485: the "Grace Pack - Resident Attention" example answer names a placeholder, not a person (COL-689)
--
-- The staff-wide KB document's example answer read "1. 1. James Brooks: 1 critically
-- overdue task; ...". The name matches no resident (checked 2026-09-22), but it reads
-- like real clinical data. It becomes "Resident A" (and the doubled "1. 1." is fixed).
--
-- Bounded by the exact old text; a re-run or an edited row changes nothing. On
-- production this is document 861adb56-4e7d-46d4-a06a-9337b8496b2d and its chunk
-- d5e32594-4eb3-4339-927e-05a8e838f3ea; Haven HFO Staging has no such rows.
-- `chunks.fts` is generated from content_stripped and follows automatically; the
-- chunk's embedding is not recomputed here (the sentence's meaning is unchanged).

BEGIN;

UPDATE public.documents
SET markdown_text = replace(markdown_text, '1. 1. James Brooks: 1 critically overdue task;', '1. Resident A: 1 critically overdue task;'),
    raw_text = replace(raw_text, '1. 1. James Brooks: 1 critically overdue task;', '1. Resident A: 1 critically overdue task;'),
    updated_at = now()
WHERE title = 'Grace Pack - Resident Attention'
  AND deleted_at IS NULL
  AND (markdown_text LIKE '%1. 1. James Brooks: 1 critically overdue task;%'
    OR raw_text LIKE '%1. 1. James Brooks: 1 critically overdue task;%');

UPDATE public.chunks c
SET content = replace(c.content, '1. 1. James Brooks: 1 critically overdue task;', '1. Resident A: 1 critically overdue task;'),
    content_stripped = replace(c.content_stripped, '1. 1. James Brooks: 1 critically overdue task;', '1. Resident A: 1 critically overdue task;')
FROM public.documents d
WHERE d.id = c.document_id
  AND d.title = 'Grace Pack - Resident Attention'
  AND (c.content LIKE '%1. 1. James Brooks: 1 critically overdue task;%'
    OR c.content_stripped LIKE '%1. 1. James Brooks: 1 critically overdue task;%');

COMMIT;
