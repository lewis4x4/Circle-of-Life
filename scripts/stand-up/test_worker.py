import base64
import hashlib
import json
import unittest
from datetime import date, datetime, timezone
from unittest.mock import patch, mock_open

from workbook import KEYS, parse_workbook, patch_workbook
from worker import AggregateReader, BridgeError, Haven, HttpFailure, changed_prior_weeks, file_target, publish_front_office, recover_pending_google, reporting_week, run_lanes, source_payload, synchronize
from test_workbook import MAP, fixture
import worker
from pathlib import Path


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


class ProbeGoogle:
    def __init__(self, body, interrupt_restore=False, ignore_stale=False):
        self.body, self.version, self.uploads = body, 1, []
        self.interrupt_restore, self.ignore_stale = interrupt_restore, ignore_stale

    def download(self, file_id):
        return self.body, {"ETag": '"v%d"' % self.version, "X-Haven-Drive-Version": str(self.version)}

    def upload(self, file_id, body, etag):
        self.uploads.append((body, etag))
        if etag != '"v%d"' % self.version and not self.ignore_stale:
            raise HttpFailure(412)
        if self.interrupt_restore and len(self.uploads) == 3:
            raise BridgeError("interrupted before restore")
        self.body = body
        self.version += 1
        return b'{}', {}


class GoogleTransportTests(unittest.TestCase):
    def client(self):
        client = object.__new__(worker.Google)
        client.token = "synthetic-token"
        return client

    def metadata(self, body=b"binary"):
        return {"id": "file", "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "etag": '"v1"', "version": "1", "headRevisionId": "revision1", "md5Checksum": hashlib.md5(body).hexdigest(), "fileSize": str(len(body)), "labels": {"trashed": False}}

    def test_stable_metadata_associates_binary_with_v2_etag(self):
        meta = json.dumps(self.metadata()).encode()
        with patch('worker.http', side_effect=[(meta, {}), (b'binary', {}), (meta, {})]) as request:
            body, headers = self.client().download('file')
        self.assertEqual(body, b'binary')
        self.assertEqual(headers['ETag'], '"v1"')
        self.assertIn('/drive/v2/files/', request.call_args_list[0].args[0])
        self.assertIn('/drive/v3/files/', request.call_args_list[1].args[0])

    def test_metadata_race_rejected(self):
        before = self.metadata()
        after = {**before, "version": "2", "etag": '"v2"'}
        with patch('worker.http', side_effect=[(json.dumps(before).encode(), {}), (b'binary', {}), (json.dumps(after).encode(), {})] * 3) as request, patch('worker.time.sleep'), patch('builtins.print'):
            with self.assertRaisesRegex(BridgeError, 'three complete reads.*metadata_changed'):
                self.client().download('file')
            self.assertEqual(request.call_count, 9)

    def test_checksum_and_size_mismatch_rejected(self):
        for body in (b'wrong!', b'longer-binary'):
            meta = json.dumps(self.metadata()).encode()
            with patch('worker.http', side_effect=[(meta, {}), (body, {}), (meta, {})] * 3) as request, patch('worker.time.sleep'), patch('builtins.print'):
                with self.assertRaisesRegex(BridgeError, 'three complete reads.*checksum_or_size_mismatch'):
                    self.client().download('file')
                self.assertEqual(request.call_count, 9)

    def test_transient_snapshot_race_retries_fresh_then_stabilizes(self):
        before = self.metadata()
        after = {**before, "version": "2", "etag": '"v2"', "headRevisionId": "revision2"}
        sequence = [(json.dumps(before).encode(), {}), (b'binary', {}), (json.dumps(after).encode(), {}), (json.dumps(after).encode(), {}), (b'binary', {}), (json.dumps(after).encode(), {})]
        with patch('worker.http', side_effect=sequence) as request, patch('worker.time.sleep') as sleep, patch('builtins.print'):
            body, headers = self.client().download('file')
        self.assertEqual(request.call_count, 6)
        self.assertEqual(headers['ETag'], '"v2"')
        self.assertEqual(body, b'binary')
        sleep.assert_called_once_with(0.25)
        self.assertTrue(all(c.kwargs.get('method', 'GET') == 'GET' for c in request.call_args_list))

    def test_transient_checksum_mismatch_retries_full_snapshot(self):
        meta = json.dumps(self.metadata()).encode()
        sequence = [(meta, {}), (b'wrong!', {}), (meta, {}), (meta, {}), (b'binary', {}), (meta, {})]
        with patch('worker.http', side_effect=sequence) as request, patch('worker.time.sleep'), patch('builtins.print'):
            self.assertEqual(self.client().download('file')[0], b'binary')
        self.assertEqual(request.call_count, 6)

    def test_malformed_metadata_not_retried(self):
        meta = {**self.metadata(), 'etag': 'W/"weak"'}
        with patch('worker.http', return_value=(json.dumps(meta).encode(), {})) as request, patch('worker.time.sleep') as sleep:
            with self.assertRaises(BridgeError):
                self.client().download('file')
        self.assertEqual(request.call_count, 1)
        sleep.assert_not_called()

    def test_upload_only_v2_strong_conditional_put(self):
        with patch('worker.http', return_value=(b'{}', {})) as request:
            for etag in ('*', 'W/"v1"', '', 'v1'):
                with self.assertRaises(BridgeError):
                    self.client().upload('file', b'body', etag)
            request.assert_not_called()
            self.client().upload('file', b'body', '"v1"')
            self.assertIn('/upload/drive/v2/files/', request.call_args.args[0])
            self.assertEqual(request.call_args.args[1], 'PUT')
            self.assertEqual(request.call_args.args[3]['If-Match'], '"v1"')

    def test_probe_real_stale_etag_distinct_payload_and_restore(self):
        original = fixture()
        google, state = ProbeGoogle(original), FakeState()
        state.directory = Path('/unused-synthetic')
        with patch('worker.os.open', return_value=123), patch('worker.os.fdopen', mock_open()), patch('worker.os.fsync'), patch('builtins.print'):
            worker.probe_google(state, google, 'rehearsal')
        self.assertEqual(google.body, original)
        self.assertEqual(len(google.uploads), 3)
        self.assertEqual(google.uploads[0][1], google.uploads[1][1])
        self.assertNotEqual(google.uploads[0][0], google.uploads[1][0])
        self.assertTrue(state.data['provider_proof']['real_stale_etag_rejection'])
        self.assertNotIn('probe_original', state.data)

    def test_interrupted_probe_restores_but_never_marks_pass(self):
        original = fixture()
        google, state = ProbeGoogle(original, interrupt_restore=True), FakeState()
        with self.assertRaises(BridgeError):
            worker.probe_google(state, google, 'rehearsal')
        self.assertIn('probe_original', state.data)
        self.assertNotEqual(google.body, original)
        with self.assertRaisesRegex(BridgeError, 'Interrupted rehearsal restored'):
            worker.probe_google(state, google, 'rehearsal')
        self.assertEqual(google.body, original)
        self.assertNotIn('provider_proof', state.data)

    def test_interrupted_probe_preserves_concurrent_revision(self):
        original = fixture()
        google, state = ProbeGoogle(original, interrupt_restore=True), FakeState()
        with self.assertRaises(BridgeError):
            worker.probe_google(state, google, 'rehearsal')
        google.version += 1  # Even a metadata-only concurrent change requires review.
        count = len(google.uploads)
        with self.assertRaisesRegex(BridgeError, 'revision changed'):
            worker.probe_google(state, google, 'rehearsal')
        self.assertEqual(len(google.uploads), count)
        self.assertIn('probe_original', state.data)

    def test_ignored_stale_write_cannot_produce_proof_or_overwrite_again(self):
        google, state = ProbeGoogle(fixture(), ignore_stale=True), FakeState()
        with self.assertRaisesRegex(BridgeError, 'accepted a stale'):
            worker.probe_google(state, google, 'rehearsal')
        with self.assertRaisesRegex(BridgeError, 'changed during probe'):
            worker.probe_google(state, google, 'rehearsal')
        self.assertEqual(len(google.uploads), 2)
        self.assertNotIn('provider_proof', state.data)


class WorkerTests(unittest.TestCase):
    def test_empty_week_initializes_immutable_baseline_then_recovers_file_edit(self):
        raw = fixture(blank=True)
        google, state = FakeGoogle(raw), FakeState()
        class Operator:
            def __init__(self):
                self.exports = {facility: {"baseline_id": None, "version": 0, "values": dict.fromkeys(KEYS)} for facility in MAP.values()}
                self.saved, self.recoveries, self.previews = [], [], {}
            def command(self, action, payload):
                if action == 'export':
                    return self.exports[payload['facility_id']]
                if action == 'find_recovery':
                    return {'resolved_result': None}
                if action == 'preview_recovery':
                    self.recoveries.append(payload)
                    self.previews['review'] = payload
                    return {'preview_id': 'review', 'conflicts': [], 'clears': []}
                raise AssertionError(action)
            def mutate(self, action, payload):
                facility = payload['facility_id']
                if action == 'save':
                    self.saved.append(payload)
                    self.exports[facility] = {'baseline_id': 'empty-' + facility, 'version': 1, 'values': payload['values']}
                elif action == 'commit_recovery':
                    incoming = self.previews[payload['preview_id']]
                    self.exports[facility] = {'baseline_id': 'edited-' + facility, 'version': 2, 'values': incoming['values']}
                else:
                    raise AssertionError(action)
        operator = Operator()
        with patch.dict('os.environ', {'STAND_UP_REHEARSAL_FILE_ID': 'rehearsal', 'STAND_UP_PRODUCTION_FILE_ID': 'production'}):
            synchronize(state, operator, google, MAP, date(2026, 9, 7), 'rehearsal')
            self.assertEqual(len(operator.saved), 5)
            self.assertTrue(all(p['reason'] == 'Empty weekly fallback initialization' and p['status'] == 'draft' and p['values'] == dict.fromkeys(KEYS) for p in operator.saved))
            self.assertEqual(google.uploads, 0)
            baseline = state.data['baselines'][MAP['Homewood'] + ':2026-09-07']['baseline_id']
            parsed = parse_workbook(raw, MAP, 'rehearsal', 'file.xlsx')
            incoming = {**dict.fromkeys(KEYS), 'current_total_census': 12}
            google.body = patch_workbook(raw, parsed, {MAP['Homewood'] + ':2026-09-07': incoming})
            synchronize(state, operator, google, MAP, date(2026, 9, 7), 'rehearsal')
            self.assertEqual(len(operator.saved), 5)  # Later edit uses recovery, not adoption.
            self.assertEqual(operator.recoveries[0]['baseline_id'], baseline)
            self.assertEqual(operator.exports[MAP['Homewood']]['values'], incoming)
            self.assertEqual(google.uploads, 0)

    def test_nonempty_file_against_blank_haven_still_requires_adoption(self):
        google, state = FakeGoogle(fixture()), FakeState()
        class Operator:
            def command(self, action, payload):
                return {'baseline_id': None, 'version': 0, 'values': dict.fromkeys(KEYS)}
            def mutate(self, *_):
                raise AssertionError('Must not automatically adopt nonempty file')
        with patch.dict('os.environ', {'STAND_UP_REHEARSAL_FILE_ID': 'rehearsal', 'STAND_UP_PRODUCTION_FILE_ID': 'production'}):
            with self.assertRaisesRegex(BridgeError, 'explicit --adopt'):
                synchronize(state, Operator(), google, MAP, date(2026, 9, 7), 'rehearsal')
        self.assertEqual(google.uploads, 0)
        self.assertEqual(state.data['baselines'], {})

    def test_empty_baseline_is_not_reported_or_ready_and_does_not_age_snapshot(self):
        data = workspace()
        data['reports'][0].update(values=dict.fromkeys(KEYS), status='ready')
        now = datetime(2026, 9, 13, 12, tzinfo=timezone.utc)
        payload = source_payload(data, MAP, date(2026, 9, 7), 1, now)
        rows = {row['metric']: row['value'] for row in payload['rows']}
        self.assertEqual(rows['homewood_reported'], 0)
        self.assertEqual(rows['homewood_ready'], 0)
        self.assertNotIn('homewood_as_of_epoch', rows)
        self.assertEqual(payload['sourceAsOf'], '2026-09-13T12:00:00.000Z')
        self.assertFalse(any('homewood_' + key in rows for key in KEYS))

    def test_service_mode_rejects_google_probe_before_state_or_network(self):
        args = ['worker.py', '--state-dir', '/unused', '--facility-map', '/unused.json', '--publish', '--publisher-service', '--probe-google']
        with patch('sys.argv', args), patch('worker.State') as state, patch('worker.Google') as google:
            with self.assertRaises(BridgeError):
                worker.main()
            state.assert_not_called()
            google.assert_not_called()

    def test_service_publisher_calls_only_scoped_aggregate_rpc(self):
        calls = []
        def request(url, method, body, headers):
            calls.append((url, json.loads(body)))
            return b'{"facilities":[],"reports":[]}', {}
        with patch.dict('os.environ', {'SUPABASE_SERVICE_ROLE_KEY': 'synthetic-service-key', 'STAND_UP_ORGANIZATION_ID': '00000000-0000-4000-8000-000000000001'}), patch('worker.http', side_effect=request):
            reader = AggregateReader(date(2026, 9, 7))
            reader.workspace()
        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0][0].endswith('/rest/v1/rpc/stand_up_export_aggregate'))
        self.assertEqual(calls[0][1]['p_week_start'], '2026-09-07')

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

    def test_field_states_published_for_every_metric_when_dispositions_are_stored(self):
        data = workspace()
        held = {**dict.fromkeys(KEYS), 'monthly_rent_roll_cents': 9645385, 'current_total_census': 34}
        data['reports'][0].update(values=held, entry_origin='imported', overtime_minutes=None, overtime_issue=False,
                                  field_dispositions={'overtime_reported': 'historical_unit_unconfirmed'})
        data['reports'].append({'facility_id': MAP['Oakridge'], 'week_start': '2026-09-07', 'status': 'draft', 'version': 2, 'source_as_of': None,
                                'values': {**dict.fromkeys(KEYS), 'current_total_census': 49, 'overtime_reported': 15.65}, 'entry_origin': 'manual',
                                'overtime_minutes': None, 'overtime_issue': True, 'field_dispositions': {}})
        data['reports'].append({'facility_id': MAP['Rising Oaks'], 'week_start': '2026-09-07', 'status': 'draft', 'version': 1, 'source_as_of': None,
                                'values': {**dict.fromkeys(KEYS), 'current_total_census': 49, 'overtime_reported': 1.42}, 'entry_origin': 'manual',
                                'overtime_minutes': 102, 'overtime_issue': False, 'field_dispositions': {}})
        data['reports'].append({'facility_id': MAP['Plantation'], 'week_start': '2026-09-07', 'status': 'draft', 'version': 1, 'source_as_of': None,
                                'values': dict.fromkeys(KEYS), 'entry_origin': 'initialized', 'overtime_minutes': None, 'overtime_issue': False, 'field_dispositions': {}})
        rows = {r['metric']: r['value'] for r in source_payload(data, MAP, date(2026, 9, 7), 1)['rows']}
        self.assertEqual(rows['field_state_version'], 1)
        self.assertEqual(rows['homewood_overtime_reported_state'], 2)  # held_unit_unconfirmed, raw value never converted
        self.assertNotIn('homewood_overtime_reported', rows)
        self.assertEqual(rows['homewood_monthly_rent_roll_cents_state'], 0)
        self.assertEqual(rows['homewood_callouts_last_week_state'], 1)
        self.assertEqual(rows['oakridge_overtime_reported_state'], 3)  # needs_duration_review keeps the raw 15.65 beside it
        self.assertEqual(rows['oakridge_overtime_reported'], 15.65)
        self.assertEqual(rows['oakridge_overtime_issue'], 1)
        self.assertEqual(rows['rising_oaks_overtime_reported_state'], 0)
        self.assertEqual(rows['rising_oaks_overtime_minutes'], 102)
        self.assertEqual(rows['plantation_reported'], 0)  # initialized baseline: no report, so no state rows
        self.assertFalse(any(m.startswith('plantation_') and m.endswith('_state') for m in rows))
        self.assertFalse(any(m.startswith('grande_cypress_') and m.endswith('_state') for m in rows))
        for prefix in ('homewood', 'oakridge', 'rising_oaks'):
            self.assertEqual(sum(1 for m in rows if m.startswith(prefix + '_') and m.endswith('_state')), len(KEYS))
        self.assertTrue(all(v in (0, 1, 2, 3, 4) for m, v in rows.items() if m.endswith('_state')))

    def test_legacy_haven_without_dispositions_publishes_no_states(self):
        rows = {r['metric']: r['value'] for r in source_payload(workspace(), MAP, date(2026, 9, 7), 1)['rows']}
        self.assertNotIn('field_state_version', rows)
        self.assertFalse(any(m.endswith('_state') for m in rows))
        mixed = workspace()
        mixed['reports'][0]['field_dispositions'] = {}
        mixed['reports'].append({**mixed['reports'][0], 'facility_id': MAP['Oakridge']})
        del mixed['reports'][1]['field_dispositions']
        rows = {r['metric']: r['value'] for r in source_payload(mixed, MAP, date(2026, 9, 7), 1)['rows']}
        self.assertNotIn('field_state_version', rows)
        self.assertFalse(any(m.endswith('_state') for m in rows))

    def test_malformed_dispositions_are_refused(self):
        data = workspace()
        data['reports'][0]['field_dispositions'] = ['historical_unit_unconfirmed']
        with self.assertRaisesRegex(BridgeError, 'field dispositions'):
            source_payload(data, MAP, date(2026, 9, 7), 1)

    def test_empty_week_with_dispositions_everywhere_is_versioned_without_state_rows(self):
        payload = source_payload({'reports': []}, MAP, date(2026, 9, 14), 1, datetime(2026, 9, 13, 12, tzinfo=timezone.utc))
        rows = {r['metric']: r['value'] for r in payload['rows']}
        self.assertEqual(rows['field_state_version'], 1)
        self.assertFalse(any(m.endswith('_state') for m in rows))

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

    def test_current_feed_renews_unchanged_at_240_seconds_without_freshening_source(self):
        state = FakeState()
        with patch.dict('os.environ', {'FRONT_OFFICE_INGEST_KEY_ID': 'current-key', 'FRONT_OFFICE_INGEST_SECRET': 's' * 32}), patch('worker.time.time', return_value=1000) as clock, patch('worker.http', return_value=(b'{"receiptId":"accepted","replayed":false}', {})) as request:
            self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'accepted')
            first = json.loads(request.call_args.args[2])
            clock.return_value = 1239
            self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'unchanged')
            self.assertEqual(request.call_count, 1)
            clock.return_value = 1240
            self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'accepted')
            renewed = json.loads(request.call_args.args[2])
            self.assertEqual(renewed['rows'], first['rows'])
            self.assertEqual(renewed['sourceAsOf'], first['sourceAsOf'])
            self.assertNotEqual(renewed['batchId'], first['batchId'])
            self.assertEqual(renewed['sequence'], first['sequence'] + 1)
            self.assertEqual(state.data['front_office_last_admitted_at'], 1240)
            self.assertFalse(any(key.startswith('history_') for key in state.data))

    def test_current_feed_new_content_does_not_wait_for_renewal(self):
        state = FakeState()
        with patch.dict('os.environ', {'FRONT_OFFICE_INGEST_KEY_ID': 'current-key', 'FRONT_OFFICE_INGEST_SECRET': 's' * 32}), patch('worker.time.time', return_value=1000) as clock, patch('worker.http', return_value=(b'{"receiptId":"accepted","replayed":false}', {})) as request:
            publish_front_office(state, workspace(), MAP, date(2026, 9, 7))
            first = json.loads(request.call_args.args[2])
            clock.return_value = 1001
            changed = workspace()
            changed['reports'][0]['values']['current_total_census'] = 1
            self.assertEqual(publish_front_office(state, changed, MAP, date(2026, 9, 7)), 'accepted')
            second = json.loads(request.call_args.args[2])
            self.assertEqual(second['sequence'], 2)
            self.assertEqual(second['sourceAsOf'], first['sourceAsOf'])
            self.assertNotEqual(second['rows'], first['rows'])
            self.assertEqual(request.call_args.args[3]['x-ingest-key-id'], 'current-key')
            self.assertEqual(second['dataset'], 'standup_weekly')

    def test_current_feed_upgrade_without_admission_time_renews_once(self):
        state = FakeState()
        with patch.dict('os.environ', {'FRONT_OFFICE_INGEST_KEY_ID': 'current-key', 'FRONT_OFFICE_INGEST_SECRET': 's' * 32}), patch('worker.time.time', return_value=1000) as clock, patch('worker.http', return_value=(b'{"receiptId":"accepted","replayed":false}', {})) as request:
            publish_front_office(state, workspace(), MAP, date(2026, 9, 7))
            state.data.pop('front_office_last_admitted_at')  # Existing pre-renewal state.
            state.data['front_office_sequence'] = 41
            clock.return_value = 1001
            self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'accepted')
            self.assertEqual(json.loads(request.call_args.args[2])['sequence'], 42)
            self.assertEqual(state.data['front_office_last_admitted_at'], 1001)
            clock.return_value = 1002
            self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'unchanged')
            self.assertEqual(request.call_count, 2)

    def test_current_feed_old_unknown_receipt_is_replayed_then_renewed_next_poll(self):
        for legacy_pending in (False, True):
            with self.subTest(legacy_pending=legacy_pending):
                state, bodies = FakeState(), []
                def response(url, method, body, headers):
                    bodies.append(body)
                    self.assertGreater(state.saves, 0)
                    self.assertEqual(state.data['front_office_pending']['body'].encode(), body)
                    if len(bodies) == 1:
                        self.assertEqual(state.data['front_office_pending']['first_sent_at'], 1000)
                        raise BridgeError('Acceptance response lost')
                    return json.dumps({'receiptId': 'old-receipt' if len(bodies) == 2 else 'new-receipt', 'replayed': len(bodies) == 2}).encode(), {}
                with patch.dict('os.environ', {'FRONT_OFFICE_INGEST_KEY_ID': 'current-key', 'FRONT_OFFICE_INGEST_SECRET': 's' * 32}), patch('worker.time.time', return_value=1000) as clock, patch('worker.http', side_effect=response):
                    with self.assertRaises(BridgeError):
                        publish_front_office(state, workspace(), MAP, date(2026, 9, 7))
                    self.assertNotIn('front_office_last_admitted_at', state.data)
                    if legacy_pending:
                        state.data['front_office_pending'].pop('first_sent_at')
                    clock.return_value = 1600
                    self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'accepted')
                    self.assertEqual(bodies[0], bodies[1])
                    self.assertEqual(state.data['front_office_sequence'], 1)
                    self.assertEqual(state.data['front_office_last_admitted_at'], None if legacy_pending else 1000)
                    clock.return_value = 1601
                    self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'accepted')
                    old, renewed = json.loads(bodies[0]), json.loads(bodies[2])
                    self.assertEqual(renewed['rows'], old['rows'])
                    self.assertEqual(renewed['sourceAsOf'], old['sourceAsOf'])
                    self.assertNotEqual(renewed['batchId'], old['batchId'])
                    self.assertEqual(renewed['sequence'], 2)
                    self.assertEqual(state.data['front_office_last_admitted_at'], 1601)
                    self.assertNotIn('front_office_pending', state.data)
                    clock.return_value = 1602
                    self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'unchanged')

    def test_current_feed_retry_new_admission_uses_retry_time_not_old_attempt(self):
        state = FakeState()
        with patch.dict('os.environ', {'FRONT_OFFICE_INGEST_KEY_ID': 'current-key', 'FRONT_OFFICE_INGEST_SECRET': 's' * 32}), patch('worker.time.time', return_value=1000) as clock, patch('worker.http', side_effect=[BridgeError('Not known if received'), (b'{"receiptId":"new","replayed":false}', {})]) as request:
            with self.assertRaises(BridgeError):
                publish_front_office(state, workspace(), MAP, date(2026, 9, 7))
            clock.return_value = 1600
            self.assertEqual(publish_front_office(state, workspace(), MAP, date(2026, 9, 7)), 'accepted')
            self.assertEqual(request.call_args_list[0].args[2], request.call_args_list[1].args[2])
            self.assertEqual(state.data['front_office_last_admitted_at'], 1600)
            clock.return_value = 1601
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
