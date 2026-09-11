import base64
import hashlib
import json
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch

from workbook import KEYS, parse_workbook, patch_workbook
from worker import BridgeError, Haven, HttpFailure, changed_prior_weeks, file_target, publish_front_office, recover_pending_google, reporting_week, run_lanes, source_payload, synchronize
from test_workbook import MAP, fixture


class FakeState:
    def __init__(self, data=None):
        self.data = data or {'baselines': {}}
        self.saves = 0

    def save(self):
        self.saves += 1


class FakeGoogle:
    def __init__(self, body=b'original', unknown=False, reject=False):
        self.body, self.unknown, self.reject, self.uploads = body, unknown, reject, 0

    def download(self, file_id):
        return self.body, {'ETag': 'etag'}

    def upload(self, file_id, body, etag):
        self.uploads += 1
        if self.reject:
            raise HttpFailure(412)
        self.body = body
        if self.unknown:
            raise BridgeError('unknown')
        return b'{}', {}


def pending_state():
    return FakeState({'baselines': {}, 'google_pending': {'file_id': 'rehearsal', 'before_sha256': hashlib.sha256(b'original').hexdigest(), 'after_sha256': hashlib.sha256(b'changed').hexdigest(), 'etag': 'etag', 'bytes': base64.b64encode(b'changed').decode(), 'baselines': {'facility:week': {'baseline_id': 'revision', 'file_values': {}}}}})


def workspace():
    return {'reports': [{'facility_id': MAP['Homewood'], 'week_start': '2026-09-07', 'status': 'draft', 'version': 1, 'source_as_of': '2026-09-07T12:00:00Z', 'updated_at': '2026-09-11T01:00:00Z', 'values': {**dict.fromkeys(KEYS), 'current_total_census': 0}}]}


class WorkerTests(unittest.TestCase):
    def test_reviewed_haven_choice_updates_file_and_stops_conflict_loop(self):
        original = fixture()
        parsed = parse_workbook(original, MAP, 'rehearsal', 'file.xlsx')
        by_id = {r['facility_id']: r for r in parsed['records']}
        identity = MAP['Homewood'] + ':2026-09-07'
        incoming = {**by_id[MAP['Homewood']]['values'], 'current_total_census': 10}
        google = FakeGoogle(patch_workbook(original, parsed, {identity: incoming}))
        state = FakeState({'baselines': {r['facility_id'] + ':2026-09-07': {'baseline_id': 'baseline-' + r['facility_id'], 'file_values': r['values']} for r in parsed['records']}})
        class Operator:
            resolved = False
            previews = 0
            def command(self, action, payload):
                facility = payload['facility_id']
                report = {**by_id[facility], 'baseline_id': 'latest-' + facility, 'version': 2, 'values': {**by_id[facility]['values'], **({'current_total_census': 20} if facility == MAP['Homewood'] else {})}}
                if action == 'export': return report
                if action == 'find_recovery': return {'resolved_result': report if self.resolved else None}
                if action == 'preview_recovery':
                    self.previews += 1
                    return {'preview_id': 'review', 'conflicts': ['current_total_census'], 'clears': []}
                raise AssertionError(action)
        operator = Operator()
        with patch.dict('os.environ', {'STAND_UP_REHEARSAL_FILE_ID': 'rehearsal', 'STAND_UP_PRODUCTION_FILE_ID': 'production'}):
            with self.assertRaises(BridgeError):
                synchronize(state, operator, google, MAP, date(2026, 9, 7), 'rehearsal')
            self.assertEqual(google.uploads, 0)
            self.assertEqual(operator.previews, 1)
            operator.resolved = True
            synchronize(state, operator, google, MAP, date(2026, 9, 7), 'rehearsal')
            self.assertEqual(google.uploads, 1)
            self.assertNotIn('google_pending', state.data)
            actual = parse_workbook(google.body, MAP, 'rehearsal', 'file.xlsx')
            self.assertEqual(actual['records'][0]['values']['current_total_census'], 20)
            synchronize(state, operator, google, MAP, date(2026, 9, 7), 'rehearsal')
            self.assertEqual(operator.previews, 1)
            self.assertEqual(google.uploads, 1)

    def test_rollover_detects_prior_week_outage_edit(self):
        original = fixture()
        parsed = parse_workbook(original, MAP, 'rehearsal', 'file.xlsx')
        r = parsed['records'][0]
        identity = r['facility_id'] + ':2026-09-07'
        state = FakeState({'baselines': {identity: {'baseline_id': 'r1', 'file_values': r['values']}}})
        changed = patch_workbook(original, parsed, {identity: {**r['values'], 'current_total_census': 3}})
        with patch.dict('os.environ', {'STAND_UP_REHEARSAL_FILE_ID': 'rehearsal', 'STAND_UP_PRODUCTION_FILE_ID': 'production'}):
            self.assertEqual(changed_prior_weeks(state, FakeGoogle(changed), MAP, date(2026, 9, 14), 'rehearsal'), [date(2026, 9, 7)])

    def test_google_failure_does_not_block_front_office(self):
        def failed_google():
            raise BridgeError('No Google ETag')
        outcomes, failures = run_lanes(failed_google, lambda: 'accepted')
        self.assertEqual(outcomes, {'google': 'failed', 'front_office': 'accepted'})
        self.assertEqual(len(failures), 1)

    def test_sunday_and_monday_eastern(self):
        self.assertEqual(reporting_week(datetime(2026, 9, 13, 23, tzinfo=timezone.utc)), date(2026, 9, 14))
        self.assertEqual(reporting_week(datetime(2026, 9, 14, 4, tzinfo=timezone.utc)), date(2026, 9, 14))
        self.assertEqual(reporting_week(datetime(2026, 11, 1, 6, tzinfo=timezone.utc)), date(2026, 11, 2))

    def test_aggregate_omits_missing_preserves_zero_and_old_asof(self):
        payload = source_payload(workspace(), MAP, date(2026, 9, 7), 1)
        rows = {r['metric']: r['value'] for r in payload['rows']}
        self.assertEqual(rows['homewood_current_total_census'], 0)
        self.assertNotIn('homewood_monthly_rent_roll_cents', rows)
        self.assertEqual(rows['oakridge_reported'], 0)
        self.assertEqual(payload['sourceAsOf'], '2026-09-07T12:00:00.000Z')
        self.assertNotIn('updated_at', json.dumps(payload))

    def test_unknown_historic_asof_not_import_time(self):
        data = workspace()
        data['reports'][0]['source_as_of'] = None
        payload = source_payload(data, MAP, date(2026, 9, 7), 1)
        self.assertEqual(payload['sourceAsOf'], '2026-09-07T00:00:00.000Z')
        self.assertNotIn('homewood_as_of_epoch', [r['metric'] for r in payload['rows']])

    def test_sunday_empty_snapshot_never_future(self):
        now = datetime(2026, 9, 13, 12, tzinfo=timezone.utc)
        payload = source_payload({'reports': []}, MAP, date(2026, 9, 14), 1, now)
        self.assertEqual(payload['sourceAsOf'], '2026-09-13T12:00:00.000Z')

    def test_unknown_success_readback_does_not_write_twice(self):
        state, google = pending_state(), FakeGoogle(unknown=True)
        with self.assertRaises(BridgeError):
            recover_pending_google(state, google, 'rehearsal')
        self.assertIn('google_pending', state.data)
        self.assertEqual(state.data['baselines'], {})
        recover_pending_google(state, google, 'rehearsal')
        self.assertEqual(google.uploads, 1)
        self.assertNotIn('google_pending', state.data)
        self.assertIn('facility:week', state.data['baselines'])

    def test_external_change_after_unknown_never_overwritten(self):
        state, google = pending_state(), FakeGoogle(body=b'staff-edited')
        with self.assertRaises(BridgeError):
            recover_pending_google(state, google, 'rehearsal')
        self.assertEqual(google.uploads, 0)
        self.assertIn('google_pending', state.data)

    def test_definite_conditional_rejection_keeps_old_baseline(self):
        state = pending_state()
        with self.assertRaises(HttpFailure):
            recover_pending_google(state, FakeGoogle(reject=True), 'rehearsal')
        self.assertNotIn('google_pending', state.data)
        self.assertEqual(state.data['baselines'], {})

    def test_pending_cannot_cross_files(self):
        with self.assertRaises(BridgeError):
            recover_pending_google(pending_state(), FakeGoogle(), 'production')

    def test_rehearsal_cannot_equal_production(self):
        with patch.dict('os.environ', {'STAND_UP_REHEARSAL_FILE_ID': 'same', 'STAND_UP_PRODUCTION_FILE_ID': 'same'}):
            with self.assertRaises(BridgeError):
                file_target('rehearsal')

    def test_front_office_unknown_retries_identical_bytes_batch(self):
        state, bodies = FakeState(), []
        def fail_once(url, method, body, headers):
            bodies.append(body)
            if len(bodies) == 1:
                raise BridgeError('unknown')
            return b'{"receiptId":"accepted"}', {}
        with patch.dict('os.environ', {'FRONT_OFFICE_INGEST_KEY_ID': 'test', 'FRONT_OFFICE_INGEST_SECRET': 's' * 32}), patch('worker.http', side_effect=fail_once):
            with self.assertRaises(BridgeError):
                publish_front_office(state, workspace(), MAP, date(2026, 9, 7))
            self.assertIn('front_office_pending', state.data)
            publish_front_office(state, workspace(), MAP, date(2026, 9, 7))
            self.assertEqual(bodies[0], bodies[1])
            self.assertEqual(state.data['front_office_sequence'], 1)
            self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'unchanged')

    def test_haven_rejected_command_can_be_repreviewed(self):
        state = FakeState({'haven_pending': {'action': 'commit_recovery', 'payload': {'preview_id': 'stale'}}})
        client = object.__new__(Haven)
        client.state = state
        client.command = lambda *_: (_ for _ in ()).throw(HttpFailure(409))
        with self.assertRaises(HttpFailure):
            client.resume()
        self.assertNotIn('haven_pending', state.data)
        self.assertEqual(state.data['last_command_rejection']['status'], 409)


if __name__ == '__main__':
    unittest.main()
