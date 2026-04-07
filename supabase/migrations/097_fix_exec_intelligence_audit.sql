-- Add audit tracking fields omitted from 096
ALTER TABLE exec_metric_definitions
  ADD COLUMN created_by uuid REFERENCES auth.users (id),
  ADD COLUMN updated_by uuid REFERENCES auth.users (id);

ALTER TABLE exec_metric_snapshots
  ADD COLUMN created_by uuid REFERENCES auth.users (id),
  ADD COLUMN updated_by uuid REFERENCES auth.users (id);
