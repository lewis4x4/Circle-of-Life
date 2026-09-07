#!/usr/bin/env python3
"""Bounded Haven SYS-001 release. Secrets stay in process memory/private backup.

No Docker, project creation, synthetic hosted records, or broad config push.
Every mutation is scoped to Haven and requires the verified source gate + backup.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.parse

ROOT = Path(__file__).resolve().parents[2]
PROJECT = 'manfqmasfqppukpobpld'
RUN = Path.home() / '.hermes/tmp/agent-runs/haven-r7-01a07c39'
PG = Path('/opt/homebrew/opt/postgresql@17/bin')
EVIDENCE = ROOT / 'docs/remediation/2026-09-review'
GATE = ROOT / 'test-results/agent-gates/2026-09-07T15-38-13-899Z-SYS-001-RESUMED-VERIFIED.json'
ENV = {}
for line in (ROOT / '.env.local').read_text().splitlines():
    if '=' in line and not line.lstrip().startswith('#'):
        key, value = line.split('=', 1)
        ENV[key.strip()] = value.strip().strip('"').strip("'")
assert ENV['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/') == f'https://{PROJECT}.supabase.co'
URL = urllib.parse.urlparse((ROOT / 'supabase/.temp/pooler-url').read_text().strip())
assert PROJECT in URL.username
CONNECTION = ['-h', URL.hostname, '-p', str(URL.port or 5432), '-U', URL.username, '-d', URL.path.lstrip('/') or 'postgres']
PG_ENV = {**os.environ, 'PGPASSWORD': ENV['SUPABASE_PASSWORD'], 'PGCONNECT_TIMEOUT': '10', 'PGSSLMODE': 'require'}
BACKUP = RUN / 'haven-before-sys001.dump'


def sql(query):
    result = subprocess.run([str(PG / 'psql'), *CONNECTION, '-X', '-At', '-v', 'ON_ERROR_STOP=1'],
                            input=query, text=True, capture_output=True, env=PG_ENV, timeout=300)
    if result.returncode:
        # Database errors contain source identifiers, not connection credentials.
        raise RuntimeError(result.stderr[-4000:])
    return result.stdout.strip()


def http(url, headers, body=None, method=None, expected_error=None):
    config = 'url = ' + json.dumps(url) + '\nuser-agent = "SupabaseCLI/2.101.0"\n'
    for key, value in headers.items():
        config += 'header = ' + json.dumps(f'{key}: {value}') + '\n'
    if method:
        config += 'request = ' + json.dumps(method) + '\n'
    if body is not None:
        config += 'data = ' + json.dumps(json.dumps(body)) + '\n'
    result = subprocess.run(['curl', '-sS', '--fail-with-body', '--max-time', '30', '--config', '-'],
                            input=config, capture_output=True, text=True, timeout=35)
    if result.returncode:
        try:
            error = json.loads(result.stdout)
            if expected_error and error.get('error') == expected_error:
                return {'expected_error_verified': True}
            code = error.get('error_code') or error.get('code') or error.get('error')
            safe_code = str(code) if str(code).replace('_', '').isalnum() else 'unclassified'
        except (ValueError, AttributeError):
            safe_code = 'unclassified'
        raise RuntimeError(f'HTTP request failed ({result.returncode}, {safe_code}); response withheld')
    return json.loads(result.stdout) if result.stdout.strip() else None


def management(endpoint, body=None):
    result = subprocess.run(['security', 'find-generic-password', '-s', 'Supabase CLI', '-a', 'access-token', '-w'],
                            capture_output=True, text=True, check=True)
    token = result.stdout.strip()
    if token.startswith('go-keyring-base64:'):
        token = base64.b64decode(token.split(':', 1)[1]).decode()
    return http(f'https://api.supabase.com/v1/projects/{PROJECT}/{endpoint}',
                {'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, body,
                'PATCH' if body is not None else None)


def record(name, data):
    (EVIDENCE / name).write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps(data))


def migration_hashes():
    return {file.name: hashlib.sha256(file.read_bytes()).hexdigest()
            for version in range(319, 329)
            for file in (ROOT / 'supabase/migrations').glob(f'{version}_*.sql')}


def prerequisites():
    assert json.loads(GATE.read_text())['verdict'] == 'PASS'
    assert migration_hashes() == json.loads((EVIDENCE / 'hosted-preflight.json').read_text())['reviewed_migration_hashes']
    assert BACKUP.exists() and BACKUP.stat().st_size > 0
    expected = json.loads((EVIDENCE / 'hosted-backup.json').read_text())['sha256']
    assert hashlib.sha256(BACKUP.read_bytes()).hexdigest() == expected


def quote(value):
    return "'" + value.replace("'", "''") + "'"


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('action', choices=['inspect', 'backup', 'prepare-hook', 'enable-hook', 'probe', 'probe-links', 'probe-owner', 'apply', 'repair-http-error', 'verify'])
args = parser.parse_args()

if args.action == 'inspect':
    auth = management('config/auth')
    backup = management('database/backups')
    record('hosted-preflight.json', {
        'project': PROJECT,
        'reviewed_migration_hashes': migration_hashes(),
        'hook_enabled': auth.get('hook_custom_access_token_enabled'),
        'hook_uri': auth.get('hook_custom_access_token_uri'),
        'site_url': auth.get('site_url'),
        'pitr_enabled': backup.get('pitr_enabled'),
        'physical_backup_data': backup.get('physical_backup_data'),
        'profile_versions': sql('SELECT auth_claim_version,count(*) FROM public.user_profiles GROUP BY 1 ORDER BY 1;'),
        'invalid_witness_methods': sql("SELECT count(*) FROM public.witness_signatures WHERE signature_method NOT IN ('pin','biometric','nfc','password');"),
        'ledger_tail': sql("SELECT version,name FROM supabase_migrations.schema_migrations WHERE length(version)>3 OR version>='317' ORDER BY version;"),
    })
elif args.action == 'backup':
    assert not BACKUP.exists(), 'Never overwrite a release backup'
    os.umask(0o077)
    result = subprocess.run([str(PG / 'pg_dump'), *CONNECTION, '--format=custom',
                             '--lock-wait-timeout=5s', '--schema=public', '--schema=haven', '--schema=auth',
                             '--schema=storage', '--schema=supabase_migrations', '-f', str(BACKUP)],
                            capture_output=True, text=True, env=PG_ENV, timeout=300)
    if result.returncode:
        raise RuntimeError(result.stderr[-1800:])
    contents = subprocess.run([str(PG / 'pg_restore'), '--list', str(BACKUP)], capture_output=True, text=True, check=True)
    assert 'TABLE DATA public user_profiles' in contents.stdout
    assert 'ACL public' in contents.stdout
    record('hosted-backup.json', {'project': PROJECT, 'path': str(BACKUP), 'bytes': BACKUP.stat().st_size,
                                'sha256': hashlib.sha256(BACKUP.read_bytes()).hexdigest(),
                                'archive_catalog_verified': True, 'owners_and_acl_retained': True, 'restore_exercised': False})
elif args.action == 'prepare-hook':
    prerequisites()
    auth = management('config/auth')
    assert auth.get('hook_custom_access_token_uri') in (None, '', 'pg-functions://postgres/public/haven_custom_access_token_hook')
    source = (ROOT / 'supabase/migrations/326_sys_001_authoritative_actor_state.sql').read_text()
    start = source.index('CREATE OR REPLACE FUNCTION public.haven_custom_access_token_hook(')
    end = source.index('-- Internal actor resolver.', start)
    sql("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n" + source[start:end] + '\nCOMMIT;')
    record('hosted-hook-prepared.json', {'project': PROJECT, 'hook_function_preinstalled': True, 'authority_guards_changed': False})
elif args.action == 'enable-hook':
    prerequisites()
    assert sql("SELECT to_regprocedure('public.haven_custom_access_token_hook(jsonb)') IS NOT NULL;") == 't'
    desired = {'hook_custom_access_token_enabled': True,
               'hook_custom_access_token_uri': 'pg-functions://postgres/public/haven_custom_access_token_hook'}
    management('config/auth', desired)
    current = management('config/auth')
    assert all(current.get(k) == v for k, v in desired.items())
    record('hosted-hook-enabled.json', {'project': PROJECT, **desired, 'site_url': current.get('site_url')})
elif args.action in ('probe', 'probe-links', 'probe-owner'):
    # Existing repository-documented pilot identities only. No messages or data fixtures.
    password = ENV.get('PHASE1_DEMO_PASSWORD')
    assert password or args.action != 'probe', 'Configured pilot password required'
    rows = []
    emails = ['milton@circleoflife.demo', 'jessica@circleoflife.demo', 'maria.garcia@circleoflife.demo', 'robert.sullivan@family.demo']
    if args.action == 'probe-owner':
        emails = sql("SELECT email FROM public.user_profiles WHERE email='blewis@lewisinsurance.com' AND app_role='owner' AND is_active AND deleted_at IS NULL;").splitlines()
        assert len(emails) == 1, 'A unique existing owner identity for the task user is required'
    for email in emails:
        verify_actor = sql("SELECT to_regprocedure('public.haven_current_shell_actor()') IS NOT NULL;") == 't'
        if args.action != 'probe':
            # Never create an account or remove a security hold for a probe.
            assert sql("SELECT count(*) FROM auth.users WHERE email=" + quote(email) +
                       " AND deleted_at IS NULL AND (banned_until IS NULL OR banned_until<=now());") == '1'
            link = http(f'https://{PROJECT}.supabase.co/auth/v1/admin/generate_link',
                        {'apikey': ENV['SUPABASE_SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + ENV['SUPABASE_SERVICE_ROLE_KEY'], 'Content-Type': 'application/json'},
                        {'type': 'magiclink', 'email': email}, 'POST')
            token = http(f'https://{PROJECT}.supabase.co/auth/v1/verify',
                         {'apikey': ENV['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'Content-Type': 'application/json'},
                         {'type': 'magiclink', 'token_hash': link['hashed_token']}, 'POST')
        else:
            token = http(f'https://{PROJECT}.supabase.co/auth/v1/token?grant_type=password',
                         {'apikey': ENV['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'Content-Type': 'application/json'},
                         {'email': email, 'password': password}, 'POST')
        access = token['access_token']
        try:
            claims = json.loads(base64.urlsafe_b64decode(access.split('.')[1] + '=='))
            version = claims.get('auth_claim_version')
            profile_version = int(sql('SELECT auth_claim_version FROM public.user_profiles WHERE id=' + quote(claims['sub']) + ';'))
            assert type(version) is int and version == profile_version
            proof = {'role': claims.get('app_role'), 'numeric_version_matches_profile': True, 'has_session_id': bool(claims.get('session_id'))}
            if verify_actor:
                actor = http(f'https://{PROJECT}.supabase.co/rest/v1/rpc/haven_current_shell_actor',
                             {'apikey': ENV['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json'}, {}, 'POST')
                assert actor['user_id'] == claims['sub'] and actor['app_role'] == claims['app_role']
                proof['current_actor_rpc_verified'] = True
                app_url = os.environ.get('HAVEN_PROBE_APP_URL')
                if app_url:
                    assert app_url in ('https://circleoflifealf.com', 'https://deploy-preview-453--circleoflifealf.netlify.app')
                    encoded = 'base64-' + base64.urlsafe_b64encode(json.dumps(token, separators=(',', ':')).encode()).decode().rstrip('=')
                    key = 'sb-' + PROJECT + '-auth-token'
                    chunks = [encoded[i:i + 3180] for i in range(0, len(encoded), 3180)]
                    cookies = '; '.join((key if len(chunks) == 1 else key + '.' + str(index)) + '=' + chunk for index, chunk in enumerate(chunks))
                    detail = http(app_url + '/api/admin/users/' + claims['sub'], {'Cookie': cookies})
                    assert detail['data']['id'] == claims['sub'] and detail['data']['app_role'] == claims['app_role']
                    proof['matched_app_owner_api_verified'] = app_url
            if os.environ.get('HAVEN_PROBE_EDGE') == '1':
                edge = http(f'https://{PROJECT}.supabase.co/functions/v1/document-admin',
                            {'apikey': ENV['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json'},
                            {}, 'POST', expected_error='document_id required')
                assert edge.get('expected_error_verified') is True
                proof['edge_current_actor_reached_validation'] = True
            rows.append(proof)
        finally:
            http(f'https://{PROJECT}.supabase.co/auth/v1/logout?scope=local',
                 {'apikey': ENV['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'Authorization': 'Bearer ' + access}, method='POST')
        if verify_actor:
            try:
                http(f'https://{PROJECT}.supabase.co/rest/v1/rpc/haven_current_shell_actor',
                     {'apikey': ENV['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json'}, {}, 'POST')
                raise AssertionError('Signed token remained usable after its session was revoked')
            except RuntimeError as error:
                assert 'HAVEN_AUTHORIZATION_STALE' in str(error), 'Expected authoritative stale-session rejection'
                rows[-1]['revoked_session_token_rejected'] = True
        if os.environ.get('HAVEN_PROBE_EDGE') == '1':
            edge = http(f'https://{PROJECT}.supabase.co/functions/v1/document-admin',
                        {'apikey': ENV['NEXT_PUBLIC_SUPABASE_ANON_KEY'], 'Authorization': 'Bearer ' + access, 'Content-Type': 'application/json'},
                        {}, 'POST', expected_error='Unauthorized')
            assert edge.get('expected_error_verified') is True
            rows[-1]['edge_revoked_session_rejected'] = True
    record('hosted-token-probe.json', {'project': PROJECT, 'existing_pilot_signins': rows, 'new_fixtures': False, 'sign_in_method': args.action, 'email_sent': False})
elif args.action == 'apply':
    prerequisites()
    assert json.loads((EVIDENCE / 'hosted-token-probe.json').read_text())['existing_pilot_signins']
    auth = management('config/auth')
    assert auth.get('hook_custom_access_token_enabled') is True
    assert auth.get('hook_custom_access_token_uri') == 'pg-functions://postgres/public/haven_custom_access_token_hook'
    assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('319','320','321','322','323','324','325','326','327','328');") == '0'
    statements = ["BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';"]
    migrations = []
    for version in range(319, 329):
        files = list((ROOT / 'supabase/migrations').glob(f'{version}_*.sql'))
        assert len(files) == 1
        file = files[0]
        source = file.read_text()
        name = file.stem.split('_', 1)[1]
        statements += [source, 'INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES (' +
                       quote(str(version)) + ',' + quote(name) + ',ARRAY[' + quote(source) + ']::text[]);']
        migrations.append({'version': str(version), 'name': name, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
    statements += ["NOTIFY pgrst,'reload config'; NOTIFY pgrst,'reload schema'; COMMIT;"]
    sql('\n'.join(statements))
    record('hosted-migrations-applied.json', {'project': PROJECT, 'migrations': migrations, 'transactional_batch': True})
elif args.action == 'repair-http-error':
    prerequisites()
    assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version IN ('319','320','321','322','323','324','325','326','327','328');") == '10'
    assert sql("SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version='329';") == '0'
    file = ROOT / 'supabase/migrations/329_authorization_error_http_contract.sql'
    source = file.read_text()
    sql("BEGIN; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='120s';\n" + source +
        "\nINSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('329','authorization_error_http_contract',ARRAY[" + quote(source) + "]::text[]); COMMIT;")
    record('hosted-http-contract-fix.json', {'project': PROJECT, 'version': '329', 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'transactional': True})
elif args.action == 'verify':
    result = {
        'project': PROJECT,
        'ledger': sql("SELECT version,name FROM supabase_migrations.schema_migrations WHERE version IN ('319','320','321','322','323','324','325','326','327','328','329') ORDER BY version;"),
        'pre_request_hook': sql("SELECT 'pgrst.db_pre_request=public.haven_assert_authorized_request'=ANY(rolconfig) FROM pg_roles WHERE rolname='authenticator';"),
        'lifecycle_browser_denied': sql("SELECT NOT has_table_privilege('authenticated','public.user_auth_sync_jobs','SELECT');"),
        'shell_actor_installed': sql("SELECT to_regprocedure('public.haven_current_shell_actor()') IS NOT NULL;"),
        'ingest_commit_installed': sql("SELECT to_regprocedure('public.commit_kb_ingest_generation(uuid,jsonb,text,integer,jsonb)') IS NOT NULL;"),
        }
    assert len(result['ledger'].splitlines()) == 11
    assert all(result[key] == 't' for key in ['pre_request_hook', 'lifecycle_browser_denied', 'shell_actor_installed', 'ingest_commit_installed'])
    record('hosted-schema-verification.json', result)
