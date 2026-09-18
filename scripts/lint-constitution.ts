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

/**
 * Every Smart Rounding surface, and the primitives they compose with.
 *
 * `walk` skips a path that does not exist, silently, so a stale entry here is
 * not an error but every surface missing from the list is a silent loss of
 * coverage. The nine-tab strip's routes are gone from it because the routes are
 * gone: Overview and Escalations folded into the Live board, Plans went with
 * the per resident observation plan, Watches became Monitoring Orders, Safety
 * scores became the Watchlist, and Insights folded into Reports.
 */
const segmentTargets = [
  "src/app/(admin)/admin/rounding/page.tsx",
  "src/app/(admin)/admin/rounding/live",
  "src/app/(admin)/admin/rounding/monitoring-orders",
  "src/app/(admin)/admin/rounding/integrity",
  "src/app/(admin)/admin/rounding/reports",
  "src/app/(admin)/admin/rounding/watchlist",
  "src/app/(admin)/admin/rounding/rounding-hub-nav.tsx",
  "src/app/(caregiver)/caregiver/rounds",
  "src/components/caregiver/CaregiverRoundsEmptyNotice.tsx",
  "src/components/rounding/IntegrityCompliancePanel.tsx",
  "src/components/rounding/IntegrityFlagCard.tsx",
  "src/components/rounding/LiveBoard.tsx",
  "src/components/rounding/LiveBoardCadenceHeader.tsx",
  "src/components/rounding/LiveBoardEscalationActions.tsx",
  "src/components/rounding/LiveBoardSummary.tsx",
  "src/components/rounding/LiveBoardTaskRow.tsx",
  "src/components/rounding/MonitoringOrderAction.tsx",
  "src/components/rounding/MonitoringOrderForm.tsx",
  "src/components/rounding/MonitoringOrdersTable.tsx",
  "src/components/rounding/ObservationCapture.tsx",
  "src/components/rounding/ObservationChipRow.tsx",
  "src/components/rounding/ObservationInsightsPanel.tsx",
  "src/components/rounding/ObservationReportBreakdown.tsx",
  "src/components/rounding/ObservationReportRange.tsx",
  "src/components/rounding/QuickCheckDrawer.tsx",
  "src/components/rounding/ResidentMonitoringOrderBand.tsx",
  "src/components/rounding/RoundingNotices.tsx",
  "src/components/rounding/RoundingOutbox.tsx",
  "src/components/rounding/RoundingTaskCard.tsx",
  "src/components/rounding/WatchlistDispositionForm.tsx",
  "src/components/rounding/WatchlistDispositionLedger.tsx",
  "src/components/rounding/WatchlistFacilityTable.tsx",
  "src/components/rounding/WatchlistPortfolioTable.tsx",
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
  "src/components/ui/textarea.tsx",
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
