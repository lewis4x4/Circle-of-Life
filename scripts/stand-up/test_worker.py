import base64
import fcntl
import hashlib
import io
import json
import os
import tempfile
import unittest
import zipfile
from datetime import date, datetime, timezone
from unittest.mock import patch, mock_open
from xml.etree import ElementTree as ET

from workbook import KEYS, NS, parse_workbook, patch_workbook
from worker import AggregateReader, BridgeError, Haven, HttpFailure, ReconnectRequired, State, auth_fingerprint, changed_prior_weeks, entry_opens_at, file_target, install_haven_credentials, publish_front_office, read_health, recover_pending_google, reporting_week, run_lanes, source_payload, synchronize
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
    def install_fixture(self, directory):
        state_directory = Path(directory) / 'production-state'
        state = State(state_directory)
        state.data.update(
            baselines={'facility:2026-09-14': {'baseline_id': 'baseline-1', 'file_values': {'census': 12}}},
            haven_refresh_token='old-token',
            haven_pending={'action': 'save', 'payload': {'request_id': 'retained'}},
            google_pending={'bytes': 'retained-google'},
            front_office_pending={'body': 'retained-front-office'},
            front_office_sequence=41,
            front_office_last_receipt='receipt-41',
            haven_connection={'state': 'reconnect_required', 'last_connected_at': '2026-09-13T12:00:00+00:00'},
        )
        state.save()
        state.lock.close()
        connection_directory = Path(directory) / 'connection'
        connection_directory.mkdir(mode=0o700)
        credential = connection_directory / 'haven-credentials.json'
        payload = {
            'HAVEN_STAND_UP_REFRESH_TOKEN': 'new-private-token',
            'authorized_at': int(worker.time.time()),
            'actor_id': '00000000-0000-4000-8000-000000000099',
            'organization_id': worker.HAVEN_ORG,
            'facility_ids': sorted(MAP.values()),
        }
        credential.write_text(json.dumps(payload))
        credential.chmod(0o600)
        return state_directory, credential, payload

    def test_expired_haven_session_records_reconnect_and_suppresses_blind_retries(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            state = State(directory)
            state.data['haven_refresh_token'] = 'expired-token'
            state.save()
            with patch.dict('os.environ', {'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'synthetic-anon'}), patch('worker.http', side_effect=HttpFailure(400, 'haven_auth')) as request:
                with self.assertRaisesRegex(ReconnectRequired, 'Reconnect the dedicated Haven operator'):
                    Haven(state)
                self.assertEqual(request.call_count, 1)
                with self.assertRaises(ReconnectRequired) as repeated:
                    Haven(state)
                self.assertTrue(repeated.exception.suppressed)
                self.assertEqual(request.call_count, 1)
            health = read_health(directory)
            self.assertEqual(health['haven']['state'], 'reconnect_required')
            self.assertTrue(health['haven']['reconnect_required'])
            self.assertEqual(health['haven']['reason'], 'credential_expired_or_revoked')
            self.assertEqual(health['haven']['http_status'], 400)
            self.assertTrue(health['recovery']['haven_pending'] is False)
            self.assertNotIn('expired-token', json.dumps(health))
            state.lock.close()

    def test_replaced_haven_session_bypasses_reconnect_suppression(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            state = State(directory)
            state.data.update(haven_refresh_token='expired-token', haven_connection={
                'state': 'reconnect_required',
                'credential_fingerprint': auth_fingerprint('expired-token', 'synthetic-anon'),
                'checked_at': '2026-09-14T00:00:00+00:00',
            })
            state.save()
            state.data['haven_refresh_token'] = 'replacement-token'
            with patch.dict('os.environ', {'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'synthetic-anon'}), patch('worker.http', return_value=(b'{"access_token":"access","refresh_token":"rotated-token"}', {})) as request:
                client = Haven(state)
            self.assertEqual(client.token, 'access')
            self.assertEqual(request.call_count, 1)
            self.assertEqual(state.data['haven_refresh_token'], 'rotated-token')
            self.assertEqual(read_health(directory)['haven']['state'], 'connected')
            state.lock.close()

    def test_corrected_auth_configuration_retries_same_refresh_token(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            state = State(directory)
            state.data.update(haven_refresh_token='same-haven-token', haven_connection={
                'state': 'reconnect_required',
                'credential_fingerprint': auth_fingerprint('same-haven-token', 'old-anon'),
            })
            state.save()
            with patch.dict('os.environ', {'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'corrected-anon'}), patch('worker.http', return_value=(b'{"access_token":"access","refresh_token":"rotated"}', {})) as request:
                Haven(state)
            self.assertEqual(request.call_count, 1)

            state.data['google_connection'] = {
                'state': 'reconnect_required',
                'credential_fingerprint': auth_fingerprint('same-google-token', 'client', 'old-secret'),
            }
            state.save()
            environment = {'GOOGLE_CLIENT_ID': 'client', 'GOOGLE_CLIENT_SECRET': 'corrected-secret', 'GOOGLE_REFRESH_TOKEN': 'same-google-token'}
            with patch.dict('os.environ', environment), patch('worker.http', return_value=(b'{"access_token":"google-access"}', {})) as request:
                worker.Google(state)
            self.assertEqual(request.call_count, 1)
            state.lock.close()

    def test_malformed_auth_response_does_not_disable_saved_credential(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            state = State(directory)
            state.data['haven_refresh_token'] = 'still-retryable'
            state.save()
            with patch.dict('os.environ', {'NEXT_PUBLIC_SUPABASE_ANON_KEY': 'synthetic-anon'}), patch('worker.http', return_value=(b'{}', {})) as request:
                for _ in range(2):
                    with self.assertRaisesRegex(BridgeError, 'saved credential was not disabled'):
                        Haven(state)
            self.assertEqual(request.call_count, 2)
            self.assertNotIn('haven_connection', state.data)
            state.lock.close()

    def test_expired_google_session_requires_reconnect_without_discarding_pending_write(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            state = State(directory)
            state.data['google_pending'] = {'file_id': 'production', 'bytes': 'retained'}
            state.save()
            environment = {'GOOGLE_CLIENT_ID': 'client', 'GOOGLE_CLIENT_SECRET': 'secret', 'GOOGLE_REFRESH_TOKEN': 'expired-google'}
            with patch.dict('os.environ', environment), patch('worker.http', side_effect=HttpFailure(400, 'google_auth')) as request:
                with self.assertRaisesRegex(ReconnectRequired, 'Reconnect the Stand Up workbook account'):
                    worker.Google(state)
                self.assertEqual(request.call_count, 1)
                with self.assertRaises(ReconnectRequired) as repeated:
                    worker.Google(state)
                self.assertTrue(repeated.exception.suppressed)
                self.assertEqual(request.call_count, 1)
            health = read_health(directory)
            self.assertTrue(health['google']['reconnect_required'])
            self.assertEqual(health['google']['reason'], 'credential_expired_or_revoked')
            self.assertTrue(health['google']['pending'])
            self.assertNotIn('expired-google', json.dumps(health))
            state.lock.close()

    def test_health_record_is_redacted_and_carries_delivery_and_recovery_state(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            state = State(directory)
            state.data.update(
                current_reporting_week='2026-09-14',
                haven_refresh_token='secret-refresh',
                haven_pending={'payload': {'values': {'census': 40}}},
                google_pending={'bytes': 'secret-workbook'},
                front_office_pending={'body': 'secret-signed-body'},
                google_last_sync='2026-09-14T12:00:00+00:00',
                front_office_last_published_at='2026-09-14T12:01:00+00:00',
                front_office_last_receipt='receipt-1',
                front_office_sequence=42,
                front_office_rejection={'status': 409, 'sequence': 43},
            )
            state.save()
            health = read_health(directory)
            self.assertEqual(health['current_reporting_week'], '2026-09-14')
            self.assertEqual(health['google']['last_synced_at'], '2026-09-14T12:00:00+00:00')
            self.assertEqual(health['haven_to_front_office']['last_receipt'], 'receipt-1')
            self.assertEqual(health['haven_to_front_office']['sequence'], 42)
            self.assertEqual(health['haven_to_front_office']['rejection']['status'], 409)
            self.assertEqual(health['recovery'], {'haven_pending': True, 'google_pending': True, 'front_office_pending': True})
            rendered = json.dumps(health)
            for secret in ('secret-refresh', 'secret-workbook', 'secret-signed-body', 'census'):
                self.assertNotIn(secret, rendered)
            state.lock.close()

    def test_status_command_reads_health_without_facility_map_or_provider(self):
        expected = {'schema_version': 1, 'state': 'healthy'}
        with patch('sys.argv', ['worker.py', '--state-dir', '/unused', '--status']), patch('worker.read_health', return_value=expected) as health, patch('worker.http') as request, patch('builtins.print') as output:
            worker.main()
        health.assert_called_once_with('/unused')
        request.assert_not_called()
        self.assertEqual(json.loads(output.call_args.args[0]), expected)

    def test_install_command_uses_offline_helper_and_prints_only_redacted_receipt(self):
        receipt = {'status': 'installed', 'state_preserved': True, 'provider': 'haven'}
        arguments = ['worker.py', '--state-dir', '/private/state', '--facility-map', '/private/map.json',
                     '--install-haven-credentials', '/private/connection/haven-credentials.json']
        with patch('sys.argv', arguments), patch('worker.Path.read_text', return_value=json.dumps(MAP)), patch('worker.install_haven_credentials', return_value=receipt) as install, patch('worker.http') as request, patch('builtins.print') as output:
            worker.main()
        install.assert_called_once_with('/private/state', '/private/connection/haven-credentials.json', MAP)
        request.assert_not_called()
        self.assertEqual(json.loads(output.call_args.args[0]), receipt)
        self.assertNotIn('token', output.call_args.args[0].lower())

    def test_validated_haven_credentials_install_preserves_operational_state(self):
        with tempfile.TemporaryDirectory() as directory:
            state_directory, credential, _ = self.install_fixture(directory)
            before = json.loads((state_directory / 'state.json').read_text())
            result = install_haven_credentials(state_directory, credential, MAP)
            after = json.loads((state_directory / 'state.json').read_text())
            self.assertEqual(result, {'status': 'installed', 'state_preserved': True, 'provider': 'haven'})
            for key in ('baselines', 'haven_pending', 'google_pending', 'front_office_pending', 'front_office_sequence', 'front_office_last_receipt'):
                self.assertEqual(after[key], before[key])
            self.assertEqual(after['haven_refresh_token'], 'new-private-token')
            self.assertEqual(after['haven_connection']['state'], 'credentials_installed')
            self.assertEqual(after['haven_connection']['last_connected_at'], '2026-09-13T12:00:00+00:00')
            rendered = json.dumps({'result': result, 'health': read_health(state_directory)})
            self.assertNotIn('new-private-token', rendered)
            self.assertEqual(list(state_directory.glob('.*.next')), [])

    def test_haven_credential_install_refuses_permissions_symlinks_and_wrong_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            state_directory, credential, payload = self.install_fixture(directory)
            credential.chmod(0o644)
            with self.assertRaises(BridgeError):
                install_haven_credentials(state_directory, credential, MAP)
            credential.chmod(0o600)
            link = Path(directory) / 'credential-link.json'
            link.symlink_to(credential)
            with self.assertRaises(BridgeError):
                install_haven_credentials(state_directory, link, MAP)
            credential.write_text(json.dumps({**payload, 'unexpected': True}))
            with self.assertRaisesRegex(BridgeError, 'validated connection schema'):
                install_haven_credentials(state_directory, credential, MAP)
            credential.write_text(json.dumps({**payload, 'authorized_at': payload['authorized_at'] - worker.CREDENTIAL_INSTALL_MAX_AGE - 1}))
            with self.assertRaisesRegex(BridgeError, 'validated connection schema'):
                install_haven_credentials(state_directory, credential, MAP)
            credential.write_text(json.dumps(payload))
            wrong_mapping = {**MAP, next(iter(MAP)): '00000000-0000-4000-8000-000000000088'}
            with self.assertRaisesRegex(BridgeError, 'reviewed production mapping'):
                install_haven_credentials(state_directory, credential, wrong_mapping)
            health_path = state_directory / 'health.json'
            health_path.unlink()
            health_path.symlink_to(credential)
            with self.assertRaises(BridgeError):
                install_haven_credentials(state_directory, credential, MAP)
            state_link = Path(directory) / 'state-link'
            state_link.symlink_to(state_directory, target_is_directory=True)
            with self.assertRaises(BridgeError):
                install_haven_credentials(state_link, credential, MAP)

    def test_haven_credential_install_refuses_active_lock_and_invalid_state(self):
        with tempfile.TemporaryDirectory() as directory:
            state_directory, credential, _ = self.install_fixture(directory)
            with (state_directory / 'worker.lock').open('r+') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                with self.assertRaisesRegex(BridgeError, 'Connector is active'):
                    install_haven_credentials(state_directory, credential, MAP)
            state_path = state_directory / 'state.json'
            state_path.write_text('{"baselines":[]}')
            with self.assertRaisesRegex(BridgeError, 'required schema'):
                install_haven_credentials(state_directory, credential, MAP)

    def test_haven_credential_install_is_atomic_when_replace_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            state_directory, credential, _ = self.install_fixture(directory)
            before = (state_directory / 'state.json').read_bytes()
            with patch('worker.os.replace', side_effect=OSError('synthetic replacement failure')):
                with self.assertRaisesRegex(BridgeError, 'state update failed'):
                    install_haven_credentials(state_directory, credential, MAP)
            self.assertEqual((state_directory / 'state.json').read_bytes(), before)
            self.assertEqual(list(state_directory.glob('.*.next')), [])

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

    def test_rollover_does_not_block_on_unchanged_held_overtime(self):
        original = fixture()
        clean = parse_workbook(original, MAP, 'rehearsal', 'file.xlsx')
        identity = MAP['Homewood'] + ':2026-09-07'
        address = clean['locations'][identity]['cells']['overtime_reported']

        def workbook_values(overtime, census='0'):
            before, output = zipfile.ZipFile(io.BytesIO(original)), io.BytesIO()
            with zipfile.ZipFile(output, 'w') as target:
                for name in before.namelist():
                    content = before.read(name)
                    if name == clean['locations'][identity]['path']:
                        root = ET.fromstring(content)
                        cell = next(node for node in root.findall(f'.//{{{NS}}}c') if node.get('r') == address)
                        cell.find(f'{{{NS}}}v').text = overtime
                        census_address = clean['locations'][identity]['cells']['current_total_census']
                        census_cell = next(node for node in root.findall(f'.//{{{NS}}}c') if node.get('r') == census_address)
                        census_cell.find(f'{{{NS}}}v').text = census
                        content = ET.tostring(root, encoding='utf-8', xml_declaration=True)
                    target.writestr(name, content)
            return output.getvalue()

        baseline_values = {**clean['records'][0]['values'], 'overtime_reported': 15.65}
        baselines = {record['facility_id'] + ':2026-09-07': {'baseline_id': 'r1-' + record['facility_id'], 'file_values': record['values']} for record in clean['records']}
        baselines[identity] = {'baseline_id': 'r1', 'file_values': baseline_values}
        state = FakeState({'baselines': baselines})
        with patch.dict('os.environ', {'STAND_UP_REHEARSAL_FILE_ID': 'rehearsal', 'STAND_UP_PRODUCTION_FILE_ID': 'production'}):
            self.assertEqual(changed_prior_weeks(state, FakeGoogle(workbook_values('15.65')), MAP, date(2026, 9, 14), 'rehearsal'), [])
            with self.assertRaises(BridgeError):
                changed_prior_weeks(state, FakeGoogle(workbook_values('15.75')), MAP, date(2026, 9, 14), 'rehearsal')

            class Operator:
                resolved = False
                def command(self, action, payload):
                    report_values = baselines[payload['facility_id'] + ':2026-09-07']['file_values']
                    report = {'baseline_id': 'r2-' + payload['facility_id'], 'version': 2, 'values': report_values}
                    if action == 'export': return report
                    if action == 'find_recovery': return {'resolved_result': report if self.resolved else None}
                    if action == 'preview_recovery': return {'preview_id': 'review', 'conflicts': ['current_total_census'], 'clears': []}
                    raise AssertionError(action)

            google, operator = FakeGoogle(workbook_values('15.65', '3')), Operator()
            with self.assertRaisesRegex(BridgeError, 'conflict/clear review'):
                synchronize(state, operator, google, MAP, date(2026, 9, 7), 'rehearsal', allow_unchanged_held_overtime=True)
            operator.resolved = True
            synchronize(state, operator, google, MAP, date(2026, 9, 7), 'rehearsal', allow_unchanged_held_overtime=True)
            self.assertEqual(parse_workbook(google.body, MAP, 'rehearsal', 'file.xlsx')['issues'][0]['cell'], address)

    def test_google_failure_does_not_block_front_office(self):
        def failed_google():
            raise BridgeError('No Google ETag')
        outcomes, failures = run_lanes(failed_google, lambda: 'accepted')
        self.assertEqual(outcomes, {'google': 'failed', 'front_office': 'accepted'})
        self.assertEqual(len(failures), 1)

    def test_lane_outcomes_are_durable_without_discarding_pending_recovery(self):
        state = FakeState({'baselines': {}, 'google_pending': {'bytes': 'retained'}})
        outcomes, failures = run_lanes(lambda: (_ for _ in ()).throw(BridgeError('Drive unavailable')), lambda: 'accepted', state=state)
        self.assertEqual(outcomes, {'google': 'failed', 'front_office': 'accepted'})
        self.assertEqual(len(failures), 1)
        self.assertEqual(state.data['google_run']['state'], 'failed')
        self.assertEqual(state.data['front_office_run']['state'], 'accepted')
        self.assertIn('google_pending', state.data)
        self.assertGreaterEqual(state.saves, 2)

    def test_reconnect_failure_has_machine_readable_error_code(self):
        _, failures = run_lanes(lambda: (_ for _ in ()).throw(ReconnectRequired('google', 'reconnect', suppressed=True)))
        self.assertEqual(failures, [{'lane': 'google', 'error': 'reconnect', 'error_code': 'google_reconnect_required'}])

    def test_sunday_and_monday_eastern(self):
        self.assertEqual(reporting_week(datetime(2026, 9, 13, 23, tzinfo=timezone.utc)), date(2026, 9, 14))
        self.assertEqual(reporting_week(datetime(2026, 9, 14, 4, tzinfo=timezone.utc)), date(2026, 9, 14))
        self.assertEqual(reporting_week(datetime(2026, 11, 1, 6, tzinfo=timezone.utc)), date(2026, 11, 2))

    def test_publishing_week_turns_at_the_default_entry_open(self):
        """The publisher stays on the organization default. A facility that opens
        earlier must not move which Monday corporate receives."""
        self.assertEqual(reporting_week(datetime(2026, 9, 20, 3, 59, 59, tzinfo=timezone.utc)), date(2026, 9, 14))
        self.assertEqual(reporting_week(datetime(2026, 9, 20, 4, tzinfo=timezone.utc)), date(2026, 9, 21))
        # Widening a facility to Saturday 12:00 a.m. changes nothing here.
        self.assertEqual(reporting_week(datetime(2026, 9, 19, 4, tzinfo=timezone.utc)), date(2026, 9, 14))

    def test_entry_open_instants_match_the_model_and_sql_table(self):
        """Same five rows as src/lib/stand-up/model.test.ts and
        supabase/tests/review_stand_up_entry_window.sql."""
        for monday, lead, expected in (
            (date(2026, 9, 21), 1965, '2026-09-20T04:00:00+00:00'),
            (date(2026, 9, 21), 3405, '2026-09-19T04:00:00+00:00'),
            (date(2026, 9, 21), 885, '2026-09-20T22:00:00+00:00'),
            (date(2026, 11, 2), 1965, '2026-11-01T04:00:00+00:00'),
            (date(2027, 3, 15), 1965, '2027-03-14T05:00:00+00:00'),
            (date(2026, 11, 30), 3405, '2026-11-28T05:00:00+00:00'),
        ):
            self.assertEqual(entry_opens_at(monday, lead).astimezone(timezone.utc).isoformat(), expected)

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
        state.data['haven_pending'] = {'action': 'commit_recovery', 'payload': {'preview_id': 'fresh'}}
        client.command = lambda *_: {'status': 'applied'}
        self.assertEqual(client.resume(), {'status': 'applied'})
        self.assertNotIn('last_command_rejection', state.data)

    def test_unrelated_success_keeps_definitive_rejection_metadata(self):
        # A refusal is cleared by the action that resolves it, not by the next
        # thing that happens to succeed. health.json is the credential
        # custodian's record of what was refused; an unrelated save elsewhere
        # must not erase it.
        state = FakeState({'haven_pending': {'action': 'commit_recovery', 'payload': {'preview_id': 'stale'}}})
        client = object.__new__(Haven)
        client.state = state
        client.command = lambda *_: (_ for _ in ()).throw(HttpFailure(409))
        with self.assertRaises(HttpFailure):
            client.resume()
        self.assertEqual(state.data['last_command_rejection'], {'action': 'commit_recovery', 'status': 409})
        state.data['haven_pending'] = {'action': 'save', 'payload': {'week': '2026-09-07'}}
        client.command = lambda *_: {'status': 'saved'}
        self.assertEqual(client.resume(), {'status': 'saved'})
        self.assertEqual(state.data['last_command_rejection'], {'action': 'commit_recovery', 'status': 409})

    def test_missing_facility_map_does_not_use_the_reconnect_exit_code(self):
        # Exit 2 is reserved for "credential reconnect required". argparse's
        # parser.error() also exits 2, which would page the custodian for a
        # plain operator typo.
        with patch('sys.argv', ['worker.py', '--state-dir', '/unused', '--publish']), patch('worker.http') as request:
            with self.assertRaises(BridgeError):
                worker.main()
        request.assert_not_called()

    def test_health_reply_is_discriminable_before_and_after_a_record_exists(self):
        with tempfile.TemporaryDirectory() as directory:
            absent = read_health(directory)
            self.assertIs(absent['available'], False)
            self.assertEqual(absent['schema_version'], 1)
            Path(directory, 'health.json').write_text(json.dumps({'schema_version': 1, 'haven': {'state': 'healthy'}}))
            present = read_health(directory)
            self.assertIs(present['available'], True)
            self.assertEqual(present['haven'], {'state': 'healthy'})


if __name__ == '__main__':
    unittest.main()
