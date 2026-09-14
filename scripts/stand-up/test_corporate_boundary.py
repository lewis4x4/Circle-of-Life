import unittest
from datetime import date, datetime, timezone

from test_workbook import MAP
from worker import FACILITIES, KEYS, PREFIXES, BridgeError, source_payload


class CorporateBoundaryTests(unittest.TestCase):
    def report(self, name, value=1):
        return {
            "facility_id": MAP[name], "week_start": "2026-09-07", "status": "ready", "version": 2,
            "source_as_of": "2026-09-08T12:00:00Z", "values": dict.fromkeys(KEYS, value),
            "field_dispositions": dict.fromkeys(KEYS, "provided"),
        }

    def test_only_existing_stand_up_metrics_cross_the_projection(self):
        payload = source_payload({"reports": [self.report(name) for name in FACILITIES]}, MAP, date(2026, 9, 7), 8, datetime(2026, 9, 9, tzinfo=timezone.utc))
        metrics = {row["metric"] for row in payload["rows"]}
        fixed = {"week_of_day", "expected_facilities", "field_state_version"}
        allowed = fixed | {f"{PREFIXES[name]}_{field}" for name in FACILITIES for field in KEYS}
        allowed |= {f"{PREFIXES[name]}_{field}_state" for name in FACILITIES for field in KEYS}
        allowed |= {f"{PREFIXES[name]}_{field}" for name in FACILITIES for field in ("reported", "ready", "revision", "as_of_epoch", "overtime_minutes", "overtime_issue", "needs_resubmission")}
        self.assertLessEqual(metrics, allowed)
        self.assertTrue({"expected_facilities", "homewood_current_total_census", "grande_cypress_current_total_census"}.issubset(metrics))
        self.assertFalse(any(any(word in metric for word in ("resident", "staff", "signature", "document", "recipient", "packet", "accepted", "note", "path")) for metric in metrics))
        self.assertEqual(payload["dataset"], "standup_weekly")
        self.assertTrue(payload["complete"])

    def test_wrong_source_metric_shape_is_refused_before_projection(self):
        report = self.report("Homewood")
        report["values"] = {**report["values"], "corporate_packet_state": 1}
        with self.assertRaisesRegex(BridgeError, "Unexpected source metric contract"):
            source_payload({"reports": [report]}, MAP, date(2026, 9, 7), 1)


if __name__ == "__main__":
    unittest.main()
