from pathlib import Path
import re,json,hashlib,subprocess
ROOT=Path('/Users/brianlewis/Circle of Life/Haven HFO Staging Integration'); OUT=Path(__file__).parent
files=sorted((ROOT/'supabase/migrations').glob('*.sql')); original={p.name:p.read_text() for p in files}; replace={}
def synth(v,kind='value'):
 h=hashlib.sha256(v.lower().encode()).hexdigest()[:10]
 if kind=='email':return 'synthetic-'+h+'@example.invalid'
 if kind=='phone':return '202-555-01'+str(int(h,16)%100).zfill(2)
 if kind=='fein':return '00-'+str(int(h,16)%10000000).zfill(7)
 if kind=='zip':return '00000'
 return 'Synthetic '+kind+' '+h
# Actual workbook payload is purely imported personnel/financial data, no DDL.
omit={'20260514203302_homewood_round2_ar_intake_may_2026.sql'}
# SQL token scanning preserves offsets, skips comments, and reads SQL string literals
# inside dollar-quoted procedural bodies (those bodies are intentionally treated as SQL).
def tokens(s):
 result=[];i=0
 while i<len(s):
  if s.startswith('--',i):
   j=s.find('\n',i);i=len(s) if j<0 else j+1;continue
  if s.startswith('/*',i):
   j=s.find('*/',i+2);assert j>=0;i=j+2;continue
  if s[i]=="'":
   a=i;i+=1;v=''
   while i<len(s):
    if s.startswith("''",i):v+="'";i+=2
    elif s[i]=="'":i+=1;break
    else:v+=s[i];i+=1
   result.append(('str',v,a,i));continue
  m=re.match(r'[A-Za-z_][A-Za-z_0-9]*|[(),;.]',s[i:])
  if m:result.append(('word',m[0],i,i+len(m[0])));i+=len(m[0])
  else:i+=1
 return result
sensitive={'first_name','last_name','full_name','email','phone','primary_contact_name','primary_contact_email','primary_contact_phone','contact_name','registered_agent_name','fein','address_line_1','address_line_2','city','zip','administrator_name'}
# Discover literal data fields in direct INSERT(...columns...) VALUES(...rows...).
for name,s in original.items():
 if name in omit:continue
 ts=tokens(s)
 for i,t in enumerate(ts):
  if t[1].upper()!='INSERT' or i+3>=len(ts) or ts[i+1][1].upper()!='INTO':continue
  j=i+2;table=ts[j][1];j+=1
  if ts[j][1]=='.':table=ts[j+1][1];j+=2
  if ts[j][1]!='(':continue
  j+=1;cols=[]
  while j<len(ts) and ts[j][1]!=')':
   if ts[j][1]!=',':cols.append(ts[j][1])
   j+=1
  j+=1
  if j>=len(ts) or ts[j][1].upper()!='VALUES':continue
  j+=1
  while j<len(ts) and ts[j][1]=='(':
   j+=1;depth=1;fields=[[]]
   while j<len(ts) and depth:
    v=ts[j][1]
    if v=='(':depth+=1
    elif v==')':depth-=1
    if not depth:break
    if v==',' and depth==1:fields.append([])
    else:fields[-1].append(ts[j])
    j+=1
   cell=dict(zip(cols,fields))
   if all(k in cell and len(cell[k])==1 and cell[k][0][0]=='str' for k in ['first_name','last_name']):
    full=cell['first_name'][0][1]+' '+cell['last_name'][0][1];replace[full]=synth(full,'full_name')
   for col,field in zip(cols,fields):
    if col in sensitive and len(field)==1 and field[0][0]=='str':
     v=field[0][1];replace[v]=synth(v,'email' if 'email' in col else 'phone' if 'phone' in col else col)
   j+=1
   if j<len(ts) and ts[j][1]==',':j+=1
# SELECT-from-VALUES workbook personnel names have a separate, explicit four-column shape.
s=original['20260514180707_homewood_round2_employee_seed.sql']
for first,last,email,role in re.findall(r"\('([^']*)',\s*'([^']*)',\s*'([^']*)',\s*'([^']*)'\)",s):
 replace[first]=synth(first,'first_name');replace[last]=synth(last,'last_name');replace[email]=synth(email,'email')
# UPDATE field literals, including 179 administrator contact refresh and159 address data.
for name,s in original.items():
 if name in omit:continue
 for col,value in re.findall(r"\b("+'|'.join(sorted(sensitive))+r")\s*=\s*'((?:''|[^'])*)'",s,re.I):
  value=value.replace("''", "'")
  if value and '%' not in value:replace[value]=synth(value,'email' if 'email' in col else 'phone' if 'phone' in col else col.lower())
# Replace complete emergency/vendor contact labels directly adjacent to phone literals.
for name in ['131_facility_admin_portal.sql','236_restore_transport_vendor_seed.sql','282_phase1_vendor_seed.sql']:
 s=original[name]
 for label,phone in re.findall(r"'([^']+)'\s*,\s*'((?:1-)?\d{3}-\d{3}-\d{4})'",s):
  replace[label]=synth(label,'contact');replace[phone]=synth(phone,'phone')
# SQL token adjacency handles escaped apostrophes in emergency contact labels.
for name in ['131_facility_admin_portal.sql','236_restore_transport_vendor_seed.sql','282_phase1_vendor_seed.sql']:
 ts=tokens(original[name])
 for i,t in enumerate(ts):
  if t[0]=='str' and re.fullmatch(r'(?:1-)?\d{3}-\d{3}-\d{4}',t[1]) and i>=2 and ts[i-1][1]==',' and ts[i-2][0]=='str':
   v=ts[i-2][1];replace[v]=synth(v,'contact')
# Consistent emails and phones across JSON identity metadata and named seed references.
for name,s in original.items():
 if name in omit:continue
 for email in re.findall(r'[\w.+%-]+@[\w.-]+\.[A-Za-z]{2,}',s):replace[email]=synth(email,'email')
 for phone in re.findall(r'(?<!\d)(?:1-)?\d{3}-\d{3}-\d{4}(?!\d)',s):replace[phone]=synth(phone,'phone')
# JSON metadata full names must be replaced before insertion too.
for name,s in original.items():
 if name in omit:continue
 for full in re.findall(r'"full_name"\s*:\s*"([^"]+)"',s):replace[full]=synth(full,'full_name')
# Avoid incidental replacement of short/common string constants in DDL/functions.
# Only exact SQL literals, JSON field values, email/phone text and known full-name
# values are rewritten; no identifier or enum labels change.
manifest={'source_commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'target':'iwcnajanvjvynolltflw','files':[],'schema_equivalence':'pending','omitted_data_only_files':sorted(omit),'execution_boundary_delta':'173 appends dietary_aide enum addition, committed before174;174 remains original apart from any literal privacy substitutions','bootstrap':'008 appends only banned synthetic FK actors matching historical references; no privileges or sessions'}
for name,s in original.items():
 applied=s
 reasons=[]
 if name in omit:
  applied='-- STAGING SYNTHETIC VARIANT: original data-only resident A/R workbook import omitted.\n-- No schema, enum, constraint or catalog statement exists in the source file.\nDO $$ BEGIN RAISE NOTICE \'Synthetic staging excludes real resident workbook intake\'; END $$;\n';reasons=['omit-real-resident-financial-import']
 else:
  spans=tokens(s)
  for typ,value,a,b in reversed(spans):
   if typ!='str':continue
   v=value
   if v in replace:v=replace[v]
   else:
    # Nested auth JSON literals preserve all authorization keys, replacing only identity display/contact fields.
    for old,new in replace.items():
     if '@' in old or re.fullmatch(r'(?:1-)?\d{3}-\d{3}-\d{4}',old) or ('"full_name"' in v and ('"'+old+'"') in v) or (new.startswith(('Synthetic full_name ','Synthetic primary_contact_name ','Synthetic administrator_name ')) and old in v):v=v.replace(old,new)
   if v!=value:applied=applied[:a]+"'"+v.replace("'","''")+"'"+applied[b:]
  if applied!=s:reasons.append('synthetic-personnel-contact-literals')
 if name=='008_seed_col_organization.sql':
  applied+='''\n-- STAGING-ONLY synthetic actors for historical created_by foreign keys. No login or grants.\nINSERT INTO auth.users(id,email,encrypted_password,banned_until,raw_app_meta_data,raw_user_meta_data) VALUES\n ('00000000-0000-0000-0000-000000000001','synthetic-system@example.invalid','', '2099-01-01','{}','{"full_name":"Synthetic system actor"}'),\n ('062c3cfb-53a5-4482-814a-cbef2b028760','synthetic-seed-actor@example.invalid','', '2099-01-01','{}','{"full_name":"Synthetic seed actor"}')\nON CONFLICT(id) DO UPDATE SET email=excluded.email,encrypted_password='',banned_until=excluded.banned_until,raw_user_meta_data=excluded.raw_user_meta_data;\n''';reasons.append('synthetic-foreign-key-actors')
 if name=='173_seed_med_tech_cockpit_demo.sql':
  applied+="\n-- STAGING-ONLY transaction boundary bootstrap: commit enum value before174 uses it.\nALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'dietary_aide';\n";reasons.append('precommit-174-enum')
 for deferred in ['249_vendor_facility_compliance_and_categories.sql','281_phase1_staff_seed.sql']:
  predecessor=list(original)[list(original).index(deferred)-1]
  if name==predecessor:
   statements=re.findall(r'ALTER TYPE\s+[^;]+?ADD VALUE\s+IF NOT EXISTS\s+[^;]+;',original[deferred],re.I)
   assert statements
   applied+='\n-- STAGING-ONLY: commit enum additions before '+deferred+' uses them.\n'+'\n'.join(statements)+'\n'
   reasons.append('precommit-enums-for-'+deferred)
 (OUT/'migrations'/name).write_text(applied)
 manifest['files'].append({'file':name,'original_sha256':hashlib.sha256(s.encode()).hexdigest(),'applied_sha256':hashlib.sha256(applied.encode()).hexdigest(),'changes':reasons})
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'files':len(files),'modified':sum(bool(x['changes']) for x in manifest['files']),'literal_values_normalized':len(replace),'output':str(OUT)}))
