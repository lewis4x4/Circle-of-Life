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
 * Every required target must exist. Deleting or moving a surface requires an
 * explicit scope update rather than silently removing lint coverage.
 * The nine-tab strip's routes are gone from it because the routes are
 * gone: Overview and Escalations folded into the Live board, Plans went with
 * the per resident observation plan, Watches became Monitoring Orders, Safety
 * scores became the Watchlist, and Insights folded into Reports. The old Live
 * URL is a server redirect to the hub root now (COL-707), so it has no source.
 *
 * The cadence settings surface is listed here as well, even though it lives in
 * facility administration rather than in the rounding strip. It is part of the
 * same module and it is the one surface where an unlinted native control would
 * be worst: it edits the schedule every other surface reads.
 */
const segmentTargets = [
  "src/app/(admin)/admin/rounding/page.tsx",
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
  "src/components/rounding/CadenceCurrentSummary.tsx",
  "src/components/rounding/CadenceEditorSection.tsx",
  "src/components/rounding/CadenceLadderList.tsx",
  "src/components/rounding/CadencePreviewPanel.tsx",
  "src/components/rounding/CadenceRungEditor.tsx",
  "src/components/rounding/CadenceSimulationSummary.tsx",
  "src/components/rounding/CadenceVersionHistory.tsx",
  "src/components/rounding/CadenceWindowEditor.tsx",
  "src/components/rounding/CadenceWindowStrip.tsx",
  "src/components/admin/facilities/tabs/ObservationCadenceTab.tsx",
  "src/hooks/useObservationCadenceSettings.ts",
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
const missingTargets = targets.filter((target) => !statSync(target, { throwIfNoEntry: false }));
if (missingTargets.length > 0) {
  console.error(`Constitution lint missing required targets:\n${missingTargets.map((target) => path.relative(root, target)).join("\n")}`);
  process.exit(1);
}
const files = Array.from(new Set(targets.flatMap(walk))).sort();
if (files.length === 0) {
  console.error(`Constitution lint has no files in required ${scope} scope.`);
  process.exit(1);
}
const findings: Finding[] = [];

/* Rules below run against the scoped file list. `no-undefined-color-scale`
   deliberately does not — a utility naming a shade that tailwind.config.ts
   never declares emits no CSS at all, so the control renders invisible
   (COL-410). That has to be caught wherever it lands, not only inside the
   current segment. */
const scaleFiles = Array.from(new Set(walk(path.join(root, "src")))).sort();

/* Colours declared as DEFAULT + foreground only. `bg-primary-600` and friends
   look plausible and produce nothing. Use the semantic token with an alpha
   step instead: bg-primary, bg-primary/10, border-primary/20, text-primary. */
const scaleLessColors = ["primary", "secondary", "muted", "accent", "destructive"];
const undefinedScale = new RegExp(
  `\\b(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|from|to|via|decoration|outline|divide|shadow|accent)-(?:${scaleLessColors.join("|")})-[0-9]{2,3}\\b`,
);

for (const file of scaleFiles) {
  const content = readFileSync(file, "utf8");
  content.split(/\r?\n/).forEach((line, index) => {
    const match = undefinedScale.exec(line);
    if (!match) return;
    addFinding(
      file,
      index + 1,
      "no-undefined-color-scale",
      `"${match[0]}" names a shade tailwind.config.ts does not declare, so it emits no CSS and the element renders unstyled. Use the semantic token with an alpha step (bg-primary, bg-primary/10, border-primary/20).`,
      line,
    );
  });
}

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
