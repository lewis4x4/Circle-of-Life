"""Generate migration 464 (role consolidation) from a full local replay.

Owner rulings, Brian, 2026-09-22:
  * "Nurse is to not be used. Use Med-Tech instead."
  * "Caregiver / Resident Aide needs to be removed and everyone there changed to Med-Tech"
  * "Lead Cook / Dietary and Dietary Aide changed to Cook and everyone moved"
  * "make sure Cook and Housekeeper are added" / "need to add Marketing"
  * Marketing: pipeline, referrals and reputation only.

Merge semantics (a target role holds the UNION of what its sources held):
  med_tech <- nurse, caregiver, med_tech
  cook     <- dietary, dietary_aide
  * a positive list (IN, = ANY, ARRAY[...]) grants the target if it granted any source;
  * a negative list (NOT IN, <> ALL) is one of two things. If it names an administrator
    role (owner / org_admin / facility_admin) it is an ALLOW-list used as a guard
    ("role NOT IN (allowed) THEN RAISE") and folds like a granting list. Otherwise it is
    an EXCLUSION list ("not dietary or maintenance"): it excludes the target only if it
    excluded any source, and its legacy literals stay (nobody holds them any more,
    and removing them could leave an empty list). Every negative list is logged to
    stderr with its classification for review;
  * a single equality (role = 'caregiver') becomes the target.
Anything else is a hard stop for a person to read.

Usage: point /tmp/loc-psql.sh at a replay that has every migration through 463
applied, then: python3 scripts/role-sweep/generate-nurse-to-med-tech.py > supabase/migrations/464_role_consolidation.sql
"""
import re
import subprocess
import sys

PSQL = ["/tmp/loc-psql.sh", "-d", "haven"]
TARGET = {"nurse": "med_tech", "caregiver": "med_tech", "dietary": "cook", "dietary_aide": "cook"}
SOURCES = {"med_tech": {"nurse", "caregiver", "med_tech"}, "cook": {"dietary", "dietary_aide", "cook"}}
ROLE_RE = "nurse|caregiver|dietary_aide|dietary"


def q(sql):
    out = subprocess.run(PSQL + ["-F", "\x1f", "-R", "\x1e", "-c", sql], capture_output=True, text=True, check=True).stdout
    return [[f.strip("\n") for f in r.split("\x1f")] for r in out.split("\x1e") if r.strip()]


ELEM = r"'(?:[^']|'')*'(?:::[a-z_]+(?:\[\])?)?"
LIST_BODY = rf"\s*{ELEM}\s*(?:,\s*{ELEM}\s*)*"
IN_LIST = re.compile(rf"(?P<neg>NOT\s+)?IN\s*\((?P<body>{LIST_BODY})\)", re.I)
ARRAY_LIST = re.compile(rf"(?P<op>(?:<>|!=|=)\s*(?:ANY|ALL)\s*\(\s*)?ARRAY\s*\[(?P<body>{LIST_BODY})\]", re.I)


def elements(body):
    return [m.group(0) for m in re.finditer(ELEM, body)]


def value_of(elem):
    m = re.match(r"'((?:[^']|'')*)'(::[a-z_]+(?:\[\])?)?", elem)
    return m.group(1), (m.group(2) or "")


NEGATIVE_LOG = []


def rewrite_list(body, negative, add_marketing):
    # add_marketing is None, or the role whose presence in a granting list admits marketing.
    elems = elements(body)
    values = [value_of(e) for e in elems]
    names = [v for v, _ in values]
    if not any(n in TARGET for n in names) and not (add_marketing and add_marketing in names):
        return None
    cast = next((c for _, c in values if c), "")
    sep = ", " if ", " in body else ","
    out = []
    if negative and any(n in ("owner", "org_admin", "facility_admin") for n in names):
        NEGATIVE_LOG.append(("guard", names))
        negative = False
    elif negative:
        NEGATIVE_LOG.append(("exclusion", names))
    if negative:
        out = list(names)
        for target, sources in SOURCES.items():
            # An exclusion that names any source excludes the target: "not dietary"
            # lists never named dietary_aide, and a cook must not gain what the lead
            # cook was kept out of. (No exclusion list names nurse or caregiver.)
            if any(s in names for s in sources - {target}) and target not in out:
                out.append(target)
    else:
        for n in names:
            t = TARGET.get(n, n)
            if t not in out:
                out.append(t)
        if add_marketing and add_marketing in names and "marketing" not in out:
            out.append("marketing")
    return sep.join(f"'{n}'{cast}" for n in out)


def swap(text, where, add_marketing=None):
    def in_sub(m):
        new = rewrite_list(m.group("body"), bool(m.group("neg")), add_marketing)
        return m.group(0) if new is None else f"{m.group('neg') or ''}IN ({new})"

    def array_sub(m):
        op = m.group("op") or ""
        negative = bool(re.match(r"(<>|!=)", op))
        new = rewrite_list(m.group("body"), negative, add_marketing)
        return m.group(0) if new is None else f"{op}ARRAY[{new}]"

    text = IN_LIST.sub(in_sub, text)
    text = ARRAY_LIST.sub(array_sub, text)
    # Single equality comparisons.
    text = re.sub(rf"(?<![!<>])(=\s*)'({ROLE_RE})'(::[a-z_]+)?", lambda m: f"{m.group(1)}'{TARGET[m.group(2)]}'{m.group(3) or ''}", text)
    text = re.sub(rf"'({ROLE_RE})'(::[a-z_]+)?(\s*=)(?!=)", lambda m: f"'{TARGET[m.group(1)]}'{m.group(2) or ''}{m.group(3)}", text)
    return text


def leftovers(text):
    """Role literals still present that are not inside an exclusion list or an inequality."""
    bad = []
    masked = text
    def is_exclusion(body):
        return not re.search(r"'(owner|org_admin|facility_admin)'", body)
    for m in list(IN_LIST.finditer(masked)):
        if m.group("neg") and is_exclusion(m.group("body")):
            masked = masked.replace(m.group(0), " " * len(m.group(0)), 1)
    for m in list(ARRAY_LIST.finditer(masked)):
        if m.group("op") and re.match(r"(<>|!=)", m.group("op")) and is_exclusion(m.group("body")):
            masked = masked.replace(m.group(0), " " * len(m.group(0)), 1)
    for m in re.finditer(rf"'({ROLE_RE})'", masked):
        before = masked[max(0, m.start() - 12):m.start()]
        if re.search(r"(<>|!=)\s*$", before):
            continue
        bad.append(masked[max(0, m.start() - 70):m.end() + 40].replace("\n", " "))
    return bad


def ident(s):
    return '"' + s.replace('"', '""') + '"'


HAND_WRITTEN = {"role_tier", "submit_care_event"}

print("""-- Role consolidation, Brian 2026-09-22:
--   "Nurse is to not be used. Use Med-Tech instead."
--   "Caregiver / Resident Aide needs to be removed and everyone there changed to Med-Tech"
--   "Lead Cook / Dietary and Dietary Aide changed to Cook and everyone moved"
--   "make sure Cook and Housekeeper are added" / "need to add Marketing"
--
-- GENERATED by scripts/role-sweep/generate-nurse-to-med-tech.py from a full replay of
-- supabase/migrations through 463, checked against production before generation.
-- Static on purpose: no catalog-driven loop runs on the hosted database.
--
-- A target role holds the UNION of what its sources held:
--   med_tech <- nurse, caregiver, med_tech        cook <- dietary, dietary_aide
-- Granting lists (and allow-list guards such as "NOT IN (owner, ...) THEN RAISE") grant
-- the target if they granted any source; exclusion lists ("not dietary or maintenance")
-- exclude the target if they excluded any source (legacy literals stay there — nobody
-- holds those roles after this migration). Marketing is granted wherever a referral
-- surface grants the coordinator (plus lead writing), and wherever a reputation surface
-- grants the facility administrator.
-- History is not rewritten: audit rows, actor_role columns and receipts keep the role
-- that acted.
BEGIN;
""")

pol = q(f"""select schemaname, tablename, policyname, coalesce(qual,''), coalesce(with_check,'')
 from pg_policies where (coalesce(qual,'')||coalesce(with_check,'')) ~ '''({ROLE_RE})'''
   or (tablename ~ '^referral_' and (coalesce(qual,'')||coalesce(with_check,'')) ~ '''coordinator''')
   or (tablename ~ '^reputation_' and (coalesce(qual,'')||coalesce(with_check,'')) ~ '''facility_admin''')
 order by 1,2,3""")
problems = []
print(f"-- {len(pol)} policies")
for s, t, p, qual, chk in pol:
    # Referrals: marketing wherever the coordinator is. Reputation grants no coordinator,
    # so marketing joins wherever the facility administrator works reviews.
    mk = "coordinator" if t.startswith("referral_") else "facility_admin" if t.startswith("reputation_") else None
    qual, chk = qual.strip(), chk.strip()
    parts = []
    for label, expr in (("USING", qual), ("WITH CHECK", chk)):
        if not expr:
            continue
        new = swap(expr, p, mk)
        problems += [f"policy {t}.{p}: {x}" for x in leftovers(new)]
        parts.append(f"{label} ({new})")
    print(f"ALTER POLICY {ident(p)} ON {ident(s)}.{ident(t)}\n  " + "\n  ".join(parts) + ";")

fns = q(f"""select p.oid, n.nspname, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','haven') and (p.prosrc ~ '''({ROLE_RE})'''
   or (p.proname ~ '^referral_' and p.prosrc ~ '''coordinator''')
   or (p.proname ~ '^reputation_' and p.prosrc ~ '''facility_admin'''))
 order by 2, 3, 1""")
hand = {}
print(f"\n-- {len(fns)} functions")
for oid, nsp, name in fns:
    d = q(f"select pg_get_functiondef({oid})")[0][0]
    if name in HAND_WRITTEN:
        hand[name] = d
        continue
    new = swap(d, name, "coordinator" if name.startswith("referral_") else "facility_admin" if name.startswith("reputation_") else None)
    if name == "referral_capability":
        # Marketing enters leads: lead_write is the one capability coordinator lacks that marketing needs.
        new, n = re.subn(r"(WHEN 'lead_write' THEN actor\.actor_role_text = ANY \(ARRAY\[[^\]]*?)\]",
                         lambda m: m.group(1) + ("" if "'marketing'" in m.group(1) else ",'marketing'") + "]", new)
        if n != 1:
            problems.append("referral_capability: lead_write marketing grant did not apply")
    problems += [f"function {nsp}.{name}: {x}" for x in leftovers(new)]
    print(new.rstrip() + ";\n")

# submit_care_event: follow-up protocols assign 'caregiver' tasks to the reporter.
sce = hand.get("submit_care_event")
if sce:
    new = swap(sce, "submit_care_event")
    new = new.replace("WHEN 'caregiver' THEN v_uid", "WHEN 'caregiver' THEN v_uid\n        WHEN 'med_tech' THEN v_uid")
    rest = [x for x in leftovers(new) if "WHEN 'caregiver' THEN v_uid" not in x]
    problems += [f"function public.submit_care_event: {x}" for x in rest]
    print(new.rstrip() + ";\n")

print("""
CREATE OR REPLACE FUNCTION haven.role_tier(p_role public.app_role)
 RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO ''
AS $function$
  SELECT CASE p_role
    WHEN 'owner' THEN 100 WHEN 'org_admin' THEN 90 WHEN 'facility_admin' THEN 80
    WHEN 'manager' THEN 70 WHEN 'coordinator' THEN 60
    WHEN 'admin_assistant' THEN 50 WHEN 'med_tech' THEN 50 WHEN 'marketing' THEN 50
    WHEN 'cook' THEN 40 WHEN 'maintenance_role' THEN 40
    WHEN 'broker' THEN 30 WHEN 'housekeeper' THEN 30
    WHEN 'family' THEN 10
    -- Retired roles (2026-09-22): no one holds them; kept so an old value still sorts.
    WHEN 'nurse' THEN 50 WHEN 'dietary' THEN 40 WHEN 'caregiver' THEN 20 WHEN 'dietary_aide' THEN 20
    ELSE 0 END
$function$;
""")

print(open(__file__.replace("generate-nurse-to-med-tech.py", "role-consolidation-data.sql")).read())

for kind, names in sorted({(k, tuple(n)) for k, n in NEGATIVE_LOG}):
    sys.stderr.write(f"negative list [{kind}]: {', '.join(names)}\n")

if problems:
    sys.stderr.write("UNHANDLED ROLE LITERALS — read these before shipping:\n" + "\n".join(problems) + "\n")
    sys.exit(2)
