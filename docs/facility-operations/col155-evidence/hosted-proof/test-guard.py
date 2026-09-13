"""Local-only migration guard tests; never constructs Runtime or opens network."""
import importlib.util,pathlib,sys,unittest
HERE=pathlib.Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
spec=importlib.util.spec_from_file_location('apply',HERE/'apply-staging.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class GuardTests(unittest.TestCase):
 def setUp(self):self.paths=[pathlib.Path(x) for x in ['365_previous.sql','366_profile.sql','367_hfo_resident_source_reviews.sql','20260514180000_legacy.sql']]
 def test_exact_before_and_after(self):
  for versions in [['365','366','20260514180000'],['365','366','367','20260514180000']]:self.assertEqual(module.validate_ledger([{'version':v} for v in versions],self.paths),set(versions))
 def test_unknown_omitted_and_duplicate_rejected(self):
  for versions in [['365','366'],['365','366','20260514180000','20260913999999'],['365','366','20260514180000','366']]:
   with self.assertRaises(RuntimeError):module.validate_ledger([{'version':v} for v in versions],self.paths)
 def test_atomic_target_and_exact_set(self):
  query=module.build_apply_query('BEGIN; SELECT 1; COMMIT;',{'365','366','20260514180000'})
  self.assertIn('EXCLUSIVE MODE',query);self.assertIn("version='367'",query);self.assertIn("version='366'",query);self.assertIn("VALUES('367','hfo_resident_source_reviews'",query);self.assertIn('array_agg(version ORDER BY version)',query)
if __name__=='__main__':unittest.main()
