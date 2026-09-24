#!/usr/bin/env node
/**
 * Seed the floor tablet and kiosk fidelity demo on Haven HFO Staging (COL-694,
 * spec 40 section 10, DESIGN.md section 6).
 *
 * STAGING ONLY, ONE ISOLATED ORGANIZATION
 * ---------------------------------------
 * Reads `.env.staging.local` and nothing else (never `.env.local`, which is
 * production). Refuses to run unless the Supabase URL is Haven HFO Staging
 * (iwcnajanvjvynolltflw) AND `supabase/.temp/project-ref` links the same
 * project, because half the writes go through `supabase db query --linked`.
 * Everything lands in one organization created here, "Haven Demo Workspace
 * (Fidelity)", with one entity and one facility, "Fidelity Demo - Floor Kiosk".
 * No row of any other organization is written. Every auth user it creates has
 * an `@fidelity-demo.invalid` address, is created confirmed, and is never sent
 * an email. `scripts/floor/fidelity-demo-teardown.sql` removes all of it.
 *
 * FICTIONAL PEOPLE ONLY
 * ---------------------
 * The prototype's sample staff (Ashley Warren, Dana Reyes), residents (Evelyn
 * Carter 101 ... Curtis Hale 110) and visitors (Carol P., Carlos M.), plus
 * invented fillers to reach the rendered "34 in building". Two personas the
 * prototype does not draw: Jordan Kemp (a med tech nobody punches in, for the
 * spec 40 item 1 punch-in-then-roster test) and Patricia Lane (the
 * administrator whose Home shows the inspector banner). No real name anywhere.
 *
 * TIME STRATEGY
 * -------------
 * Two clocks are in play and they are kept apart on purpose.
 *
 * 1. The browser clock. Playwright freezes it (page.clock.setFixedTime) at the
 *    capture date's 9:40 AM Eastern for floor states, 6:58 AM for kiosk staff
 *    states, 10:12 AM for visitor sign-in and 11:40 AM for leaving. Everything
 *    the floor app derives on the client reads that clock: the "10 min over" /
 *    "In 20 min" minutes (src/lib/floor/now-rows.ts checkTiming), the Now
 *    window and the top-bar time.
 *
 * 2. The server clock (real now()). Server rules that read it:
 *    - Roster: haven.timeclock_state(staff, now()) must be 'in', which needs an
 *      in punch within the last 16 hours. The seed records the prototype's
 *      punches (Ashley 6:58 AM, Dana 6:52 AM on the capture date) through the
 *      real kiosk path, public.timeclock_record_punch on HL-KIOSK-01, as
 *      offline captures whose device time is the rendered time. That path
 *      takes the device time as the punch time, so the ledger, the roster's
 *      "on since" and the my-shift strip all say 6:58 AM, flagged
 *      offline_capture. This holds while real now is between the punch time
 *      and 16 hours after it (6:58 AM to 10:58 PM Eastern on the capture date).
 *      Outside that window the seed punches at real now minus 2 and 8 minutes
 *      instead and prints a warning: the roster works, "on since" shows the
 *      real time (a data difference, not a defect).
 *    - Check status. /api/rounding/tasks derives a status from real now() only
 *      when the facility has a board policy (thresholds plus an escalation
 *      ladder in force). This organization has no cadence or ladder donor, so
 *      the facility trigger leaves it without a ladder and the route returns
 *      the status stored on each row verbatim. The seed stores exactly the
 *      prototype's states (9:30 overdue, 9:45 due_now, 10:00 and later
 *      upcoming) and the client clock supplies the minutes. The same absence
 *      keeps the live staging crons off it: observation-task-generator skips a
 *      facility with no cadence, and the escalation engine walks no ladder.
 *    - Visitor times: the two open visits are stored with the rendered
 *      check-in times on the capture date (Carlos M. 9:48 AM, Carol P. 10:12
 *      AM), in the past relative to real now whenever the seed runs after
 *      10:12 AM Eastern.
 *    The capture date defaults to today in America/New_York; `--date` accepts
 *    another YYYY-MM-DD, but only today keeps the roster populated, so any
 *    other date prints a warning. The kiosk home's date line shows the capture
 *    date (an allowed data difference); nothing server side reads the browser
 *    date, so the capture script may freeze /kiosk at 2026-10-01 instead.
 *
 * KIOSK STAFF STATES
 * ------------------
 * 12-kiosk-clock-in needs Ashley OFF the clock ("Last clock out: <day>, 7:06
 * PM") while 01/03 need her ON it. `--ashley-off` seeds her previous-day shift
 * (in 6:58 AM, out 7:06 PM) but not today's in punch, so the capture script can
 * run the kiosk staff flow first and then re-run the seed without the flag.
 *
 * IDEMPOTENT
 * ----------
 * Fixed ids (a sha256-derived namespace beginning `f1de0677`), upserts by
 * natural keys, deterministic client punch ids (a replayed punch is a no-op),
 * and device tokens reused while they still resolve. Checks the tests have
 * charted are soft-deleted and replaced with pristine copies (the rounding
 * guard lets only the database owner do that), so re-running before every
 * Playwright run converges on the rendered state. Two append-only ledgers are
 * set back the same way the teardown clears them (guard trigger off inside one
 * transaction, demo organization only): Ashley's and Dana's punches return to
 * the rendered set, and charted checks left on replaced checks are removed so
 * the my-shift strip counts only the seeded rounds.
 *
 * SECRETS
 * -------
 * Device tokens, PINs and passwords go to test-results/floor-kiosk/devices.json
 * (gitignored) and are never printed. The SQL carrying PINs goes through a
 * 0600 temp file that is deleted afterwards.
 *
 *   node scripts/floor/seed-prototype-demo.mjs [--date YYYY-MM-DD] [--ashley-off]
 */
import { execFileSync } from "node:child_process";
import crypto, { createHash, randomBytes, randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

const PREFIX = "[floor-demo-seed]";
const STAGING_REF = "iwcnajanvjvynolltflw";
const PRODUCTION_REF = "manfqmasfqppukpobpld";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SECRETS_DIR = path.join(REPO_ROOT, "test-results/floor-kiosk");
export const DEVICES_FILE = path.join(SECRETS_DIR, "devices.json");
const TZ = "America/New_York";

export const DEMO_ORG_NAME = "Haven Demo Workspace (Fidelity)";
export const DEMO_FACILITY_NAME = "Fidelity Demo - Floor Kiosk";
export const DEMO_EMAIL_DOMAIN = "fidelity-demo.invalid";

function log(message) {
  console.log(`${PREFIX} ${message}`);
}

function fail(message) {
  console.error(`${PREFIX} ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Staging, and only staging
// ---------------------------------------------------------------------------
function loadStagingEnv() {
  const file = path.join(REPO_ROOT, ".env.staging.local");
  if (!existsSync(file)) fail(".env.staging.local is missing; it holds the Haven HFO Staging keys.");
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  const url = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(STAGING_REF) || url.includes(PRODUCTION_REF)) {
    fail(`REFUSING: .env.staging.local does not point at Haven HFO Staging (${STAGING_REF}).`);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) fail(".env.staging.local has no SUPABASE_SERVICE_ROLE_KEY.");
  return { url, serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY, anonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "" };
}

function assertLinkedToStaging() {
  const refFile = path.join(REPO_ROOT, "supabase/.temp/project-ref");
  const ref = existsSync(refFile) ? readFileSync(refFile, "utf8").trim() : "";
  if (ref !== STAGING_REF) fail(`REFUSING: supabase/.temp/project-ref is "${ref}", not ${STAGING_REF}. Run supabase link --project-ref ${STAGING_REF}.`);
}

/** Runs SQL as the database owner through the Management API; returns the final statement's rows. */
function runLinkedSql(sql, label) {
  // The CLI logs in through a temporary role on the pooler; when several
  // sessions do that at once the pooler's circuit breaker refuses logins for a
  // short while. That refusal happens before any SQL runs, so waiting and
  // trying again is safe.
  for (let attempt = 1; ; attempt += 1) {
    try {
      return runLinkedSqlOnce(sql, label);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (attempt >= 4 || !/ECIRCUITBREAKER|failed to connect as temp role|SASL auth/.test(message)) fail(`${label} SQL failed: ${message.slice(0, 1500)}`);
      log(`${label}: the pooler refused the CLI login; retrying in ${attempt * 20} s`);
      execFileSync("sleep", [String(attempt * 20)]);
    }
  }
}

function runLinkedSqlOnce(sql, label) {
  assertLinkedToStaging();
  mkdirSync(SECRETS_DIR, { recursive: true });
  const file = path.join(tmpdir(), `floor-demo-${label}-${process.pid}-${randomBytes(4).toString("hex")}.sql`);
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    const out = execFileSync("supabase", ["db", "query", "--linked", "-f", file, "-o", "json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 32 * 1024 * 1024,
    });
    const start = out.indexOf("{");
    if (start < 0) throw new Error(`no JSON from supabase db query (${label})`);
    return JSON.parse(out.slice(start)).rows ?? [];
  } catch (cause) {
    const stderr = cause && typeof cause === "object" && "stderr" in cause ? String(cause.stderr) : "";
    // The CLI echoes the database error; the file (and its PIN hashes input) stays private.
    throw new Error(stderr.split("\n").filter((l) => l && !/new version|recommend/i.test(l)).join(" ") || String(cause));
  } finally {
    rmSync(file, { force: true });
  }
}

// ---------------------------------------------------------------------------
// Ids, dates, people, residents
// ---------------------------------------------------------------------------
/** Deterministic uuid in the reserved `f1de0677` namespace. */
export function demoUuid(name) {
  const h = createHash("sha256").update(`col-677-fidelity-demo:${name}`).digest("hex");
  return `f1de0677-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const IDS = {
  org: demoUuid("organization"),
  entity: demoUuid("entity"),
  facility: demoUuid("facility"),
};

function todayEastern() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The UTC instant of a wall-clock time in America/New_York on a date. */
export function easternInstant(isoDate, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const guess = Date.UTC(Number(isoDate.slice(0, 4)), Number(isoDate.slice(5, 7)) - 1, Number(isoDate.slice(8, 10)), h, m);
  for (const offsetHours of [4, 5]) {
    const candidate = new Date(guess + offsetHours * 3_600_000);
    const shown = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(candidate);
    if (shown === hhmm) return candidate;
  }
  throw new Error(`cannot place ${isoDate} ${hhmm} in ${TZ}`);
}

/** The people. Keys are stable handles the tests use. */
export const PEOPLE = [
  // The administrator first: the others' credentials name her as the one who set them.
  { key: "admin", first: "Patricia", last: "Lane", appRole: "facility_admin", staffRole: "administrator", employeeNumber: "1001" },
  { key: "ashley", first: "Ashley", last: "Warren", appRole: "med_tech", staffRole: "medication_tech", employeeNumber: "1042" },
  { key: "dana", first: "Dana", last: "Reyes", appRole: "med_tech", staffRole: "medication_tech", employeeNumber: "1043" },
  { key: "jordan", first: "Jordan", last: "Kemp", appRole: "med_tech", staffRole: "medication_tech", employeeNumber: "1077" },
].map((person) => ({
  ...person,
  userId: demoUuid(`user:${person.key}`),
  staffId: demoUuid(`staff:${person.key}`),
  email: `${person.first}.${person.last}@${DEMO_EMAIL_DOMAIN}`.toLowerCase(),
}));

/** The prototype's nine residents, by room. */
const NAMED_RESIDENTS = [
  { room: "101", first: "Evelyn", last: "Carter", gender: "female", fall: "high", device: "Walker within reach", instructions: "Call light clipped right side; reaches with right hand. Hard of hearing, right ear: speak on her left side." },
  { room: "102", first: "Harold", last: "Nguyen", gender: "male", fall: "moderate", device: "Up with walker" },
  { room: "103", first: "Ruth", last: "Simmons", gender: "female", instructions: "Encourage fluids and finish meals; log intake." },
  { room: "104", first: "Walter", last: "Brooks", gender: "male", instructions: "Shower assist on Tuesdays and Thursdays at 11:00." },
  { room: "105", first: "Mae", last: "Johnson", gender: "female", admittedDaysAgo: 2, instructions: "New admission: introduce yourself each visit." },
  { room: "106", first: "Frank", last: "Delgado", gender: "male", instructions: "Restless overnight; offer a walk before rest." },
  { room: "107", first: "Lorraine", last: "Pitts", gender: "female", instructions: "Family visit at 2 PM." },
  { room: "108", first: "George", last: "Adams", gender: "male", status: "hospital_hold" },
  { room: "110", first: "Curtis", last: "Hale", gender: "male", instructions: "Reposition every 2 hours while in bed." },
];

/** Invented fillers: 34 residents active ("34 in building"), plus George on a hospital hold. */
const FILLER_NAMES = [
  ["Beatrice", "Holloway", "female"], ["Clarence", "Whitfield", "male"], ["Dorothy", "Pembrook", "female"], ["Edgar", "Lindqvist", "male"],
  ["Florence", "Addington", "female"], ["Gilbert", "Marchetti", "male"], ["Hazel", "Brandt", "female"], ["Irving", "Castellan", "male"],
  ["June", "Okafor", "female"], ["Lester", "Vance", "male"], ["Marjorie", "Ellery", "female"], ["Norman", "Pryce", "male"],
  ["Opal", "Sturgis", "female"], ["Percy", "Langhorne", "male"], ["Rosalind", "Tate", "female"], ["Stanley", "Whitcombe", "male"],
  ["Thelma", "Ashdown", "female"], ["Vernon", "Kilbride", "male"], ["Winifred", "Oakes", "female"], ["Alvin", "Rourke", "male"],
  ["Bernice", "Calloway", "female"], ["Cecil", "Dunmore", "male"], ["Della", "Farrow", "female"], ["Eugene", "Hartwell", "male"],
  ["Imogene", "Quarles", "female"], ["Ambrose", "Pickett", "male"],
];

function buildResidents(captureDate) {
  const fillerRooms = ["109", ...Array.from({ length: 25 }, (_, i) => String(111 + i))];
  const residents = [
    ...NAMED_RESIDENTS.map((r) => ({ ...r, key: r.first.toLowerCase() })),
    ...FILLER_NAMES.map(([first, last, gender], i) => ({ key: `filler-${i}`, room: fillerRooms[i], first, last, gender })),
  ];
  return residents.map((r, i) => ({
    id: demoUuid(`resident:${r.room}`),
    key: r.key,
    room: r.room,
    room_id: demoUuid(`room:${r.room}`),
    bed_id: demoUuid(`bed:${r.room}`),
    unit_id: Number(r.room) <= 118 ? demoUuid("unit:hall-a") : demoUuid("unit:hall-b"),
    first_name: r.first,
    last_name: r.last,
    gender: r.gender,
    status: r.status ?? "active",
    date_of_birth: `19${30 + (i % 15)}-0${1 + (i % 9)}-1${i % 10}`,
    admission_date: addDays(captureDate, -(r.admittedDaysAgo ?? 200 + i * 11)),
    fall_risk_level: r.fall ?? "low",
    assistive_device: r.device ?? null,
    special_instructions: r.instructions ?? null,
    sort_order: Number(r.room),
  }));
}

const RESIDENT_BY_KEY = (residents) => new Map(residents.map((r) => [r.key, r]));

// ---------------------------------------------------------------------------
// Checks at the rendered due times
// ---------------------------------------------------------------------------
/**
 * Every check the capture date needs. `log` checks are already charted (the
 * 5:30 night check and the 7:30 round Ashley charted, "Rounds: 12 of 12").
 */
function buildChecks(residents) {
  const by = RESIDENT_BY_KEY(residents);
  const checks = [];
  const add = (key, residentKey, due, status, extra = {}) => checks.push({ key, resident_id: by.get(residentKey).id, due, status, ...extra });

  add("evelyn-0530", "evelyn", "05:30", "completed_on_time", { log: { by: "dana", at: "05:30", quick: "asleep", state: "asleep", location: "in_bed" } });
  // The 7:30 round, 11 residents, assigned to and charted by Ashley. With Ruth's
  // 8:00 check (charted by Ashley, unassigned) that is the strip's "Rounds: 12 of
  // 12 charted": 12 logs are hers and 12 of her assigned checks were due by 9:40
  // (the 11 round checks and Evelyn's 9:30).
  const roundKeys = ["evelyn", "harold", "ruth", "walter", "mae", "frank", "lorraine", "curtis", "filler-0", "filler-1", "filler-2"];
  roundKeys.forEach((residentKey, i) =>
    add(`round-0730-${residentKey}`, residentKey, "07:30", "completed_on_time", {
      assigned: "ashley",
      log: { by: "ashley", at: `07:${String(30 + i).padStart(2, "0")}`, quick: residentKey === "evelyn" ? "calm" : "awake", state: "awake", location: residentKey === "evelyn" ? "in_chair" : "in_room" },
    }),
  );
  // Ruth's 8:00 check: charted, and the open follow-up behind her alert dot.
  add("ruth-0800", "ruth", "08:00", "completed_on_time", {
    log: { by: "ashley", at: "08:05", quick: "awake", state: "awake", location: "dining_room", note: "Ate 25% at breakfast" },
    escalation: { at: "08:05" },
  });
  // Open checks are Ashley's, so the floor offers Done rather than "Take this check".
  const mine = { assigned: "ashley" };
  add("evelyn-0930", "evelyn", "09:30", "overdue", mine);
  add("ruth-0945", "ruth", "09:45", "due_now", mine);
  add("mae-0945", "mae", "09:45", "due_now", mine);
  add("lorraine-1000", "lorraine", "10:00", "upcoming", mine);
  add("curtis-1000", "curtis", "10:00", "upcoming", mine);
  add("harold-1015", "harold", "10:15", "upcoming", mine);
  add("evelyn-1130", "evelyn", "11:30", "upcoming", mine);
  return checks;
}

// ---------------------------------------------------------------------------
// Secrets file
// ---------------------------------------------------------------------------
function readSecrets() {
  if (!existsSync(DEVICES_FILE)) return null;
  try {
    return JSON.parse(readFileSync(DEVICES_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeSecrets(secrets) {
  mkdirSync(SECRETS_DIR, { recursive: true });
  writeFileSync(DEVICES_FILE, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
}

function sixDigitPin() {
  // No repeated or sequential runs: the PIN pad tests type it digit by digit.
  for (;;) {
    const pin = String(randomInt(100000, 1000000));
    if (!/(\d)\1\1/.test(pin) && !"0123456789".includes(pin) && !"9876543210".includes(pin)) return pin;
  }
}

const DEVICE_SPECS = [
  { label: "HL-KIOSK-01", kind: "kiosk" },
  { label: "HL-FLOOR-01", kind: "floor" },
  { label: "HL-FLOOR-02", kind: "floor" },
  { label: "HL-FLOOR-03", kind: "floor" },
];

const sha256Hex = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const sqlJson = (value) => `$doc$${JSON.stringify(value)}$doc$::jsonb`;

// ---------------------------------------------------------------------------
// SQL, part 1: organization, building, people, credentials, checks
// ---------------------------------------------------------------------------
function structureSql(doc) {
  return `
SET search_path = public, extensions;
SET statement_timeout = '90s';
DROP TABLE IF EXISTS pg_temp.demo_seed_report;
CREATE TEMP TABLE demo_seed_report (seq bigserial PRIMARY KEY, item text NOT NULL, detail text);
BEGIN;
DO $seed$
DECLARE
  d jsonb := ${sqlJson(doc)};
  v_org uuid := (d->>'org_id')::uuid;
  v_entity uuid := (d->>'entity_id')::uuid;
  v_fac uuid := (d->>'facility_id')::uuid;
  v_admin uuid := (d->>'admin_user_id')::uuid;
  v_date date := (d->>'date')::date;
  v_tz constant text := '${TZ}';
  v_now timestamptz := clock_timestamp();
  r record;
  c jsonb;
  v_task uuid;
  v_log uuid;
  v_due timestamptz;
  v_n integer;
BEGIN
  -- Refuse to adopt anything that is not ours.
  IF EXISTS (SELECT 1 FROM public.organizations o WHERE o.name = d->>'org_name' AND o.id <> v_org) THEN
    RAISE EXCEPTION 'An organization named % exists with another id; refusing', d->>'org_name';
  END IF;
  IF EXISTS (SELECT 1 FROM public.facilities f WHERE f.name = d->>'facility_name' AND f.id <> v_fac) THEN
    RAISE EXCEPTION 'A facility named % exists with another id; refusing', d->>'facility_name';
  END IF;
  IF EXISTS (SELECT 1 FROM public.facilities f WHERE f.id = v_fac AND f.organization_id <> v_org) THEN
    RAISE EXCEPTION 'The demo facility id belongs to another organization; refusing';
  END IF;

  INSERT INTO public.organizations (id, name, timezone, state)
  VALUES (v_org, d->>'org_name', v_tz, 'FL')
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, deleted_at = NULL;
  INSERT INTO public.entities (id, organization_id, name, state)
  VALUES (v_entity, v_org, 'Fidelity Demo Entity LLC', 'FL')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.facilities (id, entity_id, organization_id, name, address_line_1, city, state, zip, total_licensed_beds, timezone)
  VALUES (v_fac, v_entity, v_org, d->>'facility_name', '1 Demo Way', 'Demo City', 'FL', '32000', 40, v_tz)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, timezone = EXCLUDED.timezone, deleted_at = NULL;

  -- Three shifts; the day shift ends at 3:00 PM, the handoff time 03 renders.
  FOR r IN SELECT * FROM (VALUES ('day', 'Day', '07:00', '15:00', 1), ('evening', 'Evening', '15:00', '23:00', 2), ('night', 'Night', '23:00', '07:00', 3)) AS s(k, l, a, b, o) LOOP
    UPDATE public.facility_shift_definitions x SET label = r.l, starts_at_local = r.a::time, ends_at_local = r.b::time, sort_order = r.o, active = true
    WHERE x.facility_id = v_fac AND x.shift_key = r.k AND x.deleted_at IS NULL
      AND (x.starts_at_local, x.ends_at_local, x.label, x.sort_order, x.active) IS DISTINCT FROM (r.a::time, r.b::time, r.l, r.o, true);
    INSERT INTO public.facility_shift_definitions (organization_id, facility_id, shift_key, roster_shift_type, label, starts_at_local, ends_at_local, sort_order, active)
    SELECT v_org, v_fac, r.k, r.k::public.shift_type, r.l, r.a::time, r.b::time, r.o, true
    WHERE NOT EXISTS (SELECT 1 FROM public.facility_shift_definitions x WHERE x.facility_id = v_fac AND x.shift_key = r.k AND x.deleted_at IS NULL);
  END LOOP;

  INSERT INTO public.units (id, facility_id, organization_id, name, sort_order)
  VALUES ((d->>'unit_a')::uuid, v_fac, v_org, 'Hall A', 1), ((d->>'unit_b')::uuid, v_fac, v_org, 'Hall B', 2)
  ON CONFLICT (id) DO NOTHING;

  FOR r IN SELECT * FROM jsonb_to_recordset(d->'residents') AS x(
      id uuid, room text, room_id uuid, bed_id uuid, unit_id uuid, first_name text, last_name text, gender text, status text,
      date_of_birth date, admission_date date, fall_risk_level text, assistive_device text, special_instructions text, sort_order integer) LOOP
    INSERT INTO public.rooms (id, facility_id, organization_id, unit_id, room_number, room_type, sort_order)
    VALUES (r.room_id, v_fac, v_org, r.unit_id, r.room, 'private', r.sort_order) ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.beds (id, room_id, facility_id, organization_id, bed_label, bed_type)
    VALUES (r.bed_id, r.room_id, v_fac, v_org, 'A', 'alf_intermediate') ON CONFLICT (id) DO NOTHING;
    -- Update, never re-insert: the bed guard runs before ON CONFLICT and would
    -- read the resident's own bed as taken.
    UPDATE public.residents SET first_name = r.first_name, last_name = r.last_name, admission_date = r.admission_date,
      fall_risk_level = r.fall_risk_level, assistive_device = r.assistive_device, special_instructions = r.special_instructions
    WHERE id = r.id AND organization_id = v_org AND facility_id = v_fac;
    IF NOT FOUND THEN
      INSERT INTO public.residents (id, facility_id, organization_id, bed_id, first_name, last_name, gender, status, date_of_birth,
        admission_date, fall_risk_level, assistive_device, special_instructions, code_status, ambulatory, elopement_risk, wandering_risk,
        smoking_status, primary_payer, diet_order)
      VALUES (r.id, v_fac, v_org, r.bed_id, r.first_name, r.last_name, r.gender::public.gender, r.status::public.resident_status, r.date_of_birth,
        r.admission_date, r.fall_risk_level, r.assistive_device, r.special_instructions, 'full_code', true, false, false,
        'non_smoker', 'private_pay', 'Regular');
    END IF;
  END LOOP;

  -- People: profile, facility access, staff row, timeclock credential.
  FOR r IN SELECT * FROM jsonb_to_recordset(d->'people') AS x(
      key text, user_id uuid, staff_id uuid, email text, first text, last text, app_role text, staff_role text, employee_number text, pin text) LOOP
    INSERT INTO public.user_profiles (id, organization_id, email, full_name, app_role, is_active)
    VALUES (r.user_id, v_org, r.email, r.first || ' ' || r.last, r.app_role::public.app_role, true)
    ON CONFLICT (id) DO NOTHING;
    IF NOT EXISTS (SELECT 1 FROM public.user_profiles p WHERE p.id = r.user_id AND p.organization_id = v_org) THEN
      RAISE EXCEPTION 'Profile % is not in the demo organization; refusing', r.key;
    END IF;
    INSERT INTO public.user_facility_access (user_id, facility_id, organization_id, is_primary)
    SELECT r.user_id, v_fac, v_org, true
    WHERE NOT EXISTS (SELECT 1 FROM public.user_facility_access a WHERE a.user_id = r.user_id AND a.facility_id = v_fac AND a.revoked_at IS NULL);
    INSERT INTO public.staff (id, user_id, facility_id, organization_id, first_name, last_name, email, staff_role, employment_status, hire_date)
    VALUES (r.staff_id, r.user_id, v_fac, v_org, r.first, r.last, r.email, r.staff_role::public.staff_role, 'active', v_date - 400)
    ON CONFLICT (id) DO UPDATE SET employment_status = 'active', deleted_at = NULL;
    INSERT INTO public.timeclock_credentials (organization_id, staff_id, employee_number, pin_hash, pin_set_by, pin_set_at)
    VALUES (v_org, r.staff_id, r.employee_number, crypt(r.pin, gen_salt('bf', 10)), v_admin, v_now)
    ON CONFLICT (organization_id, staff_id) DO UPDATE SET
      employee_number = EXCLUDED.employee_number,
      pin_hash = CASE WHEN crypt(r.pin, timeclock_credentials.pin_hash) = timeclock_credentials.pin_hash
                      THEN timeclock_credentials.pin_hash ELSE EXCLUDED.pin_hash END,
      failed_attempts = 0, locked_until = NULL;
  END LOOP;

  -- Timeclock on, floor idle 3 minutes, roster roles at their default.
  INSERT INTO public.timeclock_facility_settings (organization_id, facility_id, timeclock_enabled, floor_idle_lock_minutes, floor_roster_roles, updated_by)
  VALUES (v_org, v_fac, true, 3, ARRAY['med_tech', 'facility_admin'], v_admin)
  ON CONFLICT (organization_id, facility_id) DO UPDATE SET timeclock_enabled = true, floor_idle_lock_minutes = 3,
    floor_roster_roles = ARRAY['med_tech', 'facility_admin'];
  -- No tablet left unlocked by an earlier run (the one end the ledger allows).
  UPDATE public.floor_unlocks SET ended_at = v_now, end_reason = 'switch'
  WHERE organization_id = v_org AND facility_id = v_fac AND ended_at IS NULL;
  -- Nothing throttled or locked from an earlier run.
  UPDATE public.timeclock_devices SET throttled_until = NULL, failure_count = 0, failure_window_started_at = NULL
  WHERE organization_id = v_org AND facility_id = v_fac AND (throttled_until IS NOT NULL OR failure_count <> 0);

  -- The chip vocabulary the check form offers, copied from the synthetic
  -- organization's organization-wide rows (read only there).
  INSERT INTO public.observation_vocab (organization_id, facility_id, field_name, value_code, display_label, display_order, is_oof, active)
  SELECT v_org, NULL, v.field_name, v.value_code, v.display_label, v.display_order, v.is_oof, v.active
  FROM public.observation_vocab v
  WHERE v.organization_id = '00000000-0000-0000-0000-000000000001' AND v.facility_id IS NULL AND v.deleted_at IS NULL AND v.active
  ON CONFLICT (organization_id, facility_id, field_name, value_code) DO NOTHING;

  -- The six places 05 renders, as this facility's own location chips (a
  -- facility row outranks the organization-wide ones, and the floor shows six).
  INSERT INTO public.observation_vocab (organization_id, facility_id, field_name, value_code, display_label, display_order, is_oof, active)
  SELECT v_org, v_fac, 'location', l.code, l.label, l.ord, false, true
  FROM (VALUES ('in_bed', 'In bed', 1), ('in_chair', 'In chair', 2), ('bathroom', 'Bathroom', 3),
               ('dining_room', 'Dining room', 4), ('common_area', 'Common area', 5), ('outside', 'Outside', 6)) AS l(code, label, ord)
  ON CONFLICT (organization_id, facility_id, field_name, value_code) DO UPDATE SET display_label = EXCLUDED.display_label, display_order = EXCLUDED.display_order;

  -- Watches: Evelyn (fall risk), Mae (new admission), Frank (restless overnight).
  FOR c IN SELECT * FROM jsonb_array_elements(d->'watches') LOOP
    INSERT INTO public.resident_watch_protocols (id, organization_id, entity_id, facility_id, name, trigger_type, duration_rule, rule_definition_json, approval_required, active, created_by)
    VALUES ((c->>'protocol_id')::uuid, v_org, v_entity, v_fac, c->>'protocol_name', 'manual', c->>'duration_rule',
            jsonb_build_object('interval_minutes', (c->>'interval_minutes')::integer), false, true, v_admin)
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;
    INSERT INTO public.resident_watch_instances (id, organization_id, entity_id, facility_id, resident_id, protocol_id, triggered_by_type, starts_at, ends_at, status, approved_by)
    VALUES ((c->>'instance_id')::uuid, v_org, v_entity, v_fac, (c->>'resident_id')::uuid, (c->>'protocol_id')::uuid, 'manual',
            ((v_date + (c->>'start_offset_days')::integer) + time '07:00') AT TIME ZONE v_tz,
            ((v_date + (c->>'end_offset_days')::integer) + time '18:00') AT TIME ZONE v_tz, 'active', v_admin)
    ON CONFLICT (id) DO UPDATE SET starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, status = 'active', deleted_at = NULL;
  END LOOP;

  -- Checks. Open demo checks from other dates stand down; a check on the
  -- capture date that no longer matches its seeded state (a test charted it)
  -- is soft-deleted and replaced. The owner role is the only one the rounding
  -- guard lets do this.
  UPDATE public.resident_observation_tasks t SET deleted_at = v_now
  WHERE t.organization_id = v_org AND t.facility_id = v_fac AND t.deleted_at IS NULL
    AND t.notes LIKE 'fidelity-demo:%' AND t.service_date <> v_date;
  -- Checks an earlier version of this seed wrote under a key it no longer uses.
  UPDATE public.resident_observation_tasks t SET deleted_at = v_now
  WHERE t.organization_id = v_org AND t.facility_id = v_fac AND t.deleted_at IS NULL AND t.notes LIKE 'fidelity-demo:%'
    AND substr(t.notes, 15) NOT IN (SELECT x->>'key' FROM jsonb_array_elements(d->'checks') x);
  FOR c IN SELECT * FROM jsonb_array_elements(d->'checks') LOOP
    v_due := (v_date + (c->>'due')::time) AT TIME ZONE v_tz;
    SELECT t.id INTO v_task FROM public.resident_observation_tasks t
    WHERE t.facility_id = v_fac AND t.deleted_at IS NULL AND t.notes = 'fidelity-demo:' || (c->>'key') AND t.service_date = v_date
      AND t.due_at = v_due AND t.status::text = c->>'status'
      AND (t.completed_log_id IS NULL) = (c->'log' IS NULL)
      AND (c->'log' IS NULL OR EXISTS (SELECT 1 FROM public.resident_observation_logs l WHERE l.id = t.completed_log_id
             AND l.observed_at = (v_date + (c->'log'->>'at')::time) AT TIME ZONE v_tz))
      AND t.assigned_staff_id IS NOT DISTINCT FROM (d->'staff_ids'->>(c->>'assigned'))::uuid;
    IF FOUND THEN CONTINUE; END IF;
    UPDATE public.resident_observation_tasks t SET deleted_at = v_now
    WHERE t.facility_id = v_fac AND t.deleted_at IS NULL AND t.notes = 'fidelity-demo:' || (c->>'key');
    INSERT INTO public.resident_observation_tasks (organization_id, entity_id, facility_id, resident_id, assigned_staff_id,
      scheduled_for, due_at, grace_ends_at, status, service_date, notes)
    VALUES (v_org, v_entity, v_fac, (c->>'resident_id')::uuid, (d->'staff_ids'->>(c->>'assigned'))::uuid,
      v_due, v_due, v_due + interval '5 minutes',
      CASE WHEN c->'log' IS NULL THEN (c->>'status')::public.resident_observation_task_status ELSE 'upcoming'::public.resident_observation_task_status END,
      v_date, 'fidelity-demo:' || (c->>'key'))
    RETURNING id INTO v_task;
    IF c->'log' IS NOT NULL THEN
      INSERT INTO public.resident_observation_logs (organization_id, entity_id, facility_id, resident_id, task_id, assigned_staff_id, staff_id,
        observed_at, entered_at, quick_status, resident_location, resident_state, note, composed_summary, chip_selections, created_by)
      VALUES (v_org, v_entity, v_fac, (c->>'resident_id')::uuid, v_task, (d->'staff_ids'->>(c->>'assigned'))::uuid,
        (d->'staff_ids'->>(c->'log'->>'by'))::uuid,
        (v_date + (c->'log'->>'at')::time) AT TIME ZONE v_tz, (v_date + (c->'log'->>'at')::time) AT TIME ZONE v_tz + interval '1 minute',
        (c->'log'->>'quick')::public.resident_observation_quick_status, c->'log'->>'location', c->'log'->>'state', c->'log'->>'note',
        initcap(c->'log'->>'quick'), '{}'::jsonb, (d->'user_ids'->>(c->'log'->>'by'))::uuid)
      RETURNING id INTO v_log;
      UPDATE public.resident_observation_tasks SET status = (c->>'status')::public.resident_observation_task_status, completed_log_id = v_log WHERE id = v_task;
    END IF;
    IF c->'escalation' IS NOT NULL THEN
      INSERT INTO public.resident_observation_escalations (organization_id, entity_id, facility_id, resident_id, task_id, escalation_level,
        escalation_type, status, triggered_at, created_by, rung_key)
      VALUES (v_org, v_entity, v_fac, (c->>'resident_id')::uuid, v_task, 1, 'condition_follow_up', 'open',
        (v_date + (c->'escalation'->>'at')::time) AT TIME ZONE v_tz, v_admin, 'tier_1');
    END IF;
  END LOOP;
  -- The rail reads the step from rung_key.
  UPDATE public.resident_observation_escalations SET rung_key = 'tier_1'
  WHERE organization_id = v_org AND facility_id = v_fac AND rung_key IS NULL;
  -- One open follow-up per resident: earlier runs' follow-ups on replaced checks close.
  UPDATE public.resident_observation_escalations e SET status = 'dismissed'
  WHERE e.organization_id = v_org AND e.facility_id = v_fac AND e.status IN ('open', 'in_progress')
    AND NOT EXISTS (SELECT 1 FROM public.resident_observation_tasks t WHERE t.id = e.task_id AND t.deleted_at IS NULL);

  -- The Now screen's Tasks: Ashley's open witness statements (Part 4 reads
  -- incident_followups, task_type witness_statement). Two building incidents
  -- with no resident (so no watch or care-plan trigger fires), statements due
  -- 10:30 and 11:00. A statement a test answered is replaced.
  UPDATE public.incident_followups f SET deleted_at = v_now
  WHERE f.organization_id = v_org AND f.facility_id = v_fac AND f.deleted_at IS NULL AND f.completed_at IS NULL
    AND f.incident_id NOT IN (SELECT (w->>'incident_id')::uuid FROM jsonb_array_elements(d->'witness') w);
  FOR c IN SELECT * FROM jsonb_array_elements(d->'witness') LOOP
    INSERT INTO public.incidents (id, facility_id, organization_id, incident_number, category, severity, status, occurred_at, shift,
      location_description, location_type, unit_id, description, immediate_actions, reported_by, created_by)
    VALUES ((c->>'incident_id')::uuid, v_fac, v_org, c->>'number', 'other', 'level_1', 'open',
      (v_date + (c->>'occurred')::time) AT TIME ZONE v_tz, 'day', c->>'place', 'common_area', (c->>'unit_id')::uuid,
      c->>'what', 'Area checked and made safe.', (d->'user_ids'->>'dana')::uuid, (d->'user_ids'->>'dana')::uuid)
    ON CONFLICT (id) DO NOTHING;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.incident_followups f
      WHERE f.incident_id = (c->>'incident_id')::uuid AND f.deleted_at IS NULL AND f.completed_at IS NULL);
    UPDATE public.incident_followups SET deleted_at = v_now WHERE incident_id = (c->>'incident_id')::uuid AND deleted_at IS NULL;
    INSERT INTO public.incident_followups (incident_id, facility_id, organization_id, task_type, description, due_at, assigned_to)
    VALUES ((c->>'incident_id')::uuid, v_fac, v_org, 'witness_statement', c->>'task',
      (v_date + (c->>'due')::time) AT TIME ZONE v_tz, (d->'user_ids'->>'ashley')::uuid);
  END LOOP;

  -- Reports a test (or a manual check) filed stand down, so the my-shift strip
  -- and the admin views start from the seeded state. Soft delete only; the
  -- care-event guard lets the definer path (this flag) touch other fields.
  PERFORM set_config('haven.care_event_definer', '1', true);
  UPDATE public.care_events SET deleted_at = v_now
  WHERE organization_id = v_org AND facility_id = v_fac AND deleted_at IS NULL;
  UPDATE public.incidents SET deleted_at = v_now
  WHERE organization_id = v_org AND facility_id = v_fac AND deleted_at IS NULL
    AND id NOT IN (SELECT (w->>'incident_id')::uuid FROM jsonb_array_elements(d->'witness') w);

  -- Enrollment codes for the tablets that need one (hash only, as migration 494 stores them).
  FOR c IN SELECT * FROM jsonb_array_elements(d->'enrollment_codes') LOOP
    INSERT INTO public.timeclock_enrollment_codes (organization_id, facility_id, code_hash, created_by, expires_at, device_kind)
    VALUES (v_org, v_fac, c->>'code_hash', v_admin, v_now + interval '15 minutes', c->>'kind');
  END LOOP;
  -- A tablet being replaced is revoked first, so one label is one live token.
  UPDATE public.timeclock_devices SET revoked_at = v_now, revoked_by = v_admin
  WHERE organization_id = v_org AND facility_id = v_fac AND revoked_at IS NULL
    AND label IN (SELECT jsonb_array_elements_text(d->'replace_labels'));

  INSERT INTO demo_seed_report (item, detail)
  SELECT 'residents in census', count(*)::text FROM public.residents WHERE facility_id = v_fac AND deleted_at IS NULL AND status IN ('active', 'hospital_hold', 'loa');
  INSERT INTO demo_seed_report (item, detail)
  SELECT 'checks on ' || v_date::text, count(*)::text FROM public.resident_observation_tasks WHERE facility_id = v_fac AND deleted_at IS NULL AND service_date = v_date;
  INSERT INTO demo_seed_report (item, detail)
  SELECT 'active watches', count(*)::text FROM public.resident_watch_instances WHERE facility_id = v_fac AND deleted_at IS NULL AND status = 'active';
  INSERT INTO demo_seed_report (item, detail)
  SELECT 'open follow-ups', count(*)::text FROM public.resident_observation_escalations WHERE facility_id = v_fac AND deleted_at IS NULL AND status IN ('open', 'in_progress');
  INSERT INTO demo_seed_report (item, detail)
  SELECT 'live tablets', string_agg(label || ':' || id::text || ':' || token_hash, ',') FROM public.timeclock_devices WHERE facility_id = v_fac AND revoked_at IS NULL;
END
$seed$;
COMMIT;
SELECT item, detail FROM demo_seed_report ORDER BY seq;
`;
}

// ---------------------------------------------------------------------------
// SQL, part 2: the two open visits, on the kiosk
// ---------------------------------------------------------------------------
function visitorsSql(doc) {
  return `
SET statement_timeout = '60s';
BEGIN;
DO $seed$
DECLARE
  d jsonb := ${sqlJson(doc)};
  v_org uuid := (d->>'org_id')::uuid;
  v_fac uuid := (d->>'facility_id')::uuid;
  v_kiosk uuid := (d->>'kiosk_device_id')::uuid;
  v_date date := (d->>'date')::date;
  c jsonb;
  v_in timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.timeclock_devices WHERE id = v_kiosk AND organization_id = v_org AND facility_id = v_fac AND device_kind = 'kiosk') THEN
    RAISE EXCEPTION 'The kiosk is not the demo facility''s kiosk; refusing';
  END IF;
  -- Visits from earlier capture dates are signed out at the end of their day.
  UPDATE public.visitor_log_entries SET checked_out_at = greatest(checked_in_at, (checked_in_at AT TIME ZONE '${TZ}')::date + time '20:00' AT TIME ZONE '${TZ}'),
    sign_out_method = 'bulk_end_of_day'
  WHERE organization_id = v_org AND facility_id = v_fac AND checked_out_at IS NULL AND voided_at IS NULL
    AND (checked_in_at AT TIME ZONE '${TZ}')::date <> v_date;
  -- Visits a test opened on the capture date (a visitor, an inspector) are signed
  -- out now, so the leaving list and the Home banner start from the rendered state.
  UPDATE public.visitor_log_entries e SET checked_out_at = greatest(e.checked_in_at, clock_timestamp()), sign_out_method = 'bulk_end_of_day'
  WHERE e.organization_id = v_org AND e.facility_id = v_fac AND e.checked_out_at IS NULL AND e.voided_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d->'visits') v
                    WHERE v->>'name' = e.visitor_name AND e.checked_in_at = (v_date + (v->>'in')::time) AT TIME ZONE '${TZ}');
  FOR c IN SELECT * FROM jsonb_array_elements(d->'visits') LOOP
    v_in := (v_date + (c->>'in')::time) AT TIME ZONE '${TZ}';
    -- An open visit for this person at the rendered time already exists: nothing to do.
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.visitor_log_entries e
      WHERE e.facility_id = v_fac AND e.visitor_name = c->>'name' AND e.checked_in_at = v_in AND e.checked_out_at IS NULL AND e.voided_at IS NULL);
    INSERT INTO public.visitor_log_entries (organization_id, facility_id, visitor_name, visitor_type, purpose, checked_in_at,
      screening_passed, symptoms_reported, kiosk_device_id, kiosk_client_entry_id, visitor_company, visiting_name_text)
    VALUES (v_org, v_fac, c->>'name', c->>'type', c->>'purpose', v_in, true, false, v_kiosk, gen_random_uuid(),
      c->>'company', c->>'visiting');
  END LOOP;
END
$seed$;
COMMIT;
SELECT count(*)::text AS open_visits FROM public.visitor_log_entries
WHERE facility_id = '${IDS.facility}' AND checked_out_at IS NULL AND voided_at IS NULL AND deleted_at IS NULL;
`;
}

// ---------------------------------------------------------------------------
// SQL, part 3: Ashley's and Dana's ledgers back to the rendered punches
// ---------------------------------------------------------------------------
function normalizePunchesSql(doc) {
  return `
SET statement_timeout = '60s';
DROP TABLE IF EXISTS pg_temp.demo_punch_report;
CREATE TEMP TABLE demo_punch_report (removed integer NOT NULL, logs_removed integer NOT NULL);
BEGIN;
DO $seed$
DECLARE
  d jsonb := ${sqlJson(doc)};
  v_org uuid := (d->>'org_id')::uuid;
  v_fac uuid := (d->>'facility_id')::uuid;
  v_staff uuid[] := ARRAY(SELECT jsonb_array_elements_text(d->'staff_ids')::uuid);
  v_keep uuid[] := ARRAY(SELECT jsonb_array_elements_text(d->'keep')::uuid);
  v_n integer;
  v_logs integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.staff s WHERE s.id = ANY (v_staff) AND (s.organization_id <> v_org OR s.facility_id <> v_fac)) THEN
    RAISE EXCEPTION 'A punch owner is not demo staff; refusing';
  END IF;
  SELECT count(*) INTO v_n FROM public.time_punches p
  WHERE p.organization_id = v_org AND p.facility_id = v_fac AND p.staff_id = ANY (v_staff)
    AND p.punched_at >= (d->>'from')::timestamptz AND NOT (p.client_punch_id = ANY (v_keep));
  IF v_n > 0 THEN
    ALTER TABLE public.time_punches DISABLE TRIGGER tr_time_punches_append_only;
    DELETE FROM public.time_punches p
    WHERE p.organization_id = v_org AND p.facility_id = v_fac AND p.staff_id = ANY (v_staff)
      AND p.punched_at >= (d->>'from')::timestamptz AND NOT (p.client_punch_id = ANY (v_keep));
    ALTER TABLE public.time_punches ENABLE TRIGGER tr_time_punches_append_only;
  END IF;
  -- Charted checks a test or capture left behind (logs on checks this seed has
  -- since replaced, or on checks it never wrote) would count in the my-shift
  -- strip's rounds. Same pattern and scope: demo organization and facility,
  -- from yesterday on, rounding evidence guard off inside this transaction only.
  SELECT count(*) INTO v_logs FROM public.resident_observation_logs l
  LEFT JOIN public.resident_observation_tasks t ON t.id = l.task_id
  WHERE l.organization_id = v_org AND l.facility_id = v_fac AND l.observed_at >= (d->>'from')::timestamptz
    AND (t.id IS NULL OR t.deleted_at IS NOT NULL OR t.notes IS NULL OR t.notes NOT LIKE 'fidelity-demo:%' OR t.completed_log_id IS DISTINCT FROM l.id);
  IF v_logs > 0 THEN
    CREATE TEMP TABLE demo_stray_logs ON COMMIT DROP AS
      SELECT l.id FROM public.resident_observation_logs l
      LEFT JOIN public.resident_observation_tasks t ON t.id = l.task_id
      WHERE l.organization_id = v_org AND l.facility_id = v_fac AND l.observed_at >= (d->>'from')::timestamptz
        AND (t.id IS NULL OR t.deleted_at IS NOT NULL OR t.notes IS NULL OR t.notes NOT LIKE 'fidelity-demo:%' OR t.completed_log_id IS DISTINCT FROM l.id);
    ALTER TABLE public.resident_observation_logs DISABLE TRIGGER tr_rounding_logs_immutable;
    DELETE FROM public.resident_observation_integrity_flags WHERE organization_id = v_org AND log_id IN (SELECT id FROM demo_stray_logs);
    UPDATE public.resident_observation_tasks SET completed_log_id = NULL
    WHERE organization_id = v_org AND completed_log_id IN (SELECT id FROM demo_stray_logs);
    DELETE FROM public.resident_observation_logs WHERE organization_id = v_org AND id IN (SELECT id FROM demo_stray_logs);
    ALTER TABLE public.resident_observation_logs ENABLE TRIGGER tr_rounding_logs_immutable;
  END IF;
  INSERT INTO demo_punch_report (removed, logs_removed) VALUES (v_n, v_logs);
END
$seed$;
COMMIT;
SELECT removed, logs_removed FROM demo_punch_report;
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const args = { date: todayEastern(), ashleyOff: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--date") args.date = argv[++i] ?? "";
    else if (argv[i] === "--ashley-off") args.ashleyOff = true;
    else fail(`unknown argument ${argv[i]}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) fail("--date must be YYYY-MM-DD");
  return args;
}

async function ensureAuthUser(admin, person, password) {
  const attributes = {
    email: person.email,
    password,
    email_confirm: true,
    app_metadata: { app_role: person.appRole, organization_id: IDS.org },
    user_metadata: { full_name: `${person.first} ${person.last}` },
  };
  const existing = await admin.auth.admin.getUserById(person.userId);
  if (existing.data?.user) {
    if (existing.data.user.email !== person.email) fail(`auth user ${person.userId} carries another email; refusing`);
    const updated = await admin.auth.admin.updateUserById(person.userId, attributes);
    if (updated.error) fail(`auth update failed for ${person.key}: ${updated.error.message}`);
    return;
  }
  const created = await admin.auth.admin.createUser({ id: person.userId, ...attributes });
  if (created.error) fail(`auth create failed for ${person.key}: ${created.error.message}`);
}

async function rpc(admin, fn, params) {
  const { data, error } = await admin.rpc(fn, params);
  if (error) fail(`${fn} failed: ${error.message}`);
  return data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadStagingEnv();
  assertLinkedToStaging();
  const today = todayEastern();
  if (args.date !== today) log(`WARNING: capture date ${args.date} is not today (${today}); the floor roster needs punches within 16 hours of real now and will be empty.`);
  log(`staging ${STAGING_REF}, capture date ${args.date}${args.ashleyOff ? ", Ashley left off the clock" : ""}`);

  const admin = createClient(env.url, env.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const previous = readSecrets();
  const people = PEOPLE.map((person) => ({
    ...person,
    pin: previous?.people?.[person.key]?.pin ?? sixDigitPin(),
    password: previous?.people?.[person.key]?.password ?? `Fd-${randomBytes(18).toString("base64url")}`,
  }));

  // 1. Auth users, confirmed, no email.
  for (const person of people) await ensureAuthUser(admin, person, person.password);
  log(`auth users ${people.length} (${people.map((p) => p.key).join(", ")})`);

  // 2. Which tablets still resolve with the token on file.
  const heldDevices = previous?.devices ?? {};
  const residents = buildResidents(args.date);
  const by = RESIDENT_BY_KEY(residents);
  const enrollmentCodes = [];
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const pendingCodes = new Map();

  // Probe the live tablets first (read only) so part 1 knows which to replace.
  const liveRows = runLinkedSql(
    `SELECT label, token_hash FROM public.timeclock_devices WHERE facility_id = '${IDS.facility}' AND organization_id = '${IDS.org}' AND revoked_at IS NULL;`,
    "probe-devices",
  );
  const liveHashByLabel = new Map(liveRows.map((row) => [row.label, row.token_hash]));
  const replaceLabels = [];
  for (const spec of DEVICE_SPECS) {
    const held = heldDevices[spec.label];
    const valid = held?.token && liveHashByLabel.get(spec.label) === sha256Hex(held.token);
    if (valid) continue;
    replaceLabels.push(spec.label);
    let code = "";
    for (let i = 0; i < 8; i += 1) code += alphabet[randomInt(alphabet.length)];
    pendingCodes.set(spec.label, code);
    enrollmentCodes.push({ code_hash: sha256Hex(code), kind: spec.kind });
  }

  const staffIds = Object.fromEntries(people.map((p) => [p.key, p.staffId]));
  const userIds = Object.fromEntries(people.map((p) => [p.key, p.userId]));
  const report = runLinkedSql(
    structureSql({
      org_id: IDS.org,
      entity_id: IDS.entity,
      facility_id: IDS.facility,
      org_name: DEMO_ORG_NAME,
      facility_name: DEMO_FACILITY_NAME,
      admin_user_id: userIds.admin,
      date: args.date,
      unit_a: demoUuid("unit:hall-a"),
      unit_b: demoUuid("unit:hall-b"),
      residents,
      people: people.map((p) => ({
        key: p.key, user_id: p.userId, staff_id: p.staffId, email: p.email, first: p.first, last: p.last,
        app_role: p.appRole, staff_role: p.staffRole, employee_number: p.employeeNumber, pin: p.pin,
      })),
      staff_ids: staffIds,
      user_ids: userIds,
      watches: [
        { resident: "evelyn", protocol: "fall-risk", protocol_name: "Fall risk, checks every 2 hours", duration_rule: "7 days", interval_minutes: 120, start_offset_days: -4, end_offset_days: 3 },
        { resident: "mae", protocol: "new-admission", protocol_name: "New, day 3", duration_rule: "14 days", interval_minutes: 240, start_offset_days: -2, end_offset_days: 12 },
        { resident: "frank", protocol: "restless-overnight", protocol_name: "Restless overnight", duration_rule: "3 days", interval_minutes: 240, start_offset_days: -1, end_offset_days: 2 },
      ].map((w) => ({
        ...w,
        resident_id: by.get(w.resident).id,
        protocol_id: demoUuid(`watch-protocol:${w.protocol}`),
        instance_id: demoUuid(`watch-instance:${w.resident}`),
      })),
      checks: buildChecks(residents),
      witness: [
        { slot: 1, occurred: "08:40", due: "10:30", place: "Hall B", what: "Water on the floor by the Hall B pitchers.", task: "Witness statement: water on the floor, Hall B" },
        { slot: 2, occurred: "09:05", due: "11:00", place: "Hall A shower room", what: "Shower room door found propped open.", task: "Witness statement: shower room door" },
      ].map((w) => ({
        ...w,
        incident_id: demoUuid(`incident:${args.date}:${w.slot}`),
        number: `FD-${args.date.replaceAll("-", "")}-${w.slot}`,
        unit_id: w.place.startsWith("Hall B") ? demoUuid("unit:hall-b") : demoUuid("unit:hall-a"),
      })),
      enrollment_codes: enrollmentCodes,
      replace_labels: replaceLabels,
    }),
    "structure",
  );
  for (const row of report) if (row.item !== "live tablets") log(`${row.item.padEnd(28)} ${row.detail}`);

  // 3. Enroll the tablets that need it through the real enrollment function.
  const devices = {};
  for (const spec of DEVICE_SPECS) {
    const code = pendingCodes.get(spec.label);
    if (!code) {
      devices[spec.label] = heldDevices[spec.label];
      continue;
    }
    const enrolled = await rpc(admin, "timeclock_enroll_device", { p_code: code, p_label: spec.label, p_device_kind: spec.kind });
    if (!enrolled?.ok) fail(`timeclock_enroll_device refused ${spec.label}: ${enrolled?.error ?? "no answer"}`);
    devices[spec.label] = { id: enrolled.device_id, kind: spec.kind, token: enrolled.token };
  }
  log(`tablets enrolled now ${pendingCodes.size}, reused ${DEVICE_SPECS.length - pendingCodes.size}`);

  // 4. The two open visits on the kiosk.
  const visits = runLinkedSql(
    visitorsSql({
      org_id: IDS.org,
      facility_id: IDS.facility,
      kiosk_device_id: devices["HL-KIOSK-01"].id,
      date: args.date,
      visits: [
        { name: "Carlos Mendez", type: "vendor_contractor", company: "Coastal Linen Service", purpose: "Linen delivery", in: "09:48", visiting: null },
        { name: "Carol Price", type: "family_friend", company: null, purpose: "Visit", in: "10:12", visiting: "Ruth Simmons" },
      ],
    }),
    "visitors",
  );
  log(`open visits                  ${visits[0]?.open_visits ?? "?"}`);

  // 5. Punches through the kiosk path, as offline captures at the rendered times.
  const kioskToken = devices["HL-KIOSK-01"].token;
  const nowMs = Date.now();
  const yesterday = addDays(args.date, -1);
  const punchPlan = [
    { who: "ashley", type: "in", date: yesterday, at: "06:58" },
    { who: "ashley", type: "out", date: yesterday, at: "19:06" },
    { who: "dana", type: "in", date: yesterday, at: "06:52" },
    { who: "dana", type: "out", date: yesterday, at: "19:02" },
    { who: "dana", type: "in", date: args.date, at: "06:52", fallbackMinutes: 8 },
    ...(args.ashleyOff ? [] : [{ who: "ashley", type: "in", date: args.date, at: "06:58", fallbackMinutes: 2 }]),
  ];
  // Ashley and Dana keep exactly the rendered punches for yesterday and the
  // capture date. Anything else on their ledger in that span (a kiosk capture
  // or test punched them, or --ashley-off follows a run that clocked Ashley in)
  // is removed first, the one place this seed touches an append-only ledger:
  // demo organization, demo facility, these two demo staff, these two days,
  // guard trigger off inside this one transaction only (the staging cleanup
  // pattern of scripts/benefits/staging-smoke-cleanup.sql and the teardown).
  const keep = punchPlan.map((punch) => demoUuid(`punch:${punch.who}:${punch.date}:${punch.type}:${punch.at}`));
  const normalized = runLinkedSql(
    normalizePunchesSql({
      org_id: IDS.org,
      facility_id: IDS.facility,
      staff_ids: [staffIds.ashley, staffIds.dana],
      from: easternInstant(yesterday, "00:00").toISOString(),
      keep,
    }),
    "normalize-punches",
  );
  if (Number(normalized[0]?.removed ?? 0) > 0) log(`punches set back           ${normalized[0].removed} removed from Ashley and Dana`);
  if (Number(normalized[0]?.logs_removed ?? 0) > 0) log(`stray charted checks       ${normalized[0].logs_removed} removed`);
  let fellBack = false;
  for (const punch of punchPlan) {
    const person = people.find((p) => p.key === punch.who);
    let at = easternInstant(punch.date, punch.at);
    const sixteenHours = 16 * 3_600_000;
    if (punch.fallbackMinutes && (at.getTime() > nowMs || nowMs - at.getTime() > sixteenHours - 10 * 60_000)) {
      at = new Date(nowMs - punch.fallbackMinutes * 60_000);
      fellBack = true;
    }
    if (at.getTime() > nowMs) continue; // a punch still in the future cannot be recorded
    const result = await rpc(admin, "timeclock_record_punch", {
      p_device_token: kioskToken,
      p_identifier: person.employeeNumber,
      p_badge_lookup_hmac: null,
      p_pin: person.pin,
      p_punch_type: punch.type,
      p_device_time: at.toISOString(),
      p_client_punch_id: demoUuid(`punch:${person.key}:${punch.date}:${punch.type}:${punch.at}`),
      p_captured_offline: true,
    });
    // invalid_next_type on a re-run means the ledger already moved past this punch.
    if (!result?.ok && result?.error !== "invalid_next_type") fail(`punch ${punch.who} ${punch.type} ${punch.date} refused: ${result?.error}`);
  }
  // Jordan starts every run off the clock (spec 40 item 1 punches him in and out).
  const jordan = people.find((p) => p.key === "jordan");
  const jordanOut = await rpc(admin, "timeclock_record_punch", {
    p_device_token: kioskToken,
    p_identifier: jordan.employeeNumber,
    p_badge_lookup_hmac: null,
    p_pin: jordan.pin,
    p_punch_type: "out",
    p_device_time: new Date().toISOString(),
    p_client_punch_id: crypto.randomUUID(),
    p_captured_offline: false,
  });
  if (!jordanOut?.ok && jordanOut?.error !== "invalid_next_type") fail(`resetting Jordan off the clock was refused: ${jordanOut?.error}`);
  if (fellBack) log("WARNING: real now is outside 6:58 AM to 10:48 PM Eastern on the capture date; today's in punches use real now, so \"on since\" shows the real time.");

  // 6. Secrets for Playwright, then the proof that the roster works.
  writeSecrets({
    note: "COL-694 fidelity demo on Haven HFO Staging. Never commit. Regenerated by scripts/floor/seed-prototype-demo.mjs.",
    supabaseRef: STAGING_REF,
    captureDate: args.date,
    ashleyOff: args.ashleyOff,
    organizationId: IDS.org,
    facilityId: IDS.facility,
    facilityName: DEMO_FACILITY_NAME,
    devices,
    people: Object.fromEntries(
      people.map((p) => [p.key, { userId: p.userId, staffId: p.staffId, email: p.email, password: p.password, employeeNumber: p.employeeNumber, pin: p.pin, name: `${p.first} ${p.last}` }]),
    ),
    residents: Object.fromEntries(residents.filter((r) => !r.key.startsWith("filler-")).map((r) => [r.key, { id: r.id, room: r.room }])),
  });
  log(`secrets written to ${path.relative(REPO_ROOT, DEVICES_FILE)} (gitignored)`);

  // 01-floor-lock: Ashley is "Last on this tablet" on HL-FLOOR-02. Through the real
  // unlock path (floor_verify_unlock, then floor_end_unlock), only when someone
  // else holds the most recent unlock there, so a re-run adds no row.
  if (!args.ashleyOff) {
    const floor02 = devices["HL-FLOOR-02"].token;
    const before = await rpc(admin, "floor_roster", { p_device_token: floor02 });
    const ashley = people.find((p) => p.key === "ashley");
    const latest = [...(before?.roster ?? [])].filter((row) => row.last_on_this_device).sort((a, b) => String(b.last_on_this_device).localeCompare(String(a.last_on_this_device)))[0];
    if (!latest || latest.staff_id !== ashley.staffId) {
      const unlocked = await rpc(admin, "floor_verify_unlock", { p_device_token: floor02, p_staff_id: ashley.staffId, p_employee_number: null, p_pin: ashley.pin });
      if (!unlocked?.ok) fail(`floor_verify_unlock for Ashley on HL-FLOOR-02 refused: ${unlocked?.error}`);
      await rpc(admin, "floor_end_unlock", { p_device_token: floor02, p_unlock_id: unlocked.unlock_id, p_reason: "switch" });
      log("HL-FLOOR-02 last unlock      Ashley (recorded now)");
    }
  }

  const roster = await rpc(admin, "floor_roster", { p_device_token: devices["HL-FLOOR-02"].token });
  if (!roster?.ok) fail(`floor_roster on HL-FLOOR-02 refused: ${roster?.error}`);
  const names = (roster.roster ?? []).map((row) => `${row.display_name} (${row.role_label})`);
  log(`floor_roster HL-FLOOR-02    ${names.join(", ") || "nobody on the clock"}`);
  const expected = args.ashleyOff ? ["Dana R."] : ["Ashley W.", "Dana R."];
  const missing = expected.filter((name) => !(roster.roster ?? []).some((row) => row.display_name === name));
  if (missing.length > 0) fail(`roster is missing ${missing.join(", ")}`);
  log("PASS");
}

// Importable (the Playwright helpers read IDS, PEOPLE and DEVICES_FILE); runs only as a script.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((cause) => {
    console.error(`${PREFIX} FATAL: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exit(1);
  });
}
