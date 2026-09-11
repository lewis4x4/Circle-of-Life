"""Pure archive transport tests: no production network or credentials."""
import copy
import json
import unittest
from datetime import date
from decimal import Decimal
from unittest.mock import patch, MagicMock

from test_worker import FakeState, workspace
from test_workbook import MAP, fixture
from workbook import WorkbookError, cell_number, overtime_minutes, parse_workbook, patch_workbook
from worker import BridgeError, HistoryReader, history_payloads, publish_front_office_history, source_payload


def archive():
    snapshot = workspace()
    snapshot.update(week_start='2026-09-07', kind=0, facilities=[{'id': f} for f in MAP.values()])
    snapshot['reports'][0].update(entry_origin='imported', overtime_minutes=1035, overtime_issue=False,
                                  last_submitted_at='2026-09-07T12:40:00Z', first_submitted_at='2026-09-07T12:40:00Z')
    snapshot['reports'][0]['values']['overtime_reported'] = 17.15
    return {'archive_as_of': '2026-09-11T18:00:00Z', 'snapshots': [snapshot]}


class DurationTests(unittest.TestCase):
    def test_integer_minutes_and_decimal_roundtrip(self):
        for raw, expected in ((17.15, 1035), (16.09, 969), (0.01, 1), (17.5, 1070), (0, 0), (None, None), (35791394.07, 2147483647)):
            self.assertEqual(overtime_minutes(raw), expected)
        for raw in (17.6, 17.99, 17.151, -1, True, float('nan'), float('inf'), 35791394.08, Decimal('1e999')):
            with self.assertRaises(WorkbookError):
                overtime_minutes(raw)

    def test_workbook_duration_holds_bad_minutes_and_retains_raw_valid_value(self):
        def cell(value):
            return {'value': value, 'formula': False, 'error': False}
        self.assertEqual(cell_number(cell(Decimal('17.15')), 'overtime_reported'), 17.15)
        with self.assertRaises(WorkbookError):
            cell_number(cell(Decimal('17.75')), 'overtime_reported')

    def test_invalid_haven_duration_cannot_be_written_back_to_workbook(self):
        raw = fixture()
        parsed = parse_workbook(raw, MAP, 'synthetic', 'fixture.xlsx')
        record = parsed['records'][0]
        identity = record['facility_id'] + ':' + record['week_start']
        with self.assertRaises(WorkbookError):
            patch_workbook(raw, parsed, {identity: {**record['values'], 'overtime_reported': 17.75}})

    def test_publisher_duration_consistency_and_issue_signal(self):
        data = archive()['snapshots'][0]
        rows = {r['metric']: r['value'] for r in source_payload(data, MAP, date(2026, 9, 7), 1)['rows']}
        self.assertEqual(rows['homewood_overtime_minutes'], 1035)
        self.assertEqual(rows['homewood_overtime_reported'], 17.15)
        self.assertEqual(rows['homewood_entry_origin'], 1)
        self.assertEqual(rows['homewood_needs_resubmission'], 1)
        data['reports'][0]['overtime_minutes'] = 1029
        with self.assertRaisesRegex(BridgeError, 'does not match'):
            source_payload(data, MAP, date(2026, 9, 7), 1)
        data['reports'][0].update(overtime_minutes=None, overtime_issue=True)
        data['reports'][0]['values']['overtime_reported'] = 17.75
        rows = {r['metric']: r['value'] for r in source_payload(data, MAP, date(2026, 9, 7), 1)['rows']}
        self.assertEqual(rows['homewood_overtime_issue'], 1)
        self.assertNotIn('homewood_overtime_minutes', rows)


class HistoryTests(unittest.TestCase):
    env = {'FRONT_OFFICE_HISTORY_INGEST_KEY_ID': 'history-test', 'FRONT_OFFICE_HISTORY_INGEST_SECRET': 'h' * 32}

    def test_archive_generation_is_distinct_from_observation(self):
        payload = history_payloads(archive(), MAP, 8)[0][1]
        self.assertEqual(payload['sourceAsOf'], '2026-09-11T18:00:00.000Z')
        self.assertEqual(payload['dataset'], 'standup_weekly_history')
        self.assertEqual(payload['sequence'], 8)
        rows = {r['metric']: r['value'] for r in payload['rows']}
        self.assertGreater(rows['archive_as_of_epoch'], rows['homewood_as_of_epoch'])
        self.assertEqual(rows['snapshot_kind'], 0)

    def test_meeting_snapshot_requires_closed_cutoff_before_exact_after(self):
        data = archive()
        data['snapshots'][0]['kind'] = 2
        for stamp in ('2026-09-06T23:00:00Z', '2026-09-07T13:14:59.999999Z'):
            data['archive_as_of'] = stamp
            with self.assertRaisesRegex(BridgeError, 'unavailable before'):
                history_payloads(data, MAP, 1)
        for stamp in ('2026-09-07T13:15:00Z', '2026-09-07T13:15:00.000001Z'):
            data['archive_as_of'] = stamp
            self.assertEqual(len(history_payloads(data, MAP, 1)), 1)

    def test_old_and_new_weeks_share_monotonic_archive_time(self):
        data = archive()
        older = copy.deepcopy(data['snapshots'][0])
        older.update(week_start='2026-08-31', kind=1)
        older['reports'][0]['week_start'] = '2026-08-31'
        data['snapshots'].append(older)
        payloads = history_payloads(data, MAP, 1)
        self.assertEqual(len(payloads), 2)
        self.assertEqual(payloads[0][1]['sourceAsOf'], payloads[1][1]['sourceAsOf'])
        self.assertEqual([p[1]['sequence'] for p in payloads], [1, 2])
        self.assertTrue(payloads[0][0].startswith('2026-08-31'))

    def test_unknown_outcome_retries_exact_body_then_skips_unchanged(self):
        state, bodies = FakeState(), []
        def transport(url, method, body, headers):
            bodies.append(body)
            if len(bodies) == 1:
                raise BridgeError('unknown outcome')
            return b'{"receiptId":"history-receipt"}', {}
        with patch.dict('os.environ', self.env), patch('worker.http', side_effect=transport):
            with self.assertRaises(BridgeError):
                publish_front_office_history(state, archive(), MAP)
            self.assertEqual(len(state.data['history_pending_queue']), 1)
            self.assertNotIn('history_sequence', state.data)
            self.assertEqual(publish_front_office_history(state, archive(), MAP)['accepted'], 1)
            self.assertEqual(bodies[0], bodies[1])
            self.assertEqual(state.data['history_sequence'], 1)
            later = archive()
            later['archive_as_of'] = '2026-09-11T23:59:59Z'
            self.assertTrue(publish_front_office_history(state, later, MAP)['unchanged'])
            self.assertEqual(len(bodies), 2)

    def test_unchanged_archive_renews_at_six_hours_with_durable_exact_retry(self):
        state, bodies = FakeState(), []
        def transport(url, method, body, headers):
            bodies.append(json.loads(body))
            if len(bodies) == 2:
                raise BridgeError('renewal outcome unknown')
            return b'{"receiptId":"history-receipt"}', {}
        with patch.dict('os.environ', self.env), patch('worker.http', side_effect=transport):
            publish_front_office_history(state, archive(), MAP)
            later = archive()
            later['archive_as_of'] = '2026-09-12T00:00:00Z'
            with self.assertRaisesRegex(BridgeError, 'unknown'):
                publish_front_office_history(state, later, MAP)
            self.assertEqual(state.data['history_sequence'], 1)
            self.assertEqual(state.data['history_published_at']['2026-09-07:0'], '2026-09-11T18:00:00.000Z')
            self.assertEqual(publish_front_office_history(state, later, MAP)['accepted'], 1)
            self.assertEqual(bodies[1], bodies[2])
            self.assertEqual(state.data['history_sequence'], 2)
            self.assertEqual(state.data['history_published_at']['2026-09-07:0'], '2026-09-12T00:00:00.000Z')
            original = {r['metric']: r['value'] for r in bodies[0]['rows']}
            renewed = {r['metric']: r['value'] for r in bodies[2]['rows']}
            self.assertEqual(original.pop('homewood_as_of_epoch'), renewed.pop('homewood_as_of_epoch'))
            self.assertLess(original.pop('archive_as_of_epoch'), renewed.pop('archive_as_of_epoch'))
            self.assertEqual(original, renewed)

    def test_existing_fingerprint_without_publication_time_renews_once(self):
        state = FakeState()
        with patch.dict('os.environ', self.env), patch('worker.http', return_value=(b'{"receiptId":"receipt"}', {})) as request:
            publish_front_office_history(state, archive(), MAP)
            del state.data['history_published_at']
            self.assertEqual(publish_front_office_history(state, archive(), MAP)['accepted'], 1)
            self.assertTrue(publish_front_office_history(state, archive(), MAP)['unchanged'])
            self.assertEqual(request.call_count, 2)

    def test_backdated_correction_uses_new_archive_time_without_changing_current_sequence(self):
        state, bodies = FakeState(), []
        def transport(url, method, body, headers):
            bodies.append(json.loads(body))
            return b'{"receiptId":"history-receipt"}', {}
        with patch.dict('os.environ', self.env), patch('worker.http', side_effect=transport):
            publish_front_office_history(state, archive(), MAP)
            correction = archive()
            correction['archive_as_of'] = '2026-09-12T18:00:00Z'
            correction['snapshots'][0]['reports'][0]['values']['current_total_census'] = 8
            publish_front_office_history(state, correction, MAP)
        self.assertEqual([b['sequence'] for b in bodies], [1, 2])
        self.assertGreater(bodies[1]['sourceAsOf'], bodies[0]['sourceAsOf'])
        self.assertNotIn('front_office_sequence', state.data)

    def test_old_generation_duplicate_identity_wrong_mapping_and_bad_range_rejected(self):
        state = FakeState({'history_source_as_of': '2026-09-12T18:00:00Z'})
        with patch.dict('os.environ', self.env), patch('worker.http') as request:
            with self.assertRaisesRegex(BridgeError, 'regressed'):
                publish_front_office_history(state, archive(), MAP)
            request.assert_not_called()
        invalid = archive()
        invalid['snapshots'].append(copy.deepcopy(invalid['snapshots'][0]))
        with self.assertRaisesRegex(BridgeError, 'Duplicate'):
            history_payloads(invalid, MAP, 1)
        invalid = archive()
        invalid['snapshots'][0]['facilities'] = []
        with self.assertRaisesRegex(BridgeError, 'mapping'):
            history_payloads(invalid, MAP, 1)
        for start, end in ((date(2026, 9, 8), date(2026, 9, 14)), (date(2026, 9, 7), date(2028, 9, 11))):
            with self.assertRaisesRegex(BridgeError, '104 weeks'):
                HistoryReader(start, end)

    def test_service_reader_calls_only_history_rpc(self):
        with patch.dict('os.environ', {'SUPABASE_SERVICE_ROLE_KEY': 'synthetic', 'STAND_UP_ORGANIZATION_ID': '00000000-0000-0000-0000-000000000001'}), patch('worker.http', return_value=(json.dumps(archive()).encode(), {})) as request:
            HistoryReader(date(2026, 8, 31), date(2026, 9, 7)).archive()
        self.assertEqual(request.call_args.args[0], 'https://manfqmasfqppukpobpld.supabase.co/rest/v1/rpc/stand_up_export_history')
        self.assertEqual(json.loads(request.call_args.args[2])['p_from_week'], '2026-08-31')

    def test_current_state_and_mixed_cli_are_refused_before_mutation(self):
        state = FakeState({'front_office_sequence': 15})
        with self.assertRaisesRegex(BridgeError, 'own state'):
            publish_front_office_history(state, archive(), MAP)
        import worker
        args = ['worker.py', '--state-dir', '/unused', '--facility-map', '/unused', '--publish-history', '--publish', '--publisher-service', '--from-week', '2026-09-07', '--to-week', '2026-09-07']
        with patch('sys.argv', args), patch('worker.State') as state_constructor:
            with self.assertRaisesRegex(BridgeError, 'isolated'):
                worker.main()
            state_constructor.assert_not_called()


class StateBoundaryTests(unittest.TestCase):
    def state(self):
        return FakeState({'baselines': {}, 'history_binding': {'dataset': 'standup_weekly_history'}, 'history_sequence': 3})

    def test_nonhistory_functions_reject_before_request_or_state_mutation(self):
        import worker
        for entry in ('publish', 'haven_init', 'haven_command', 'haven_mutate', 'haven_resume', 'synchronize', 'recover', 'probe', 'prior_weeks'):
            with self.subTest(entry=entry):
                state = self.state()
                before = copy.deepcopy(state.data)
                google = MagicMock()
                client = object.__new__(worker.Haven)
                client.state = state
                calls = {
                    'publish': lambda: worker.publish_front_office(state, workspace(), MAP, date(2026, 9, 7)),
                    'haven_init': lambda: worker.Haven(state),
                    'haven_command': lambda: client.command('workspace', {}),
                    'haven_mutate': lambda: client.mutate('save', {}),
                    'haven_resume': lambda: client.resume(),
                    'synchronize': lambda: worker.synchronize(state, client, google, MAP, date(2026, 9, 7), 'rehearsal'),
                    'recover': lambda: worker.recover_pending_google(state, google, 'rehearsal'),
                    'probe': lambda: worker.probe_google(state, google, 'rehearsal'),
                    'prior_weeks': lambda: worker.changed_prior_weeks(state, google, MAP, date(2026, 9, 7), 'rehearsal'),
                }
                with patch('worker.http') as request:
                    with self.assertRaisesRegex(BridgeError, 'History-bound state'):
                        calls[entry]()
                    request.assert_not_called()
                self.assertEqual(state.data, before)
                self.assertEqual(state.saves, 0)
                self.assertEqual(google.mock_calls, [])

    def test_cli_rejects_history_before_constructing_provider_clients(self):
        import worker
        for flags in (['--publish', '--publisher-service'], ['--google'], ['--probe-google']):
            with self.subTest(flags=flags):
                state = self.state()
                before = copy.deepcopy(state.data)
                args = ['worker.py', '--state-dir', '/unused', '--facility-map', '/unused', '--week', '2026-09-07', *flags]
                with patch('sys.argv', args), patch('worker.State', return_value=state), patch('worker.Path.read_text', return_value=json.dumps(MAP)), patch('worker.Haven') as haven, patch('worker.Google') as google, patch('worker.AggregateReader') as aggregate, patch('worker.http') as request:
                    with self.assertRaisesRegex(BridgeError, 'History-bound state'):
                        worker.main()
                    haven.assert_not_called()
                    google.assert_not_called()
                    aggregate.assert_not_called()
                    request.assert_not_called()
                self.assertEqual(state.data, before)
                self.assertEqual(state.saves, 0)

    def test_state_constructor_refuses_existing_history_before_creating_lock(self):
        import worker
        directory, state_path = MagicMock(), MagicMock()
        directory.__truediv__.return_value = state_path
        state_path.exists.return_value = True
        state_path.read_text.return_value = json.dumps(self.state().data)
        with patch('worker.Path') as constructor:
            constructor.return_value.expanduser.return_value.resolve.return_value = directory
            with self.assertRaisesRegex(BridgeError, 'History-bound state'):
                worker.State('/history')
        directory.mkdir.assert_not_called()
        state_path.open.assert_not_called()


if __name__ == '__main__':
    unittest.main()
