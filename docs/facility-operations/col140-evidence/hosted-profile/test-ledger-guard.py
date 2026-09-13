#!/usr/bin/env python3
"""Local-only validation of captured staging ledger metadata; no Runtime/network."""
import importlib.util,json,pathlib,unittest
OUT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('col140_apply',OUT/'apply-staging.py')
runner=importlib.util.module_from_spec(spec);spec.loader.exec_module(runner)
observed=json.loads((OUT/'ledger-observation.json').read_text())
paths=list((runner.ROOT/'supabase/migrations').glob('*.sql'))
pending=[{'version':f'{i:03d}'} for i in range(1,int(observed['numeric_through'])+1)]+observed['legacy_timestamp_migrations']
class LedgerGuardTests(unittest.TestCase):
 def test_captured_368_row_ledger_with_known_timestamps(self):
  self.assertEqual(len(pending),observed['count'])
  self.assertEqual(runner.validate_ledger(pending,paths),{p.name.split('_',1)[0] for p in paths}-{'366'})
 def test_exact_post_application_set(self):
  self.assertIn('366',runner.validate_ledger(pending+[{'version':'366'}],paths))
 def test_unknown_timestamp_is_not_ignored(self):
  with self.assertRaisesRegex(RuntimeError,'Unexpected ledger'):runner.validate_ledger(pending+[{'version':'20270101000000'}],paths)
 def test_unknown_numeric_version_is_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'Unexpected ledger'):runner.validate_ledger(pending+[{'version':'367'}],paths)
 def test_missing_known_timestamp_is_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'Unexpected ledger'):runner.validate_ledger(pending[:-1],paths)
 def test_missing_numeric_version_is_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'Unexpected ledger'):runner.validate_ledger(pending[1:],paths)
 def test_duplicate_version_is_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'Duplicate ledger'):runner.validate_ledger(pending+[pending[0]],paths)
 def test_same_count_substitution_is_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'Unexpected ledger'):runner.validate_ledger(pending[1:]+[{'version':'20270101000000'}],paths)
 def test_duplicate_local_version_is_rejected(self):
  with self.assertRaisesRegex(RuntimeError,'Duplicate local'):runner.validate_ledger(pending,paths+[paths[0]])
 def test_atomic_query_rechecks_exact_versions_after_lock(self):
  versions=runner.validate_ledger(pending,paths)
  query=runner.build_apply_query('BEGIN; SELECT 1; COMMIT;',versions)
  self.assertLess(query.index('LOCK TABLE'),query.index('array_agg(version ORDER BY version)'))
  self.assertLess(query.index('array_agg(version ORDER BY version)'),query.index('SELECT 1;'))
  self.assertIn('count(*) FROM supabase_migrations.schema_migrations)<>368',query)
  self.assertIn("version='366'",query);self.assertIn("version='365'",query)
  for row in observed['legacy_timestamp_migrations']:self.assertIn("'"+row['version']+"'",query)
  self.assertEqual(query.split('INSERT INTO')[0].count('BEGIN;'),1);self.assertTrue(query.endswith('COMMIT;'))
if __name__=='__main__':unittest.main(verbosity=2)
