#!/usr/bin/env python3
"""Real PostgreSQL lock/revocation probes in an explicitly run-owned scratch cluster.
Requires psycopg; clones the already migrated scratch database named by
HFO_AUTHORITY_BASELINE_DB. Every clone is dropped by exact name in finally.
"""
import json
import os
from pathlib import Path
import threading
import time
import uuid

import psycopg
from psycopg import sql

root = Path(__file__).resolve().parents[2]
socket = Path(os.environ['PG_VERIFY_NATIVE_SOCKET']).resolve()
allowed = Path.home() / '.hermes/tmp/agent-runs'
if not socket.is_relative_to(allowed.resolve()):
    raise RuntimeError('Only an explicitly run-owned temporary cluster is allowed')
manifest = json.loads((socket / 'manifest.json').read_text())
if manifest.get('created_by') != 'codex' or manifest.get('run_id') != socket.name:
    raise RuntimeError('Scratch cluster ownership manifest does not match')
connection = dict(host=str(socket), port=os.environ.get('PG_VERIFY_NATIVE_PORT', '55443'), user='postgres')
baseline = os.environ['HFO_AUTHORITY_BASELINE_DB']
fixture_sql = (root / 'supabase/tests/review_hfo_current_authority.sql').read_text().split('CREATE FUNCTION pg_temp.hfo_login')[0].replace('ALTER ROLE service_role BYPASSRLS;', '')


def run_case(name, lock_kind, revoke_kind, resident=False):
    database = 'hfo_authority_probe_' + uuid.uuid4().hex[:16]
    admin = psycopg.connect(**connection, dbname='postgres', autocommit=True)
    admin.execute(sql.SQL('CREATE DATABASE {} TEMPLATE {}').format(sql.Identifier(database), sql.Identifier(baseline)))
    try:
        setup = psycopg.connect(**connection, dbname=database)
        setup.execute(fixture_sql)
        fixture = dict(zip([x.name for x in setup.execute('SELECT * FROM authority_fixture').description], setup.execute('SELECT * FROM authority_fixture').fetchone()))
        actor = fixture['owner_actor'] if resident else fixture['actor']
        session = fixture['owner_session'] if resident else fixture['actor_session']
        role = 'owner' if resident else 'housekeeper'
        task = fixture['task_resident'] if resident else fixture['task_a']
        if resident:
            setup.execute("INSERT INTO public.operation_subject_access(organization_id,facility_id,user_id,scope,granted_by,reason,can_record) VALUES(%s,%s,%s,'resident',%s,'Concurrency fixture',true)", (fixture['org'],fixture['site_a'],actor,actor))
        meeting_action = None
        if lock_kind == 'meeting':
            meeting_id, meeting_action = uuid.uuid4(), uuid.uuid4()
            setup.execute("INSERT INTO public.meetings(id,organization_id,facility_id,title,scheduled_at) VALUES(%s,%s,%s,'After-DML wait fixture',clock_timestamp())",(meeting_id,fixture['org'],fixture['site_a']))
            setup.execute("INSERT INTO public.meeting_action_items(id,organization_id,facility_id,meeting_id,description,oce_task_instance_id) VALUES(%s,%s,%s,%s,'Linked action',%s)",(meeting_action,fixture['org'],fixture['site_a'],meeting_id,task))
            setup.execute("UPDATE public.user_facility_access SET operation_expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=%s",(actor,))
        version = setup.execute('SELECT auth_claim_version FROM public.user_profiles WHERE id=%s',(actor,)).fetchone()[0]
        setup.commit()
        setup.close()
        locker = psycopg.connect(**connection, dbname=database)
        observer = psycopg.connect(**connection, dbname=database, autocommit=True)
        runner = psycopg.connect(**connection, dbname=database)
        if lock_kind == 'task':
            locker.execute('SELECT 1 FROM public.operation_task_instances WHERE id=%s FOR UPDATE',(task,))
        elif lock_kind == 'meeting':
            locker.execute('SELECT 1 FROM public.meeting_action_items WHERE id=%s FOR UPDATE',(meeting_action,))
        elif lock_kind == 'resident':
            locker.execute('SELECT 1 FROM public.residents WHERE id=%s FOR UPDATE',(fixture['resident'],))
        else:
            locker.execute('SELECT 1 FROM public.user_facility_access WHERE user_id=%s FOR UPDATE',(actor,))
        runner.execute("SELECT set_config('request.jwt.claims',%s,false)",(json.dumps(dict(role='authenticated',sub=str(actor),session_id=str(session),auth_claim_version=version)),))
        runner.execute('SET ROLE authenticated')
        backend = runner.info.backend_pid
        result = {}
        def command():
            try:
                result['value'] = runner.execute("SELECT public.complete_operation_task_review(%s,%s,%s,'concurrency','{}')",(task,actor,role)).fetchone()[0]
                runner.commit()
            except psycopg.Error as error:
                result['sqlstate'] = error.sqlstate
                result['error'] = str(error)
                runner.rollback()
        thread = threading.Thread(target=command)
        thread.start()
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if observer.execute("SELECT wait_event_type='Lock' FROM pg_stat_activity WHERE pid=%s",(backend,)).fetchone()[0]:
                break
            if not thread.is_alive():
                raise AssertionError(f'{name}: command did not reach blocking lock: {result}')
            time.sleep(0.03)
        else:
            raise AssertionError(f'{name}: did not observe database lock wait')
        writer = locker if lock_kind != 'task' else observer
        if revoke_kind == 'wall_clock':
            # Grant rows are pinned by the command; expiry must still be checked
            # after the AFTER-trigger meeting wait, before committing success.
            expires = observer.execute('SELECT operation_expires_at FROM public.user_facility_access WHERE user_id=%s',(actor,)).fetchone()[0]
            while observer.execute('SELECT clock_timestamp()>%s',(expires,)).fetchone()[0] is not True:
                time.sleep(0.05)
        elif revoke_kind == 'session':
            writer.execute('DELETE FROM auth.sessions WHERE id=%s',(session,))
        elif revoke_kind == 'expires':
            writer.execute("UPDATE public.user_facility_access SET operation_expires_at=clock_timestamp()-interval '1 second' WHERE user_id=%s",(actor,))
        elif revoke_kind == 'record':
            writer.execute('UPDATE public.operation_subject_access SET can_record=false WHERE user_id=%s',(actor,))
        elif revoke_kind == 'transfer':
            writer.execute('UPDATE public.residents SET facility_id=%s WHERE id=%s',(fixture['site_b'],fixture['resident']))
        else:
            writer.execute('UPDATE public.user_facility_access SET revoked_at=clock_timestamp() WHERE user_id=%s',(actor,))
        locker.commit()
        thread.join(8)
        if thread.is_alive():
            runner.cancel()
            thread.join(2)
            raise AssertionError(f'{name}: command did not finish after release')
        assert result.get('sqlstate') == '42501', (name,result)
        row = observer.execute('SELECT status,signed_by,completed_at FROM public.operation_task_instances WHERE id=%s',(task,)).fetchone()
        assert row == ('pending',None,None), (name,row)
        assert observer.execute("SELECT count(*) FROM public.operation_audit_log WHERE task_instance_id=%s AND event_type='completed'",(task,)).fetchone()[0] == 0
        if meeting_action is not None:
            assert observer.execute('SELECT status FROM public.meeting_action_items WHERE id=%s',(meeting_action,)).fetchone()[0] == 'open'
        runner.close(); locker.close(); observer.close()
        return dict(case=name, outcome='PASS', sqlstate='42501', observed_lock_wait=True, mutation_rolled_back=True)
    finally:
        admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(database)))
        admin.close()


cases = [
    ('session revoked while task locked','task','session',False),
    ('site grant revoked while task locked','task','grant',False),
    ('temporary coverage expired while task locked','task','expires',False),
    ('site grant revoked during grant-row wait','grant','grant',False),
    ('resident transfer during native subject wait','resident','transfer',True),
    ('recorder grant revoked while task locked','task','record',True),
    ('coverage expires during linked meeting AFTER-trigger wait','meeting','wall_clock',False),
]
print(json.dumps(dict(cases=[run_case(*case) for case in cases], boundary='local PostgreSQL with Supabase auth stubs'),indent=2))
