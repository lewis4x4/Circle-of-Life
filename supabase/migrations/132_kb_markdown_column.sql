-- Add markdown_text column to documents table.
-- raw_text = original extracted plain text (kept for FTS fallback + reprocessing).
-- markdown_text = structured Markdown IR (used for chunking + display).
-- conversion_method = how the Markdown was generated (for audit/reprocessing).

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS markdown_text text,
  ADD COLUMN IF NOT EXISTS conversion_method text;

COMMENT ON COLUMN public.documents.markdown_text IS 'Markdown intermediate representation generated from the uploaded file. Used for semantic chunking.';
COMMENT ON COLUMN public.documents.conversion_method IS 'How markdown_text was generated: mammoth_html_turndown | llm_text_to_md | llm_vision_pdf | xlsx_programmatic | passthrough_md | passthrough_text';
