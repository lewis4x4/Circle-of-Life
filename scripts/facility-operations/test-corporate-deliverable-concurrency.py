#!/usr/bin/env python3
"""Actual two-connection COL-160 waits on disposable local PostgreSQL clones."""
import json, os, threading, time, uuid
from pathlib import Path
import psycopg

ROOT=Path(__file__).resolve().parents[2]
SOCKET=Path(os.environ["PG_VERIFY_NATIVE_SOCKET"]).resolve()
assert str(SOCKET).startswith(str(Path.home()/".hermes/tmp/agent-runs")+"/")
PORT=int(os.environ.get("PG_VERIFY_NATIVE_PORT","55519"))
BASE=os.environ["HFO_CORPORATE_BASELINE_DB"];assert BASE.startswith("col158_")
def conn(db):return psycopg.connect(host=str(SOCKET),port=PORT,user="postgres",dbname=db,autocommit=True)
def setup(db):
    migration=(ROOT/"supabase/migrations/371_hfo_corporate_deliverables.sql").read_text()
    fixture=(ROOT/"supabase/tests/review_hfo_corporate_deliverables.sql").read_text().split("-- CONCURRENCY_SETUP_END")[0]+"\nCOMMIT;"
    with conn(db) as c:
        c.execute(migration);c.execute(fixture)
        return c.execute("SELECT jsonb_build_object('actor',a.id,'session',a.session,'org',a.org,'site',s.facility,'task',s.task,'start',s.start_date,'end',s.end_date,'census',s.census,'expectation',e.id,'revision',haven.corporate_expectation_revision(e.id),'issue',(SELECT value#>>'{issue,id}' FROM cd_receipts WHERE name='race-assigned'),'issue_revision',(SELECT value#>>'{issue,issue_revision}' FROM cd_receipts WHERE name='race-assigned'),'issue_two',(SELECT value#>>'{issue,id}' FROM cd_receipts WHERE name='race-assigned-two'),'issue_owner',(SELECT id FROM cd_issue_owner),'sites',(SELECT jsonb_agg(facility ORDER BY facility) FROM cd_sites)) FROM cd_actor a,cd_sites s JOIN haven.corporate_submission_expectations e ON e.facility_id=s.facility AND e.component_key='hfo-al-m09-01' WHERE s.n=1").fetchone()[0]
def login(c,f):
    c.execute("BEGIN");version=c.execute("SELECT auth_claim_version FROM public.user_profiles WHERE id=%s",(f["actor"],)).fetchone()[0]
    claims={"sub":f["actor"],"session_id":f["session"],"role":"authenticated","app_role":"owner","organization_id":f["org"],"auth_claim_version":version,"iat":int(time.time())}
    c.execute("SELECT set_config('request.jwt.claims',%s,true)",(json.dumps(claims),));c.execute("SET LOCAL ROLE authenticated")
results=[]
for case in ("same-request","source-change-before-lock","authority-loss-before-lock","expected-site-retirement","issue-resolve-before-link","owner-loss-before-link"):
    db="col160_race_"+uuid.uuid4().hex[:8]
    with conn("postgres") as admin:
        admin.execute(psycopg.sql.SQL("CREATE DATABASE {} TEMPLATE {}").format(psycopg.sql.Identifier(db),psycopg.sql.Identifier(BASE)))
        try:
            f=setup(db)
            with conn(db) as blocker,conn(db) as worker,conn(db) as observer:
                key="col160-concurrent-001";out={}
                if case=="same-request":
                    blocker.execute("BEGIN");blocker.execute("SELECT pg_advisory_xact_lock(hashtextextended('corporate-request:'||%s::text||':'||%s,0))",(f["actor"],key))
                    action="register";payload={"period_start":str(f["start"]),"period_end":str(f["end"]),"period_provenance":"Concurrent explicit period","expected_facility_ids":f["sites"]}
                elif case=="expected-site-retirement":
                    other_site=next(site for site in f["sites"] if str(site)!=str(f["site"]));blocker.execute("BEGIN");blocker.execute("UPDATE public.facilities SET deleted_at=clock_timestamp() WHERE id=%s",(other_site,))
                    action="snapshot";payload={}
                elif case=="issue-resolve-before-link":
                    login(blocker,f);blocker.execute("SELECT public.resolve_operation_issue_review(%s,%s,%s,%s::jsonb)",(f["issue"],"col160-race-resolve",f["issue_revision"],json.dumps({"resolution_summary":"Resolved during link wait"})));action="link_follow_up";payload={"expectation_id":str(f["expectation"]),"expected_revision":str(f["revision"]),"problem_state":"missing","issue_id":str(f["issue"])}
                elif case=="owner-loss-before-link":
                    blocker.execute("BEGIN");blocker.execute("UPDATE public.user_profiles SET is_active=false WHERE id=%s",(f["issue_owner"],));action="link_follow_up";payload={"expectation_id":str(f["expectation"]),"expected_revision":str(f["revision"]),"problem_state":"missing","issue_id":str(f["issue"])}
                else:
                    blocker.execute("BEGIN")
                    if case=="source-change-before-lock":blocker.execute("UPDATE public.census_daily_log SET occupied_beds=17,available_beds=3 WHERE id=%s",(f["census"],))
                    else:blocker.execute("UPDATE public.user_profiles SET is_active=false WHERE id=%s",(f["actor"],))
                    action="prepare";payload={"expectation_id":str(f["expectation"]),"expected_revision":str(f["revision"]),"source_family":"census"}
                login(worker,f)
                def run():
                    try:
                        if action=="snapshot":out["reply"]=worker.execute("SELECT public.corporate_deliverable_snapshot(%s,%s,%s)",(f["task"],f["start"],f["end"])).fetchone()[0]
                        else:out["reply"]=worker.execute("SELECT public.corporate_deliverable_command(%s,%s,%s,%s::jsonb)",(f["task"],key,action,json.dumps(payload))).fetchone()[0]
                        worker.execute("COMMIT")
                    except Exception as exc:out["error"]=getattr(exc,"sqlstate",None);worker.execute("ROLLBACK")
                thread=threading.Thread(target=run);thread.start();deadline=time.monotonic()+10
                while time.monotonic()<deadline:
                    if observer.execute("SELECT cardinality(pg_blocking_pids(%s))>0",(worker.info.backend_pid,)).fetchone()[0]:break
                    time.sleep(.02)
                else:raise AssertionError("No actual blocked backend observed")
                blocker.execute("COMMIT");thread.join(15);assert not thread.is_alive()
                if case in ("authority-loss-before-lock","issue-resolve-before-link","owner-loss-before-link"):
                    assert out.get("error")=="42501",out
                    results.append({"case":case,"wait_observed":True,"rejected_sqlstate":"42501","status":"PASS"});continue
                assert "error" not in out,(case,out)
                if case=="expected-site-retirement":
                    result=out["reply"];assert result["availability"]=="unavailable" and result["coverage_complete"] is False and result["meetings"]==[] and all(site["expectation"] is None for site in result["sites"]),result
                    results.append({"case":case,"wait_observed":True,"details_withheld":True,"status":"PASS"});continue
                if case=="same-request":
                    assert observer.execute("SELECT count(*) FROM haven.corporate_submission_expectations").fetchone()[0]==2
                else:
                    value=observer.execute("SELECT (captured#>>'{records,0,metrics,occupied_beds}')::integer FROM haven.corporate_submission_versions WHERE expectation_id=%s ORDER BY version DESC LIMIT 1",(f["expectation"],)).fetchone()[0]
                    assert value==17,value
                results.append({"case":case,"wait_observed":True,"status":"PASS"})
        finally:admin.execute(psycopg.sql.SQL("DROP DATABASE {} WITH (FORCE)").format(psycopg.sql.Identifier(db)))
db="col160_race_"+uuid.uuid4().hex[:8]
with conn("postgres") as admin:
    admin.execute(psycopg.sql.SQL("CREATE DATABASE {} TEMPLATE {}").format(psycopg.sql.Identifier(db),psycopg.sql.Identifier(BASE)))
    try:
        f=setup(db);outputs=[]
        with conn(db) as gate,conn(db) as first,conn(db) as second,conn(db) as observer:
            gate.execute("BEGIN");gate.execute("SELECT pg_advisory_xact_lock(hashtextextended('corporate-expectation:'||%s::text,0))",(f["expectation"],));login(first,f);login(second,f)
            def link(c,issue,key):
                try:outputs.append(("ok",c.execute("SELECT public.corporate_deliverable_command(%s,%s,'link_follow_up',%s::jsonb)",(f["task"],key,json.dumps({"expectation_id":str(f["expectation"]),"expected_revision":str(f["revision"]),"problem_state":"missing","issue_id":str(issue)}))).fetchone()[0]));c.execute("COMMIT")
                except Exception as exc:outputs.append((getattr(exc,"sqlstate",None),None));c.execute("ROLLBACK")
            one=threading.Thread(target=link,args=(first,f["issue"],"col160-two-issue-one"));two=threading.Thread(target=link,args=(second,f["issue_two"],"col160-two-issue-two"));one.start();two.start();deadline=time.monotonic()+10
            while time.monotonic()<deadline:
                if all(observer.execute("SELECT cardinality(pg_blocking_pids(%s))>0",(pid,)).fetchone()[0] for pid in (first.info.backend_pid,second.info.backend_pid)):break
                time.sleep(.02)
            else:raise AssertionError("Both same-task issue commands did not reach the shared expectation barrier")
            gate.execute("COMMIT");one.join(15);two.join(15);assert not one.is_alive() and not two.is_alive();assert sorted(code for code,_ in outputs)==["40001","ok"],outputs
            results.append({"case":"two-issues-same-task","both_waits_observed":True,"no_deadlock":True,"status":"PASS"})
    finally:admin.execute(psycopg.sql.SQL("DROP DATABASE {} WITH (FORCE)").format(psycopg.sql.Identifier(db)))
print(json.dumps({"scope":"local synthetic corporate deliverable concurrency","results":results},indent=2))
