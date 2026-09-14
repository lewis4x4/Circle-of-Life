import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "catalog", Path(__file__).with_name("compare-schema-catalog.py"))
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)


class CatalogTest(unittest.TestCase):
    def row(self, identity, digest="same", kind="column"):
        return {"kind": kind, "identity": identity, "digest": digest}

    def test_detects_missing_column_with_applied_ledger_irrelevant(self):
        existing = self.row("public.vendor_facilities.id")
        missing = self.row("public.vendor_facilities.coi_on_file")
        result = catalog.compare([existing], [existing, missing])
        self.assertEqual(result["reference_only"], [missing])

    def test_definition_change_is_not_hidden_by_same_name(self):
        result = catalog.compare(
            [self.row("haven.rollup", "stored", "view")],
            [self.row("haven.rollup", "computed", "view")])
        self.assertEqual(len(result["changed"]), 1)
        self.assertEqual(result["changed"][0]["production_digest"], "stored")

    def test_identical_catalog_is_order_independent(self):
        rows = [self.row("public.x"), self.row("officer.y", kind="function")]
        result = catalog.compare(rows, list(reversed(rows)))
        self.assertFalse(result["changed"])
        self.assertFalse(result["production_only"])
        self.assertFalse(result["reference_only"])

    def test_production_extras_preserved_for_review(self):
        common, extra = self.row("public.x"), self.row("public.legacy")
        self.assertEqual(catalog.compare([common, extra], [common])
                         ["production_only"], [extra])

    def test_invalid_evidence_cannot_pass(self):
        row = self.row("public.x")
        for invalid in ([], {}, [row, row], [{"kind": "column"}]):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    catalog.compare(invalid, [row])


if __name__ == "__main__":
    unittest.main()
