#!/usr/bin/env python3
"""Guarded COL151 synthetic HTTP proof; importing and --help perform no network IO."""
import argparse
import base64
import csv
import datetime as dt
import hashlib
import types
import io
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
REF = 'iwcnajanvjvynolltflw'
HELPER = ROOT.parents[1] / 'col143-evidence/hosted-proof/proof.py'
shared = types.ModuleType('col151_shared_transport')
shared.__file__ = str(HELPER)
exec(compile(HELPER.read_text(), str(HELPER), 'exec'), shared.__dict__)
shared.ROOT = ROOT  # evidence only; never instantiate the historical Proof initializer


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError('Unexpected redirect refused')


class Proof(shared.Proof):
    def __init__(self, ready_path):
        self.ready_path = ready_path
        self.ready = json.loads(ready_path.read_text())
        self.verify_ready()
        config = Path.home() / '.config/haven-staging/col217.env'
        require(config.stat().st_mode & 0o077 == 0, 'Staging config must be private')
        self.env = shared.envfile(config)
        require(self.env['STAGING_PROJECT_REF'] == REF, 'Wrong staging config')
        self.base = self.env['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
        require(self.base == 'https://' + REF + '.supabase.co', 'Wrong API target')
        require(self.env['PGUSER'] == 'postgres.' + REF, 'Wrong pooler project')
        require(self.env['PGHOST'] == 'aws-0-us-west-2.pooler.supabase.com', 'Unexpected pooler')
        control = Path.home() / '.config/haven-staging/control/supabase/.temp/project-ref'
        require(control.read_text().strip() == REF, 'Dedicated CLI control target changed')
        self.app = self.ready['appUrl'].rstrip('/')
        parsed = urllib.parse.urlparse(self.app)
        require(parsed.scheme == 'http' and parsed.hostname in ('127.0.0.1', 'localhost')
                and parsed.port and not parsed.path and not parsed.username, 'Explicit local app origin required')
        self.private = Path.home() / '.config/haven-staging/col151-fixtures.json'
        if self.private.exists():
            require(self.private.stat().st_mode & 0o077 == 0, 'Fixture state must be private')
            self.state = json.loads(self.private.read_text())
            require(self.state['run'].startswith('col151-') and self.state['target'] == REF,
                    'Fixture provenance mismatch')
        else:
            self.state = {'run': 'col151-' + secrets.token_hex(6), 'target': REF,
                          'users': {}, 'paths': [], 'lanes': {}}
        require(all(u['email'].startswith(self.state['run'] + '+') for u in self.state['users'].values()),
                'Fixture actor provenance mismatch')
        self.sessions = {}
        self.i = len(list(ROOT.glob('[0-9]*.json')))
        self.save()

    def verify_ready(self):
        r = self.ready
        require(r['projectRef'] == REF and r['stageReady'] is True and r['authHookEnabled'] is True,
                'Parent staging readiness required')
        require(r['localAppSourceAndTargetVerified'] is True, 'Parent app process/source/target verification required')
        require(re.fullmatch('[0-9a-f]{40}', r['integrationSha']), 'Committed SHA required')
        require(Path(r['checkout']).resolve() == REPO, 'Wrong checkout')
        sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip()
        require(sha == r['integrationSha'], 'Checkout moved')
        require(subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--'], cwd=REPO).returncode == 0,
                'Tracked source changed')
        for name in ('gate', 'review', 'stagingReadiness'):
            artifact = r[name]
            data = Path(artifact['path']).read_bytes()
            require(hashlib.sha256(data).hexdigest() == artifact['sha256'], name + ' artifact changed')
            parsed = json.loads(data)
            if name == 'gate':
                require(artifact['sourceSha'] == sha, 'Parent must bind gate evidence to verified source')
                require(parsed['verdict'] == 'PASS' and any(c.get('required') for c in parsed['checks'])
                        and all(c['status'] == 'passed' for c in parsed['checks'] if c.get('required')),
                        'Strict required gates must pass')
            elif name == 'review':
                require(parsed['result'] == '[PROOF PASS — CLEAN]' and parsed['sourceSha'] == sha
                        and parsed['independent'] is True, 'Independent exact source review required')
            else:
                require(parsed['target'] == REF and parsed['sourceSha'] == sha
                        and parsed['migration365Verified'] is True, 'Migration 365 staging readback required')

    def http(self, label, method, url, body=None, headers=None, expect=(200,), binary=False):
        self.verify_ready()  # recheck after every potentially blocking previous call
        parsed = urllib.parse.urlparse(url)
        origin = urllib.parse.urlparse(self.app)
        require((parsed.scheme == 'https' and parsed.hostname == REF + '.supabase.co' and parsed.port in (None, 443))
                or (parsed.scheme, parsed.netloc) == (origin.scheme, origin.netloc), 'URL outside exact origins')
        headers = dict(headers or {})
        payload = body
        if isinstance(body, (dict, list)):
            payload = json.dumps(body).encode(); headers['Content-Type'] = 'application/json'
        try:
            with urllib.request.build_opener(NoRedirect()).open(
                urllib.request.Request(url, data=payload, method=method, headers=headers), timeout=180) as response:
                status, rh, raw = response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as error:
            status, rh, raw = error.code, dict(error.headers), error.read()
        self.last_raw = raw
        self.last_binary_headers = {k.lower(): v for k, v in rh.items()}
        if binary and status == 200:
            result = {'length': len(raw), 'md5': hashlib.md5(raw).hexdigest(), 'sha256': hashlib.sha256(raw).hexdigest()}
        else:
            try: result = json.loads(raw)
            except (ValueError, UnicodeError): result = raw.decode(errors='replace')[:2000]
        # Never log request headers, passwords, tokens, cookies, signed URLs, or full login bodies.
        self.log(label, {'method': method, 'path': parsed.path, 'status': status,
                         'result': shared.redact(result), 'expected': list(expect)})
        require(status in expect, label + ': unexpected HTTP ' + str(status))
        return result

    def sql(self, label, query):
        self.verify_ready()
        # Explicit environment removes inherited PG connection overrides.
        env = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
        env.update(self.env)
        env['PGPASSWORD'] = self.env['SUPABASE_DB_PASSWORD']
        p = subprocess.run(['/opt/homebrew/opt/postgresql@17/bin/psql', '-X', '-q', '-At',
                            '-v', 'ON_ERROR_STOP=1', '-c', query], env=env, capture_output=True, text=True)
        require(p.returncode == 0, label + ': SQL failed; inspect privately, no credentials logged')
        self.log(label, {'exit': p.returncode, 'result': p.stdout.strip()})
        return p.stdout.strip()

    def preflight(self):
        super().preflight()
        result = self.sqljson('export-schema', "SELECT to_regprocedure('public.create_operation_history_export(uuid,uuid,uuid)') IS NOT NULL AS create_ready,to_regprocedure('public.read_operation_history_export(uuid,integer,integer)') IS NOT NULL AS read_ready")
        require(all(result[0].values()), 'Export RPCs absent')

    def fixtures(self):
        require(not self.state.get('fixtures_pending'), 'Uncertain fixture setup; inspect exact own state before retry')
        self.state['fixtures_pending'] = True; self.save()
        super().fixtures()
        self.state.pop('fixtures_pending'); self.save()

    def bulk(self):
        l = self.state['lanes']['admin']; day = dt.date.fromisoformat(l['date'])
        rule = {'rule_version': 1, 'timezone': 'America/New_York',
                'recurrence': {'kind': 'weekly', 'weekday': day.strftime('%A').lower()}, 'deadline': {'time': '23:00'}}
        for start in range(1, 1001, 100):
            dates = [day + dt.timedelta(weeks=n) for n in range(start, min(start + 100, 1001))]
            periods = [{'occurrence_date': d.isoformat(), 'period': {'start_date': d.isoformat(), 'end_date': (d + dt.timedelta(days=6)).isoformat()},
                        'due_at': dt.datetime.combine(d, dt.time(23), ZoneInfo('America/New_York')).isoformat(),
                        'grace_ends_at': None, 'remind_at': None, 'timezone': 'America/New_York', 'adjustments': []} for d in dates]
            result = self.checkpoint(l, 'bulk-' + str(start), lambda: self.rpc('bulk-' + str(start), None,
                'generate_operation_occurrences_service', {'p_facility': self.state['sitea'], 'p_configuration': l['configuration'],
                'p_occurrences': periods, 'p_run': {'run_id': self.state['run'] + '-bulk-' + str(start),
                'evaluator_version': 'hfo-evaluator/1', 'date_from': dates[0].isoformat(), 'date_to': dates[-1].isoformat(),
                'rule': rule, 'occurrence_kind': 'scheduled'}}, service=True))
            require(result['counts']['created'] == len(periods), 'Bulk generation incomplete')

    def correction(self, label, receipt):
        l = self.state['lanes']['admin']
        return self.checkpoint(l, label, lambda: self.api(label, 'admin', 'POST', '/occurrences/' + l['occurrence'] + '/correct',
            {'request_key': self.key(label), 'expected_receipt_id': receipt['id'], 'expected_receipt_revision': receipt['revision'],
             'payload': {'reason': 'Synthetic export correction proof', 'outcome': 'performed', 'note': label}}))['receipt']

    def export(self, label):
        l = self.state['lanes']['admin']
        request_id = l.setdefault(label + '-request', str(uuid.uuid4())); self.save()
        return self.checkpoint(l, label, lambda: self.api(label, 'admin', 'POST', '/activity-history/exports',
            {'facility_id': self.state['sitea'], 'activity_id': l['activity'], 'request_id': request_id}))

    def csv_download(self, label, export):
        self.http(label, 'GET', self.app + export['download_url'], headers={'Cookie': self.cookie('admin')}, binary=True)
        raw = self.last_raw
        require(self.last_binary_headers.get('content-type', '').startswith('text/csv'), 'Not CSV')
        require('attachment;' in self.last_binary_headers.get('content-disposition', ''), 'Missing download disposition')
        require(self.last_binary_headers.get('cache-control') == 'no-store', 'Missing no-store')
        rows = list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))
        require(rows[0]['row_type'] == 'manifest', 'Missing manifest row')
        manifest = json.loads(rows[0]['manifest']); occurrences = rows[1:]
        require(manifest == export['manifest'] and manifest['complete'] is True, 'Manifest mismatch')
        require(len(occurrences) == manifest['total'] == 1001, 'Expected complete 1001-row export')
        require(len({r['occurrence_id'] for r in occurrences}) == 1001, 'Duplicate occurrence')
        require(sum(len(json.loads(r['receipts'])) for r in occurrences) == manifest['receipt_total'], 'Receipt totals')
        require(sum(len(json.loads(r['evidence_references'])) for r in occurrences) == manifest['evidence_total'], 'Evidence totals')
        require(not any(x in raw for x in (b'object_path', b'signedUrl', b'access_token')), 'Private locator leaked')
        (ROOT / (label + '.csv')).write_bytes(raw)
        return raw, occurrences

    def proof(self):
        require(not self.state.get('cleaned'), 'Fixtures already deactivated')
        for role in self.state['users']: self.login(role)
        self.positive('admin', 'admin')
        self.bulk()
        l = self.state['lanes']['admin']
        correction = self.correction('correction-before-snapshot', l['receipt'])
        export = self.export('snapshot-before-change')
        first, rows = self.csv_download('snapshot-before-change', export)
        row = next(r for r in rows if r['occurrence_id'] == l['occurrence'])
        receipts = json.loads(row['receipts']); evidence = json.loads(row['evidence_references'])
        require({l['receipt']['id'], correction['id']} <= {r['id'] for r in receipts}, 'Correction lineage omitted')
        require(any(r['corrects_receipt_id'] == l['receipt']['id'] for r in receipts), 'Correction attribution omitted')
        require(any(e['id'] == l['evidence']['id'] and e['state'] == 'finalized' for e in evidence), 'Evidence reference omitted')
        self.correction('correction-after-snapshot', correction)
        again, _ = self.csv_download('snapshot-after-change', export)
        require(first == again, 'Snapshot changed after live correction')
        fresh = self.export('snapshot-fresh')
        require(fresh['export_id'] != export['export_id'] and fresh['manifest']['receipt_total'] == export['manifest']['receipt_total'] + 1,
                'Fresh export did not see appended correction')
        self.csv_download('snapshot-fresh', fresh)
        path = '/activity-history/exports/' + export['export_id'] + '/download'
        self.api('anonymous-download', None, 'GET', path, expect=(401,))
        self.api('other-requester-download', 'corp', 'GET', path, expect=(403,))
        self.api('other-site-download', 'siteb', 'GET', path, expect=(403,))
        uid = self.state['users']['admin']['id']
        self.sql('revoke-owned-admin', 'UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id=' + shared.lit(uid)
                 + ' AND facility_id=' + shared.lit(self.state['sitea']) + ' AND revoked_at IS NULL;')
        self.api('revoked-existing-cookie-download', 'admin', 'GET', path, expect=(401, 403, 404))
        self.state['proof_passed'] = True; self.save()
        self.log('SUMMARY', {'status': 'PASS', 'target': REF, 'sourceSha': self.ready['integrationSha'],
                            'occurrences': 1001, 'snapshot_bytes_unchanged': True, 'scope': 'Synthetic hosted API proof only'})

    def cleanup(self):
        # Retain immutable receipts, snapshots, audit history AND finalized native evidence.
        s = self.state
        require(s.get('fixtures_created'), 'No fully created fixture scope; inspect partial setup privately')
        ids = ','.join(shared.lit(u['id']) for u in s['users'].values())
        require(ids, 'No owned actors')
        self.sql('deactivate-owned-fixtures', f"BEGIN; UPDATE public.user_facility_access SET revoked_at=now() WHERE user_id IN ({ids}) AND revoked_at IS NULL; UPDATE public.user_profiles SET is_active=false WHERE id IN ({ids}); UPDATE public.facilities SET deleted_at=now() WHERE id IN ({shared.lit(s['sitea'])},{shared.lit(s['siteb'])}); UPDATE public.entities SET deleted_at=now() WHERE id={shared.lit(s['entity'])}; COMMIT;")
        for role, user in s['users'].items():
            self.http('ban-owned-' + role, 'PUT', self.base + '/auth/v1/admin/users/' + user['id'],
                      {'ban_duration': '876000h'}, self.authheaders(service=True))
        result = self.sqljson('cleanup-check', f"SELECT (SELECT count(*) FROM public.user_profiles WHERE id IN ({ids}) AND is_active) AS active_profiles,(SELECT count(*) FROM public.user_facility_access WHERE user_id IN ({ids}) AND revoked_at IS NULL) AS active_grants")
        require(all(n == 0 for n in result[0].values()), 'Cleanup incomplete')
        s['cleaned'] = True; self.save()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=('preflight', 'fixtures', 'proof', 'cleanup'))
    parser.add_argument('--ready', type=Path, default=ROOT / 'READY.json')
    args = parser.parse_args()
    require(not sys.flags.optimize, 'Run without -O; shared contract assertions must stay enabled')
    proof = Proof(args.ready)
    getattr(proof, args.phase)()
    print(args.phase + ': completed; redacted evidence retained')


if __name__ == '__main__':
    import sys
    try: main()
    except Exception as error:
        print('HARD GATE: ' + shared.redact(str(error)), file=sys.stderr)
        sys.exit(1)
