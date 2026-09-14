-- Read-only catalog fingerprints; does not read application rows or secret values.
-- Retain the project ref, UTC capture time, source revision and ledger separately.
with objects as (
select 'relation' kind,n.nspname||'.'||c.relname identity,
jsonb_build_object('kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,'options',c.reloptions) definition
from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','p','v','m','S','f')
union all
select 'column',n.nspname||'.'||c.relname||'.'||a.attname,
jsonb_build_object('type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated)
from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m','f')
union all
select 'constraint',n.nspname||'.'||c.relname||'.'||co.conname,jsonb_build_object('definition',pg_get_constraintdef(co.oid,true),'validated',co.convalidated)
from pg_constraint co join pg_class c on c.oid=co.conrelid join pg_namespace n on n.oid=c.relnamespace
union all
select 'index',n.nspname||'.'||c.relname,jsonb_build_object('definition',pg_get_indexdef(c.oid),'valid',i.indisvalid,'ready',i.indisready)
from pg_index i join pg_class c on c.oid=i.indexrelid join pg_namespace n on n.oid=c.relnamespace
union all
select 'function',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
jsonb_build_object('definition',pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.prokind in ('f','p') and not exists(select 1 from pg_depend dep where dep.classid='pg_proc'::regclass and dep.objid=p.oid and dep.deptype='e')
union all
select 'policy',schemaname||'.'||tablename||'.'||policyname,jsonb_build_object('permissive',permissive,'roles',roles,'cmd',cmd,'qual',qual,'with_check',with_check) from pg_policies
union all
select 'trigger',n.nspname||'.'||c.relname||'.'||t.tgname,jsonb_build_object('definition',pg_get_triggerdef(t.oid,true),'enabled',t.tgenabled) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where not t.tgisinternal
union all
select 'view',n.nspname||'.'||c.relname,jsonb_build_object('definition',pg_get_viewdef(c.oid,true)) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('v','m')
union all
select 'enum',n.nspname||'.'||t.typname,jsonb_build_object('values',jsonb_agg(e.enumlabel order by e.enumsortorder)) from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid group by n.nspname,t.typname
) select kind,identity,md5(definition::text) digest from objects where split_part(identity,'.',1) in ('public','haven','officer','storage','auth') order by kind,identity;
