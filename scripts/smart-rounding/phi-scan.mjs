#!/usr/bin/env node
/**
 * Spec 25A acceptance item 14, made runnable: no resident PHI in commits, logs,
 * filenames, test fixtures, seed scripts or commit messages.
 *
 * What it scans
 * -------------
 *   1. Every added or changed line on this branch, against origin/main, plus
 *      the uncommitted working tree and every untracked file, because the
 *      orchestrator commits after the specialists finish and a finding that
 *      only appears after the commit is a finding nobody caught.
 *   2. Every filename the branch adds or changes.
 *   3. Every commit message on the branch.
 *   4. The module's own seed scripts and fixtures, in full rather than by diff.
 *
 * What it looks for
 * -----------------
 *   - The real Circle of Life resident names, when they are discoverable on
 *     this machine. `scripts/homewood/data/homewood-residents.csv` is the
 *     gitignored import source for the pilot building; when it is present this
 *     scan reads the names, the dates of birth, the emergency contact names and
 *     the phone numbers out of it and looks for every one of them. That is the
 *     only exact test available, and it is the one that matters.
 *   - A person-shaped token in a filename. The spec itself named a person in a
 *     migration filename (section 9, spec number 404) and the build dropped it;
 *     nothing on this branch should carry it back.
 *   - Name-shaped pairs in the module's seeds and fixtures, where a synthetic
 *     name is required and a real one is the hazard.
 *   - A birth-year date and a phone number shape anywhere in the diff.
 *
 * What it does not do
 * -------------------
 * It never prints a name it found. A scanner that echoes the PHI it detected
 * into a build transcript has copied the PHI into the build transcript. Hits
 * are reported by file, line and category only.
 *
 * Staff role names and facility names are deliberately not name-shaped hits:
 * `facility_admin`, `assistant_administrator`, `resident_aide`, `Homewood
 * Lodge, ALF` and `The Plantation on Summers` are vocabulary this module has to
 * say out loud. They are in the stoplist below.
 *
 *   node scripts/smart-rounding/phi-scan.mjs
 *
 * Exits 0 clean, 1 with findings.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PREFIX = "[phi-scan]";

/** The gitignored import source for the pilot building's residents. */
const RESIDENT_SOURCE = "scripts/homewood/data/homewood-residents.csv";

/** Read in full rather than by diff: a seed or a fixture is where a real name hides. */
const ALWAYS_SCANNED = [
  "scripts/smart-rounding",
  "supabase/migrations/414_col_observation_cadence_2026_09_16.sql",
  "supabase/migrations/415_observation_chip_vocabulary.sql",
  "supabase/migrations/416_resident_monitoring_orders.sql",
  "supabase/migrations/417_observation_escalation_policy.sql",
  "tests/smart-rounding",
];

/**
 * Words that are capitalized in this codebase and are not a person: roles,
 * facility and product names, vendors, jurisdictions, and the English a spec
 * is written in. A name-shaped pair is only reported when neither half is here.
 */
const STOPWORDS = new Set([
  // Product, module and place
  "Haven", "Smart", "Rounding", "Monitoring", "Order", "Orders", "Watchlist", "Cadence",
  "Escalation", "Integrity", "Reports", "Live", "Board", "Settings", "Circle", "Life",
  "Homewood", "Lodge", "Plantation", "Summers", "Oakridge", "Synthetic", "Facility",
  "Florida", "Lafayette", "County", "Eastern", "America", "New", "York", "Demo",
  "Workspace", "Operations", "Communities",
  // Roles and vocabulary
  "Resident", "Aide", "Administrator", "Assistant", "Nurse", "Caregiver", "Manager",
  "Coordinator", "Owner", "Admin", "Staff", "Med", "Tech", "Dietary", "Housekeeper",
  "Maintenance", "Family", "Broker", "Physician", "Hospice", "Home", "Health",
  // Vendors, regulators and standards
  "AHCA", "Medicaid", "Medicare", "Baya", "QuickMAR", "Sunshine", "Humana", "WellCare",
  "Supabase", "Postgres", "PostgREST", "Playwright", "Next", "React", "Tailwind",
  "TypeScript", "Deno", "Netlify", "Sentry", "Chromium", "Desktop", "Chrome", "iPhone",
  // Sentence starts and connectives that get capitalized
  "The", "This", "That", "These", "Those", "There", "Then", "When", "Where", "While",
  "Which", "What", "Who", "Every", "Each", "Any", "All", "One", "Two", "Three", "Four",
  "Five", "Six", "Not", "No", "Nothing", "Never", "Always", "Read", "Run", "Set", "Use",
  "Do", "Does", "Did", "Is", "Are", "Was", "Were", "Be", "Been", "Has", "Have", "Had",
  "It", "Its", "They", "Their", "Them", "Before", "After", "Both", "Either", "Neither",
  "Part", "Parts", "Spec", "Section", "Decision", "Acceptance", "Migration", "Table",
  "Column", "Function", "Trigger", "Policy", "Version", "Window", "Windows", "Shift",
  "Night", "Day", "Morning", "Late", "Mid", "Status", "Reason", "Note", "Notes",
  "Check", "Checks", "Task", "Tasks", "Signal", "Signals", "Band", "Bands", "Needs",
  "Look", "Watch", "Acute", "Care", "Plan", "Plans", "Template", "Templates",
]);

const PHONE_SHAPE = /\b\d{3}-\d{3}-\d{4}\b/;
/** A birth year, not a service date: 1900 through 1959. */
const BIRTH_DATE_SHAPE = /\b19[0-5]\d-\d{2}-\d{2}\b/;
/** A quoted string literal, single or double quoted. */
const QUOTED_LITERAL = /(['"])([^'"\n]{0,120})\1/g;
/** A resident context makes a name-shaped pair a finding rather than prose. */
const RESIDENT_CONTEXT = /(resident|first_name|last_name|preferred_name|patient|dob|date_of_birth|emergency_contact)/i;
/**
 * A name column, which is narrower than a resident context on purpose.
 *
 * A two word Title Case literal is the same shape as a resident's name and as
 * a UI label: `"Critical Safety"` and `"Open Escalations"` on the nurse
 * dashboard read exactly like a person's first and last name to any shape
 * test. What tells them apart is the field the value is going into, so the
 * name literal test fires only next to a column that stores a person's name.
 *
 * The first draft of this comment illustrated the point with a real name out
 * of the pilot import, and the scan caught it on its own next run. That is the
 * behaviour, working.
 */
const NAME_FIELD_CONTEXT = /(first_name|last_name|preferred_name|middle_name|full_name|resident_name|residentName|patient_name|contact_name|legal_name|ordered_by_name)/;

function git(args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
}

function mergeBase() {
  try {
    return git(["merge-base", "HEAD", "origin/main"]).trim();
  } catch {
    console.error(`${PREFIX} cannot resolve a merge base against origin/main. Fetch origin first.`);
    process.exit(2);
  }
}

/**
 * The pilot import, read into the shapes that identify a person.
 *
 * Three tests come out of it, in descending order of certainty:
 *
 *   pairs    a resident's first and last name on the same line. This is the
 *            test that matters and it has almost no false positive: two
 *            specific words from one row of the import next to each other is
 *            not a coincidence.
 *   exact    a date of birth or a phone number copied verbatim.
 *   tokens   one name-like word, reported only when the line also carries a
 *            resident identifier. On its own a surname is far too often an
 *            ordinary word: the import's names include several that appear
 *            legitimately across this repository as place names, vendor names
 *            and the author of a commit, so an ungated single token scan
 *            reports dozens of things that are not PHI and teaches everybody to
 *            ignore it.
 */
/** One CSV record, honouring double quotes and doubled quotes inside them. */
function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else quoted = false;
      } else current += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      cells.push(current);
      current = "";
    } else current += character;
  }
  cells.push(current);
  return cells;
}

function loadKnownResidentIdentifiers() {
  const file = path.join(ROOT, RESIDENT_SOURCE);
  if (!fs.existsSync(file)) return { available: false, pairs: [], exact: [], tokens: [], residents: 0 };
  const lines = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]).map((name) => name.trim());
  const at = (name) => header.indexOf(name);

  const pairs = [];
  const exact = new Set();
  const tokens = new Set();
  for (const line of lines.slice(1)) {
    // Quote aware, and it has to be. A naive split on comma was the first
    // version of this and it was wrong in the way that matters: the import's
    // diagnosis column is quoted and full of commas, so every field to its
    // right shifted and the "emergency contact name" cell arrived holding
    // fragments of a diagnosis. The scan then reported ordinary clinical
    // English as a resident name in five unrelated files.
    const cells = parseCsvLine(line);
    const first = (cells[at("first_name")] ?? "").trim();
    const last = (cells[at("last_name")] ?? "").trim();
    if (first.length >= 3 && last.length >= 3) pairs.push([first.toLowerCase(), last.toLowerCase()]);

    for (const column of ["first_name", "last_name", "preferred_name", "emergency_contact_name"]) {
      for (const part of (cells[at(column)] ?? "").split(/\s+/)) {
        const candidate = part.replace(/["']/g, "").trim().toLowerCase();
        if (candidate.length >= 5) tokens.add(candidate);
      }
    }
    for (const cell of cells) {
      const value = cell.trim();
      if (PHONE_SHAPE.test(value) || BIRTH_DATE_SHAPE.test(value)) exact.add(value);
    }
  }
  return { available: true, pairs, exact: [...exact], tokens: [...tokens], residents: lines.length - 1 };
}

const findings = [];
function report(category, where, note) {
  findings.push({ category, where, note });
}

function wordPattern(token) {
  return new RegExp(`(^|[^a-z0-9])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
}

function scanText(where, text, known, options = {}) {
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const at = options.lineNumbers === false ? where : `${where}:${index + 1}`;
    const lower = line.toLowerCase();

    for (const [first, last] of known.pairs) {
      if (wordPattern(first).test(lower) && wordPattern(last).test(lower)) {
        report("known resident name", at, "the first and last name of one resident in the pilot import appear on this line");
      }
    }

    for (const value of known.exact) {
      if (lower.includes(value.toLowerCase())) {
        report("known resident identifier", at, "a date of birth or phone number copied from the pilot import");
      }
    }

    if (RESIDENT_CONTEXT.test(line)) {
      for (const token of known.tokens) {
        if (wordPattern(token).test(lower)) {
          report("known resident identifier near a resident field", at, `a name from the pilot import sits next to a resident identifier (${token.length} characters, not printed)`);
        }
      }
      if (options.namePairs) {
        // A name is stored as a quoted literal, so that is the only place this
        // looks. An earlier version tested every capitalized pair on the line
        // and reported "Assignment Building" out of a synthetic facility name
        // and two dozen fragments of ordinary prose, which is a check nobody
        // reads. The rule now: a quoted string that is exactly two capitalized
        // words, neither of them module vocabulary, on a line that names a
        // resident field.
        for (const match of NAME_FIELD_CONTEXT.test(line) ? line.matchAll(QUOTED_LITERAL) : []) {
          const value = match[2].trim();
          if (value.length > 60) continue;
          const words = value.split(/\s+/);
          if (words.length !== 2) continue;
          if (words.some((word) => STOPWORDS.has(word))) continue;
          if (!words.every((word) => /^[A-Z][a-z]{2,}$/.test(word))) continue;
          report("name shaped literal", at, "a quoted two word name next to a resident field; confirm it is synthetic");
        }
      }
    }

    if (PHONE_SHAPE.test(line)) report("phone shape", at, "a ten digit phone number shape");
    if (BIRTH_DATE_SHAPE.test(line)) report("birth date shape", at, "a date in 1900 through 1959, which is a resident date of birth rather than a service date");
  });
}

function walk(absolute, relativeBase, out) {
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const nextAbsolute = path.join(absolute, entry.name);
    const nextRelative = `${relativeBase}/${entry.name}`;
    if (entry.isDirectory()) walk(nextAbsolute, nextRelative, out);
    else out.push(nextRelative);
  }
}

function main() {
  const base = mergeBase();
  const known = loadKnownResidentIdentifiers();

  console.log(`${PREFIX} branch diff against ${base.slice(0, 8)}`);
  if (known.available) {
    console.log(`${PREFIX} pilot import loaded from ${RESIDENT_SOURCE}: ${known.residents} residents, ${known.pairs.length} name pairs, ${known.tokens.length} name tokens, ${known.exact.length} exact identifiers (none printed)`);
  } else {
    console.log(`${PREFIX} ${RESIDENT_SOURCE} is not on this machine, so the exact resident name test did not run.`);
    console.log(`${PREFIX} The shape based checks still ran. Say so in the report rather than claiming acceptance 14 is fully proven.`);
  }

  // 1 and 2: the diff and the filenames, committed and uncommitted.
  const addedByFile = new Map();
  for (const diff of [git(["diff", "--unified=0", `${base}..HEAD`]), git(["diff", "--unified=0", "HEAD"])]) {
    let current = "unknown file";
    for (const line of diff.split(/\r?\n/)) {
      if (line.startsWith("+++ ")) {
        current = line.slice(4).replace(/^b\//, "");
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        if (!addedByFile.has(current)) addedByFile.set(current, []);
        addedByFile.get(current).push(line.slice(1));
      }
    }
  }
  for (const [file, added] of addedByFile) {
    scanText(`added lines in ${file}`, added.join("\n"), known, { namePairs: true, lineNumbers: false });
  }
  console.log(`${PREFIX} files with added lines: ${addedByFile.size}`);

  const untracked = git(["ls-files", "--others", "--exclude-standard"]).split(/\r?\n/).filter(Boolean);
  for (const relative of untracked) {
    const absolute = path.join(ROOT, relative);
    if (!fs.existsSync(absolute) || fs.statSync(absolute).isDirectory()) continue;
    if (fs.statSync(absolute).size > 4 * 1024 * 1024) continue;
    scanText(`untracked ${relative}`, fs.readFileSync(absolute, "utf8"), known, { namePairs: true });
  }

  const changedNames = new Set([
    ...git(["diff", "--name-only", `${base}..HEAD`]).split(/\r?\n/),
    ...git(["diff", "--name-only", "HEAD"]).split(/\r?\n/),
    ...untracked,
  ].filter(Boolean));
  for (const relative of changedNames) {
    const stem = path.basename(relative).replace(/\.[^.]+$/, "");
    for (const segment of stem.split(/[^A-Za-z]+/)) {
      if (segment.length < 4) continue;
      const capitalized = segment[0].toUpperCase() + segment.slice(1).toLowerCase();
      if (STOPWORDS.has(capitalized)) continue;
      if (known.tokens.includes(segment.toLowerCase())) {
        report("known resident identifier in a filename", relative, "a filename segment matches a name from the pilot import");
      }
    }
  }
  console.log(`${PREFIX} filenames checked: ${changedNames.size}`);

  // 3: commit messages.
  const messages = git(["log", "--format=%H%n%B", `${base}..HEAD`]);
  scanText("commit messages", messages, known, { namePairs: true, lineNumbers: false });

  // 4: the module's seeds and fixtures, in full.
  let fullScanned = 0;
  for (const entry of ALWAYS_SCANNED) {
    const absolute = path.join(ROOT, entry);
    if (!fs.existsSync(absolute)) continue;
    const files = [];
    if (fs.statSync(absolute).isDirectory()) walk(absolute, entry, files);
    else files.push(entry);
    for (const relative of files) {
      scanText(relative, fs.readFileSync(path.join(ROOT, relative), "utf8"), known, { namePairs: true });
      fullScanned += 1;
    }
  }
  console.log(`${PREFIX} seeds and fixtures read in full: ${fullScanned} files`);

  if (findings.length === 0) {
    console.log(`${PREFIX} no findings`);
    console.log(`${PREFIX} PASS`);
    return;
  }

  console.log("");
  console.log(`${PREFIX} ${findings.length} finding(s):`);
  const width = Math.max(...findings.map((finding) => finding.where.length));
  for (const finding of findings) {
    console.log(`${PREFIX} ${finding.where.padEnd(width)}  ${finding.category}: ${finding.note}`);
  }
  console.error(`${PREFIX} FAIL`);
  process.exit(1);
}

main();
