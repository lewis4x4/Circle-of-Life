-- KB-NEXT-10: thumbs feedback on Haven Insight (exec_nlq_sessions) answers.
--
-- chat_messages already has a feedback text column (chat surface), but
-- exec_nlq_sessions was created without one. Adding it here so the same
-- thumbs UX works in the Haven Insight panel.
--
-- positive / negative / NULL; tri-state matches chat_messages semantics.

ALTER TABLE public.exec_nlq_sessions
  ADD COLUMN IF NOT EXISTS feedback text
    CHECK (feedback IS NULL OR feedback IN ('positive','negative')),
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz,
  ADD COLUMN IF NOT EXISTS feedback_note text;

COMMENT ON COLUMN public.exec_nlq_sessions.feedback IS
  'KB-NEXT-10: tri-state thumbs feedback (NULL = no rating). Mirrors chat_messages.feedback semantics so the gaps loop can pool both signals.';
