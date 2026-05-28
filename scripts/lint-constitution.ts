import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type Finding = {
  file: string;
  line: number;
  rule: string;
  message: string;
  text: string;
};

const root = process.cwd();
const scope = process.env.CONSTITUTION_LINT_SCOPE ?? "smart-rounding";

const segmentTargets = [
  "src/app/(admin)/admin/rounding/plans",
  "src/app/(admin)/admin/rounding/watches",
  "src/app/(admin)/admin/rounding/escalations",
  "src/app/(admin)/admin/rounding/integrity",
  "src/app/(admin)/admin/rounding/reports",
  "src/app/(admin)/admin/rounding/safety",
  "src/app/(admin)/admin/rounding/insights",
  "src/app/(admin)/admin/rounding/rounding-hub-nav.tsx",
  "src/components/rounding/ObservationPlanEditor.tsx",
  "src/components/rounding/SafetyScoreBadge.tsx",
  "src/components/ui/combobox.tsx",
  "src/components/ui/data-fetch-wrapper.tsx",
  "src/components/ui/date-picker.tsx",
  "src/components/ui/date-time-picker.tsx",
  "src/components/ui/entity-combobox.tsx",
  "src/components/ui/filter-pill.tsx",
  "src/components/ui/form-label.tsx",
  "src/components/ui/metric-card.tsx",
  "src/components/ui/select.tsx",
  "src/components/ui/sortable-table-header.tsx",
  "src/components/ui/status-pill.tsx",
].map((target) => path.join(root, target));

const ignoredSegments = [
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}.next${path.sep}`,
  `${path.sep}.turbo${path.sep}`,
  `${path.sep}dist${path.sep}`,
  `${path.sep}coverage${path.sep}`,
  `${path.sep}src${path.sep}components${path.sep}primitives${path.sep}_legacy${path.sep}`,
];

function isPrimitivePath(file: string) {
  const normalized = file.split(path.sep).join("/");
  return normalized.includes("/src/components/ui/") || normalized.includes("/src/components/primitives/");
}

function shouldSkip(file: string) {
  return ignoredSegments.some((segment) => file.includes(segment));
}

function walk(target: string): string[] {
  if (shouldSkip(target)) return [];
  const stats = statSync(target, { throwIfNoEntry: false });
  if (!stats) return [];
  if (stats.isFile()) {
    return /\.(tsx?|jsx?)$/.test(target) ? [target] : [];
  }
  if (!stats.isDirectory()) return [];
  return readdirSync(target).flatMap((entry) => walk(path.join(target, entry)));
}

const targets = scope === "all" ? [path.join(root, "src")] : segmentTargets;
const files = Array.from(new Set(targets.flatMap(walk))).sort();
const findings: Finding[] = [];

function addFinding(file: string, line: number, rule: string, message: string, text: string) {
  findings.push({
    file: path.relative(root, file),
    line,
    rule,
    message,
    text: text.trim(),
  });
}

const forbiddenCopy = [
  "source returns rows",
  "fetch failed",
  "query error",
  "No rows returned",
];

for (const file of files) {
  const content = readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const primitiveFile = isPrimitivePath(file);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    if (!primitiveFile && /\b(?:text-uppercase|uppercase|tracking-widest)\b/.test(line)) {
      addFinding(
        file,
        lineNumber,
        "no-static-case-treatment",
        "Use sentence-case text and Quiet Operator label primitives instead of static case/tracking classes.",
        line,
      );
    }

    if (!primitiveFile && /<select\b/.test(line)) {
      addFinding(file, lineNumber, "no-native-select", "Use the shared Select primitive instead of native select.", line);
    }

    if (!primitiveFile && /<input\b[^>]*type=["'](?:date|datetime-local)["']/.test(line)) {
      addFinding(
        file,
        lineNumber,
        "no-native-date-input",
        "Use DatePicker or DateTimePicker primitives instead of native date inputs.",
        line,
      );
    }

    if (/\berror\.message\b/.test(line) && /\.(tsx|jsx)$/.test(file)) {
      addFinding(
        file,
        lineNumber,
        "no-raw-error-copy",
        "Do not render raw data-layer error messages in operator-facing UI.",
        line,
      );
    }

    for (const copy of forbiddenCopy) {
      if (line.includes(copy)) {
        addFinding(
          file,
          lineNumber,
          "operator-vocabulary",
          `Replace data-layer wording "${copy}" with operator vocabulary.`,
          line,
        );
      }
    }

    if (
      /(?:className|style)\s*=/.test(line) &&
      /#[0-9a-fA-F]{3,8}/.test(line) &&
      /\b(?:red|amber|green|destructive|warning|success|alert)\b/i.test(line)
    ) {
      addFinding(
        file,
        lineNumber,
        "value-derived-rendering",
        "Semantic red, amber, and green treatments must be value-derived through primitives, not static hex styling.",
        line,
      );
    }
  });
}

if (findings.length > 0) {
  console.error(`Constitution lint failed (${findings.length} finding${findings.length === 1 ? "" : "s"}):`);
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`);
    console.error(`  ${finding.text}`);
  }
  process.exit(1);
}

console.log(`Constitution lint passed for ${scope} scope (${files.length} files).`);
