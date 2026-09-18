#!/usr/bin/env node
/**
 * The acceptance item 19 scanner for spec 25A, defined by orchestrator
 * decision D16 before anyone could tune it green.
 *
 * Acceptance 19 says no literal observation time, grace value, escalation
 * offset, recipient, channel or shift boundary exists in any TypeScript file in
 * this module. "No literal 15, 30, 60, 90 across src/" is not a runnable check:
 * those integers sit in Tailwind classes, timeouts, slices and HTTP codes in
 * thousands of lines. So this scanner is narrow on purpose and its narrowness
 * is declared rather than discovered:
 *
 *   1. It scans an explicit path list, below. Nothing outside that list is
 *      examined and nothing inside it is skippable.
 *   2. There is no per-line suppression mechanism. No magic comment turns a
 *      finding off. A finding is either fixed or recorded in the build notes as
 *      a deliberate exception with a reason.
 *   3. Time-of-day literals are flagged anywhere in scope, including comments.
 *      A comment that names 10:00 is a second copy of the cadence, and the
 *      whole point of the module is that there is exactly one.
 *   4. The offsets and grace values (15, 30, 60, 90) are flagged only where
 *      they sit next to a minute, hour, grace, offset, window, escalation or
 *      shift identifier, so `graceMinutes = 60` is caught and `slice(0, 60)`
 *      is not.
 *   5. 'day', 'night' and 'evening' string literals are flagged outside a type
 *      declaration. The shift_type enum keeps `evening` for other modules; this
 *      module never writes or renders it, and a shift key this module chose is
 *      a shift model it holds in code rather than in rows.
 *
 * Exemptions are by file class, never by line: tests, fixtures and
 * supabase/migrations/ (which is where the seed values legitimately live). Every
 * exemption applied is listed in the output.
 *
 *   node scripts/smart-rounding/config-literals.mjs
 *
 * Exits 0 clean, 1 with findings, 2 when the scope list names a path that is
 * gone -- a scanner whose path list has rotted silently covers nothing, which
 * is the lint-constitution segmentTargets trap recorded in the build notes.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PREFIX = "[config-literals]";

/**
 * The scope. Directories are walked; files are read as named. Every entry must
 * exist or the run fails, because a path list that silently skips what moved is
 * worse than no scanner.
 */
const SCOPE = [
  "src/app/(admin)/admin/rounding",
  "src/app/(caregiver)/caregiver/rounds",
  "src/app/api/rounding",
  "src/app/api/admin/rounding",
  "src/components/rounding",
  "src/lib/rounding",
  "src/hooks/useLiveBoardData.ts",
  "src/hooks/useObservationCadenceSettings.ts",
  "src/hooks/useRoundingOfflineSync.ts",
  "src/components/admin/facilities/tabs/ObservationCadenceTab.tsx",
  "supabase/functions/observation-task-generator",
  "supabase/functions/observation-escalation-engine",
  "supabase/functions/watchlist-signal-engine",
  "supabase/functions/cadence-version-activator",
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/** File classes exempted by decision D16, with the reason each one carries. */
const EXEMPTIONS = [
  { name: "test files", reason: "a test asserts against a value, so it has to name one", match: (rel) => /\.test\.tsx?$/.test(rel) },
  { name: "fixtures", reason: "a fixture is the data under test, not configuration read at runtime", match: (rel) => /(^|\/)(fixtures?|__fixtures__)\//.test(rel) || /\.fixture\.tsx?$/.test(rel) },
  { name: "migration SQL", reason: "the seeded defaults live in migration seed data by design (decision D1)", match: (rel) => rel.startsWith("supabase/migrations/") },
];

/** Time of day, 0:00 through 23:59. */
const TIME_OF_DAY = /\b(0?[0-9]|1[0-9]|2[0-3]):[0-5][0-9]\b/g;
/** The offsets and grace values acceptance 19 names. */
const POLICY_NUMBER = /\b(15|30|60|90)\b/g;
/** An identifier that makes a bare number a policy value rather than arithmetic. */
const POLICY_IDENTIFIER = /(minute|hour|grace|offset|window|escalation|shift)/i;
/**
 * A Tailwind utility suffix, which is a number in a class name and never a
 * policy value: `hover:bg-primary/90` on a line that also carries
 * `focus-visible:ring-offset-0` reads as "90 next to an offset identifier".
 *
 * This is the same class of false positive as D16's own `slice(0, 60)` example
 * and is excluded for the same reason, structurally rather than per line. It
 * cannot hide a real value: nobody writes a grace value as a class suffix.
 */
const TAILWIND_SUFFIX = /[/-]$/;
/** Shift and daypart words this module must not hold in code. */
const DAYPART_LITERAL = /(['"])(day|night|evening)\1/g;

/**
 * Channel names are deliberately literal in the escalation engine: the code
 * that sends an SMS has to name SMS. Which channels a rung uses is data; how a
 * channel is delivered is code. Recorded in the build notes section 6. This
 * scanner never looked for channel names, so there is nothing to exempt -- the
 * note is here so the next reader does not add the check and then tune it.
 */

function walk(absolute, relativeBase, out) {
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const nextAbsolute = path.join(absolute, entry.name);
    const nextRelative = `${relativeBase}/${entry.name}`;
    if (entry.isDirectory()) {
      walk(nextAbsolute, nextRelative, out);
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(nextRelative);
    }
  }
}

function collectFiles() {
  const files = [];
  const missing = [];
  for (const entry of SCOPE) {
    const absolute = path.join(ROOT, entry);
    if (!fs.existsSync(absolute)) {
      missing.push(entry);
      continue;
    }
    const stat = fs.statSync(absolute);
    if (stat.isDirectory()) walk(absolute, entry, files);
    else files.push(entry);
  }
  return { files, missing };
}

/**
 * A line, cut into statement sized pieces. `;` separates statements and `,` at
 * argument depth does not, so a segment is the smallest span in which a
 * neighbouring identifier genuinely qualifies a number.
 */
function segmentsOf(line) {
  const pieces = [];
  let start = 0;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === ";") {
      pieces.push({ text: line.slice(start, index), offset: start });
      start = index + 1;
    }
  }
  pieces.push({ text: line.slice(start), offset: start });
  return pieces;
}

/**
 * True when the line sits inside, or is, a type declaration. `'day' | 'night'`
 * in a union is the module reading the database's enum, which is the one place
 * those words belong.
 */
function typeDeclarationTracker() {
  let depth = 0;
  let pendingUnion = false;
  return (line) => {
    const trimmed = line.trim();
    const opensDeclaration = /^(export\s+)?(declare\s+)?(type|interface)\b/.test(trimmed);
    const inside = depth > 0 || pendingUnion || opensDeclaration;

    if (opensDeclaration || depth > 0 || pendingUnion) {
      for (const character of line) {
        if (character === "{" || character === "(" || character === "[") depth += 1;
        else if (character === "}" || character === ")" || character === "]") depth = Math.max(0, depth - 1);
      }
      // A multi-line union carries on while the line ends on a `|` or the next
      // line starts with one; `;` or a bare word ends it.
      if (opensDeclaration) pendingUnion = !trimmed.endsWith(";");
      else if (pendingUnion && trimmed.endsWith(";")) pendingUnion = false;
    }
    return inside;
  };
}

function scan(relative) {
  const lines = fs.readFileSync(path.join(ROOT, relative), "utf8").split(/\r?\n/);
  const findings = [];
  const inTypeDeclaration = typeDeclarationTracker();

  lines.forEach((line, index) => {
    const isTypeLine = inTypeDeclaration(line);
    const lineNumber = index + 1;

    for (const match of line.matchAll(TIME_OF_DAY)) {
      findings.push({ file: relative, line: lineNumber, kind: "time-of-day", found: match[0], text: line.trim() });
    }

    for (const segment of segmentsOf(line)) {
      if (!POLICY_IDENTIFIER.test(segment.text)) continue;
      for (const match of segment.text.matchAll(POLICY_NUMBER)) {
        if (TAILWIND_SUFFIX.test(segment.text.slice(0, match.index))) continue;
        findings.push({ file: relative, line: lineNumber, kind: "policy-number", found: match[0], text: segment.text.trim() });
      }
    }

    if (!isTypeLine) {
      for (const match of line.matchAll(DAYPART_LITERAL)) {
        findings.push({ file: relative, line: lineNumber, kind: "daypart-literal", found: match[0], text: line.trim() });
      }
    }
  });

  return findings;
}

function main() {
  const { files, missing } = collectFiles();
  if (missing.length > 0) {
    console.error(`${PREFIX} the scope list names ${missing.length} path(s) that no longer exist:`);
    for (const entry of missing) console.error(`${PREFIX}   ${entry}`);
    console.error(`${PREFIX} a scanner whose path list has rotted covers nothing. Update SCOPE.`);
    process.exit(2);
  }

  const scanned = [];
  const exempted = [];
  for (const relative of files) {
    const exemption = EXEMPTIONS.find((candidate) => candidate.match(relative));
    if (exemption) exempted.push({ file: relative, exemption });
    else scanned.push(relative);
  }

  const findings = scanned.flatMap(scan);

  console.log(`${PREFIX} scope: ${SCOPE.length} path entries, ${files.length} TypeScript files`);
  console.log(`${PREFIX} scanned: ${scanned.length} files`);
  console.log(`${PREFIX} exempted: ${exempted.length} files, by file class, never by line`);
  for (const rule of EXEMPTIONS) {
    const hits = exempted.filter((entry) => entry.exemption.name === rule.name);
    console.log(`${PREFIX}   ${rule.name} (${hits.length}): ${rule.reason}`);
    for (const hit of hits) console.log(`${PREFIX}     ${hit.file}`);
  }

  if (findings.length === 0) {
    console.log(`${PREFIX} no findings`);
    console.log(`${PREFIX} PASS`);
    return;
  }

  console.log("");
  console.log(`${PREFIX} ${findings.length} finding(s):`);
  const width = Math.max(...findings.map((finding) => `${finding.file}:${finding.line}`.length));
  for (const finding of findings) {
    const where = `${finding.file}:${finding.line}`.padEnd(width);
    console.log(`${PREFIX} ${where}  ${finding.kind.padEnd(15)} ${JSON.stringify(finding.found).padEnd(10)} ${finding.text.slice(0, 120)}`);
  }
  console.log("");
  console.log(`${PREFIX} FAIL -- fix each finding or record it in the build notes as a deliberate exception with a reason. There is no suppression comment.`);
  process.exit(1);
}

main();
