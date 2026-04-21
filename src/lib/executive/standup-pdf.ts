import {
  type StandupMetricRow,
  type StandupSnapshotDetail,
} from "@/lib/executive/standup";
import { buildStandupPacketDocument } from "@/lib/executive/standup-packet";

function escapeHtml(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrencyFromCents(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value / 100);
}

function formatMetricDisplay(metric: StandupMetricRow | undefined): string {
  if (!metric) return "—";
  if (metric.valueText?.trim()) return metric.valueText.trim();
  if (metric.valueNumeric == null) return "—";
  if (metric.valueType === "currency") return formatCurrencyFromCents(metric.valueNumeric);
  if (metric.valueType === "hours") return `${metric.valueNumeric.toFixed(2)} hrs`;
  if (metric.valueType === "percent") return `${metric.valueNumeric.toFixed(1)}%`;
  return `${metric.valueNumeric}`;
}

function formatDateTimeDisplay(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatWeekLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function toneForConfidence(band: string): "ok" | "warn" | "risk" {
  if (band === "high") return "ok";
  if (band === "medium") return "warn";
  return "risk";
}

function toneForPressure(score: number, max: number): "ok" | "warn" | "risk" {
  if (max <= 0) return "ok";
  const ratio = score / max;
  if (ratio >= 0.66) return "risk";
  if (ratio >= 0.33) return "warn";
  return "ok";
}

function deltaChip(delta: string | null | undefined): string {
  if (!delta || delta === "—") return `<span class="chip flat">— flat</span>`;
  if (/no change/i.test(delta)) return `<span class="chip flat">— flat</span>`;
  if (delta.startsWith("+")) return `<span class="chip up">▲ ${escapeHtml(delta.slice(1))}</span>`;
  if (delta.startsWith("-")) return `<span class="chip down">▼ ${escapeHtml(delta.slice(1))}</span>`;
  return `<span class="chip flat">${escapeHtml(delta)}</span>`;
}

function confidencePill(band: string): string {
  const tone = toneForConfidence(band);
  return `<span class="pill pill-${tone}"><span class="dot"></span>${escapeHtml(band)}</span>`;
}

function sourceChip(source: string): string {
  return `<span class="src src-${escapeHtml(source)}">${escapeHtml(source)}</span>`;
}

export function buildStandupBoardPrintHtml(
  detail: StandupSnapshotDetail,
  previous: StandupSnapshotDetail | null,
): string {
  const packet = buildStandupPacketDocument(detail, previous);
  const facilities = detail.facilities.filter((facility) => facility.facilityId != null);
  const totals = detail.facilities.find((facility) => facility.facilityId == null) ?? null;

  const weekLabel = formatWeekLabel(packet.weekOf);
  const generatedAtDisplay = formatDateTimeDisplay(detail.snapshot.generatedAt);
  const publishedAtDisplay = detail.snapshot.publishedAt
    ? formatDateTimeDisplay(detail.snapshot.publishedAt)
    : "Not yet published";

  const confidenceTone = toneForConfidence(packet.confidenceBand);
  const completenessPct = Math.round(packet.completenessPct);
  const completenessTone = completenessPct >= 85 ? "ok" : completenessPct >= 55 ? "warn" : "risk";
  const statusTone =
    packet.status === "published" ? "ok" : packet.status === "draft" ? "warn" : "neutral";

  // -------- KPI cards (summary + 2 extras) --------
  const extras: typeof packet.summaryCards = [];
  const overtimeMetric = totals?.metrics.overtime_hours;
  if (overtimeMetric) {
    extras.push({
      key: "overtime_hours",
      label: overtimeMetric.label,
      value: formatMetricDisplay(overtimeMetric),
      delta: "—",
      confidenceBand: overtimeMetric.confidenceBand,
    });
  }
  const uncollected = totals?.metrics.uncollected_ar_total_cents;
  if (uncollected) {
    extras.push({
      key: "uncollected_ar",
      label: uncollected.label,
      value: formatMetricDisplay(uncollected),
      delta: "—",
      confidenceBand: uncollected.confidenceBand,
    });
  }
  const kpis = [...packet.summaryCards, ...extras];
  const kpiGrid = kpis
    .map(
      (card) => `
        <div class="kpi">
          <div class="kpi-label">${escapeHtml(card.label)}</div>
          <div class="kpi-value figure">${escapeHtml(card.value)}</div>
          <div class="kpi-foot">
            ${deltaChip(card.delta)}
            ${confidencePill(card.confidenceBand)}
          </div>
        </div>
      `,
    )
    .join("");

  // -------- cover stat strip (4 highest-signal numbers) --------
  const coverStatPool = [
    { label: "Facilities", value: String(facilities.length || "—") },
    ...packet.summaryCards.map((card) => ({ label: card.label, value: card.value })),
  ];
  const coverStats = coverStatPool.slice(0, 4);

  // -------- pressure leaderboard --------
  const rankedFacilities = facilities.slice().sort((a, b) => b.pressureScore - a.pressureScore);
  const maxPressure = Math.max(1, ...rankedFacilities.map((f) => f.pressureScore));
  const pressureRows = rankedFacilities
    .map((facility, index) => {
      const pct = Math.round((facility.pressureScore / maxPressure) * 100);
      const tone = toneForPressure(facility.pressureScore, maxPressure);
      return `
        <div class="rank-row">
          <div class="rank-index figure">${index + 1}</div>
          <div class="rank-body">
            <div class="rank-head">
              <div class="rank-name">${escapeHtml(facility.facilityName)}</div>
              <div class="rank-score figure">Pressure <b>${facility.pressureScore}</b></div>
            </div>
            <div class="rank-bar"><span class="rank-fill rank-fill-${tone}" style="width: ${Math.max(pct, 4)}%"></span></div>
            <div class="rank-concern">${escapeHtml(facility.topConcern)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  // -------- Facility scorecards --------
  const facilityScorecards = packet.narrative.facilityActions
    .slice(0, 6)
    .map((action) => {
      const pct = Math.round((action.pressureScore / maxPressure) * 100);
      const tone = toneForPressure(action.pressureScore, maxPressure);
      const whyRed =
        action.whyRed.length > 0
          ? action.whyRed
          : ["No active red flags beyond the summary concern."];
      const flags =
        action.varianceFlags.length > 0
          ? action.varianceFlags
          : ["No material week-over-week delta against the prior published packet."];
      return `
        <article class="facility-card">
          <div class="facility-card-head">
            <div>
              <div class="eyebrow">Facility</div>
              <h2>${escapeHtml(action.facilityName)}</h2>
              <div class="meta">${escapeHtml(action.topConcern)}</div>
            </div>
            <div class="pressure-badge pressure-badge-${tone}">
              <div class="pressure-badge-label">Pressure</div>
              <div class="pressure-badge-value figure">${action.pressureScore}</div>
            </div>
          </div>
          <div class="rank-bar"><span class="rank-fill rank-fill-${tone}" style="width: ${Math.max(pct, 4)}%"></span></div>
          <div class="facility-card-body">
            <div class="facility-block">
              <div class="block-eyebrow">Why now</div>
              <ul>${whyRed.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </div>
            <div class="facility-block">
              <div class="block-eyebrow">Variance flags</div>
              <ul>${flags.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </div>
            <div class="facility-block">
              <div class="block-eyebrow">Interventions</div>
              <ul>${action.interventions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  // -------- Operating detail (refined tables) --------
  const sectionBlocks = packet.sections
    .map(
      (section) => `
        <section class="op-section">
          <div class="op-section-head">
            <div class="op-section-eyebrow">${escapeHtml(section.sectionLabel)}</div>
            <h3>${escapeHtml(section.sectionLabel)}</h3>
          </div>
          <table class="op-table">
            <thead>
              <tr>
                <th class="col-metric">Metric</th>
                <th class="col-num">Previous</th>
                <th class="col-num">Current</th>
                <th class="col-num">Delta</th>
                <th class="col-tag">Source</th>
                <th class="col-tag">Confidence</th>
              </tr>
            </thead>
            <tbody>
              ${section.metrics
                .map(
                  (metric) => `
                    <tr>
                      <td class="col-metric">
                        <div class="metric-label">${escapeHtml(metric.label)}</div>
                        <div class="metric-desc">${escapeHtml(metric.description)}</div>
                      </td>
                      <td class="col-num figure">${escapeHtml(metric.fromValue)}</td>
                      <td class="col-num figure primary">${escapeHtml(metric.toValue)}</td>
                      <td class="col-num">${deltaChip(metric.delta)}</td>
                      <td class="col-tag">${sourceChip(metric.sourceMode)}</td>
                      <td class="col-tag">${confidencePill(metric.confidenceBand)}</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </section>
      `,
    )
    .join("");

  // -------- Appendix (facility-by-facility) --------
  const appendixRows = packet.appendixSections
    .map(
      (section) => `
        <section class="op-section">
          <div class="op-section-head">
            <div class="op-section-eyebrow">Workbook detail</div>
            <h3>${escapeHtml(section.sectionLabel)}</h3>
          </div>
          <table class="op-table op-table-wide">
            <thead>
              <tr>
                <th class="col-metric">Metric</th>
                ${facilities.map((f) => `<th>${escapeHtml(f.facilityName)}</th>`).join("")}
                ${totals ? `<th class="col-total">Portfolio</th>` : ""}
              </tr>
            </thead>
            <tbody>
              ${section.metrics
                .map((metric) => {
                  const sample =
                    facilities.find((f) => f.metrics[metric.key])?.metrics[metric.key] ??
                    totals?.metrics[metric.key];
                  if (!sample) return "";
                  const facilityCells = facilities
                    .map((f) => {
                      const m = f.metrics[metric.key];
                      return `<td>
                        <div class="value figure">${escapeHtml(formatMetricDisplay(m))}</div>
                        <div class="micro">${sourceChip(m.sourceMode)} ${confidencePill(m.confidenceBand)}</div>
                      </td>`;
                    })
                    .join("");
                  const totalCell = totals
                    ? (() => {
                        const m = totals.metrics[metric.key];
                        return `<td class="col-total">
                          <div class="value figure primary">${escapeHtml(formatMetricDisplay(m))}</div>
                          <div class="micro">${sourceChip(m.sourceMode)} ${confidencePill(m.confidenceBand)}</div>
                        </td>`;
                      })()
                    : "";
                  return `<tr>
                    <td class="col-metric">
                      <div class="metric-label">${escapeHtml(sample.label)}</div>
                      <div class="metric-desc">${escapeHtml(sample.description)}</div>
                    </td>
                    ${facilityCells}${totalCell}
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </section>
      `,
    )
    .join("");

  // -------- Week-over-week comparison page --------
  const comparisonBlock = packet.comparison
    ? `
      <section class="page">
        <div class="page-head">
          <div class="eyebrow">Week over week</div>
          <h1>Movement vs Prior Published Week</h1>
          <p class="lede">${escapeHtml(packet.comparison.headline)}</p>
        </div>
        <div class="panel">
          <div class="panel-eyebrow">Portfolio shifts</div>
          <ul class="rich-list">${(packet.comparison.portfolioDeltas.length > 0
            ? packet.comparison.portfolioDeltas
            : ["No material portfolio deltas between these weeks."])
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}</ul>
        </div>
        <div class="cards-grid">
          ${packet.comparison.facilityComparisons
            .slice(0, 6)
            .map((facility) => {
              const pressureDelta = facility.pressureDelta;
              const sign = pressureDelta > 0 ? "+" : "";
              const chipClass =
                pressureDelta > 0
                  ? "chip up bad"
                  : pressureDelta < 0
                    ? "chip down good"
                    : "chip flat";
              const arrow = pressureDelta > 0 ? "▲" : pressureDelta < 0 ? "▼" : "—";
              return `
                <article class="mini-card">
                  <div class="mini-card-head">
                    <h3>${escapeHtml(facility.facilityName)}</h3>
                    <span class="${chipClass} figure">${arrow} ${sign}${pressureDelta}</span>
                  </div>
                  <div class="meta">${escapeHtml(packet.comparison!.fromWeek)} → ${escapeHtml(packet.comparison!.toWeek)}</div>
                  <div class="meta meta-divided">
                    <span>${escapeHtml(facility.concernFrom)}</span>
                    <span class="arrow">→</span>
                    <span><strong>${escapeHtml(facility.concernTo)}</strong></span>
                  </div>
                  <ul>${(facility.metricDeltas.length > 0
                    ? facility.metricDeltas
                    : ["No material metric shifts."])
                    .map((item) => `<li>${escapeHtml(item)}</li>`)
                    .join("")}</ul>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `
    : "";

  // -------- Legend / methodology --------
  const legendList = packet.legend
    .map(
      (item) =>
        `<li><span class="legend-tag">${escapeHtml(item.label)}</span><span>${escapeHtml(item.description)}</span></li>`,
    )
    .join("");
  const methodologyList = packet.methodology
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  // -------- Notes --------
  const reviewNotesBlock = packet.reviewNotes
    ? `<div class="note note-review"><div class="note-eyebrow">Review notes</div><p>${escapeHtml(packet.reviewNotes)}</p></div>`
    : "";
  const draftNotesBlock = packet.draftNotes
    ? `<div class="note note-draft"><div class="note-eyebrow">Draft notes</div><p>${escapeHtml(packet.draftNotes)}</p></div>`
    : "";

  // -------- Narrative lists --------
  const narrativeBullets = packet.narrative.bullets
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const narrativeChanges = packet.topChanges
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const narrativeQuality = packet.qualityFlags
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const narrativeActions = packet.topActions
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  // -------- Gauge (completeness ring on brief page) --------
  const gaugeRadius = 54;
  const gaugeCirc = Math.PI * 2 * gaugeRadius;
  const gaugeOffset = gaugeCirc * (1 - completenessPct / 100);
  const gaugeStroke =
    completenessTone === "ok" ? "#047857" : completenessTone === "warn" ? "#B45309" : "#B91C1C";

  // ============= FINAL HTML =============
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Haven · Executive Standup · ${escapeHtml(packet.weekOf)}</title>
    <style>
      :root {
        --ink: #0B1220;
        --ink-soft: #1F2A44;
        --ink-mid: #37445F;
        --muted: #5A6375;
        --hairline: #E5E8F0;
        --hairline-strong: #D3D9E7;
        --canvas: #FAFBFC;
        --card: #FFFFFF;
        --teal: #0F766E;
        --indigo: #4F46E5;
        --indigo-soft: #EEF0FF;
        --amber: #B45309;
        --amber-soft: #FEF3C7;
        --crimson: #B91C1C;
        --crimson-soft: #FEE2E2;
        --emerald: #047857;
        --emerald-soft: #D1FAE5;
      }
      * { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        color: var(--ink);
        background: #fff;
        font-size: 10.5pt;
        line-height: 1.45;
        -webkit-font-smoothing: antialiased;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      .figure { font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
      .serif { font-family: "Iowan Old Style", "Charter", "Palatino", "Georgia", "Times New Roman", serif; }

      h1 { font-size: 26pt; line-height: 1.02; letter-spacing: -0.03em; margin: 0 0 8px; font-weight: 700; }
      h2 { font-size: 13pt; letter-spacing: -0.01em; margin: 0 0 8px; font-weight: 700; }
      h3 { font-size: 13pt; letter-spacing: -0.01em; margin: 0 0 8px; font-weight: 700; }
      p { margin: 0 0 8px; color: var(--ink-soft); }
      ul { margin: 0; padding-left: 18px; }
      li { margin: 0 0 5px; color: var(--ink-soft); }

      .eyebrow { font-size: 7.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
      .meta { font-size: 9pt; color: var(--muted); }
      .lede { font-size: 10.5pt; color: var(--ink-mid); max-width: 68ch; margin-top: 6px; }

      .page { padding: 0.08in 0.1in 0.25in; page-break-after: always; }
      .page:last-child { page-break-after: auto; }

      /* ======= COVER ======= */
      .cover {
        position: relative;
        background:
          radial-gradient(900px 500px at 85% -10%, rgba(91, 33, 182, 0.32), transparent 60%),
          radial-gradient(700px 500px at -10% 110%, rgba(15, 118, 110, 0.22), transparent 58%),
          linear-gradient(180deg, #0B1220 0%, #121A33 55%, #0B1220 100%);
        color: #F4F6FB;
        min-height: 10.1in;
        padding: 0.55in 0.55in 0.5in;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        page-break-after: always;
        overflow: hidden;
      }
      .cover::after {
        content: "";
        position: absolute;
        inset: 0;
        background:
          repeating-linear-gradient(90deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 80px),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.025) 0 1px, transparent 1px 80px);
        pointer-events: none;
      }
      .cover > * { position: relative; z-index: 1; }
      .cover .eyebrow, .cover .meta { color: rgba(244, 246, 251, 0.72); }
      .cover-head { display: flex; align-items: center; justify-content: space-between; }
      .brand-lockup { display: flex; align-items: center; gap: 14px; }
      .brand-mark {
        width: 56px; height: 56px; border-radius: 14px;
        background: linear-gradient(140deg, #4F46E5 0%, #5B21B6 55%, #1E1B4B 100%);
        color: #fff;
        display: flex; align-items: center; justify-content: center;
        font-size: 26pt; font-weight: 800; letter-spacing: -0.02em;
        box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14), 0 18px 40px rgba(79, 70, 229, 0.38);
      }
      .brand-words { line-height: 1.1; }
      .brand-words .name { font-size: 15pt; font-weight: 700; color: #fff; letter-spacing: -0.01em; }
      .brand-words .tag { font-size: 8pt; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(244, 246, 251, 0.65); }
      .cover-meta-right { text-align: right; font-size: 8.5pt; color: rgba(244, 246, 251, 0.72); letter-spacing: 0.18em; text-transform: uppercase; }

      .cover-headline { margin-top: auto; margin-bottom: 26px; }
      .cover-kicker { font-size: 8.5pt; letter-spacing: 0.35em; text-transform: uppercase; color: rgba(244, 246, 251, 0.7); margin-bottom: 18px; }
      .cover-title {
        font-family: "Iowan Old Style", "Charter", "Palatino", "Georgia", serif;
        font-size: 58pt;
        line-height: 0.98;
        letter-spacing: -0.035em;
        color: #fff;
        font-weight: 500;
        margin: 0 0 16px;
        max-width: 9in;
      }
      .cover-sub { font-size: 13pt; color: rgba(244, 246, 251, 0.85); max-width: 6.8in; line-height: 1.5; }

      .cover-stats {
        border-top: 1px solid rgba(255,255,255,0.16);
        padding-top: 20px;
        margin-top: 20px;
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 18px;
      }
      .cover-stat .label { font-size: 7.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(244, 246, 251, 0.6); margin-bottom: 6px; font-weight: 700; }
      .cover-stat .value { font-size: 22pt; font-weight: 700; color: #fff; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }

      .cover-foot {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 22px;
        margin-top: 22px;
        border-top: 1px solid rgba(255,255,255,0.12);
        padding-top: 20px;
      }
      .cover-foot-block .eyebrow { color: rgba(244, 246, 251, 0.6); }
      .cover-foot-block .value { font-size: 11pt; color: #fff; font-weight: 600; margin-top: 6px; }
      .cover-foot-block .sub { font-size: 8.5pt; color: rgba(244, 246, 251, 0.65); margin-top: 2px; }

      /* ======= Page head ======= */
      .page-head {
        border-bottom: 1px solid var(--hairline);
        padding-bottom: 16px;
        margin-bottom: 22px;
      }
      .page-head .eyebrow { margin-bottom: 8px; }
      .page-head h1 { font-size: 24pt; }
      .page-head-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; flex-wrap: wrap; }
      .status-pills { display: flex; gap: 5px; flex-wrap: wrap; }

      /* ======= Pills / chips ======= */
      .pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: 999px; font-size: 8pt; font-weight: 600; letter-spacing: 0.02em; }
      .pill .dot { width: 5px; height: 5px; border-radius: 999px; background: currentColor; }
      .pill-ok { background: var(--emerald-soft); color: var(--emerald); }
      .pill-warn { background: var(--amber-soft); color: var(--amber); }
      .pill-risk { background: var(--crimson-soft); color: var(--crimson); }
      .pill-neutral { background: #EEF1F8; color: var(--ink-mid); }
      .pill-mono { background: #EEF0FF; color: var(--indigo); text-transform: uppercase; letter-spacing: 0.12em; font-family: "SF Mono", ui-monospace, Menlo, monospace; }

      .chip { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 999px; font-size: 7.5pt; font-weight: 700; letter-spacing: 0.03em; background: #EEF1F8; color: var(--ink-mid); }
      .chip.flat { background: #EEF1F8; color: var(--ink-mid); }
      .chip.up { background: #E0E7FF; color: #3730A3; }
      .chip.down { background: #E0E7FF; color: #3730A3; }
      .chip.bad { background: #FEE2E2; color: #B91C1C; }
      .chip.good { background: #D1FAE5; color: #047857; }

      .src { display: inline-block; font-size: 7pt; letter-spacing: 0.14em; text-transform: uppercase; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-family: "SF Mono", ui-monospace, Menlo, monospace; }
      .src-auto { background: #E0E7FF; color: #4338CA; }
      .src-manual { background: #FDE68A; color: #78350F; }
      .src-forecast { background: #BAE6FD; color: #075985; }
      .src-hybrid { background: #DDD6FE; color: #5B21B6; }

      /* ======= Executive brief ======= */
      .brief-hero {
        display: grid;
        grid-template-columns: 1.35fr 1fr;
        gap: 16px;
        margin-bottom: 18px;
      }
      .brief-focus {
        background: linear-gradient(145deg, #0B1220 0%, #1F2A44 100%);
        color: #F4F6FB;
        border-radius: 18px;
        padding: 22px 24px;
        position: relative;
        overflow: hidden;
      }
      .brief-focus::before {
        content: "";
        position: absolute;
        top: -50px; right: -50px;
        width: 220px; height: 220px;
        border-radius: 999px;
        background: radial-gradient(closest-side, rgba(91,33,182,0.4), transparent 70%);
      }
      .brief-focus > * { position: relative; z-index: 1; }
      .brief-focus .eyebrow { color: rgba(244,246,251,0.72); }
      .brief-focus .headline {
        font-family: "Iowan Old Style", "Charter", "Georgia", serif;
        font-size: 22pt;
        line-height: 1.12;
        letter-spacing: -0.02em;
        color: #fff;
        margin: 10px 0 10px;
        font-weight: 500;
      }
      .brief-focus .meta { color: rgba(244,246,251,0.72); }

      .brief-spotlight {
        background: #fff;
        border: 1px solid var(--hairline);
        border-radius: 18px;
        padding: 20px;
      }
      .brief-spotlight .headline { font-size: 15pt; letter-spacing: -0.02em; font-weight: 700; margin: 6px 0 4px; }

      .gauge { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px; border: 1px solid var(--hairline); margin-top: 12px; background: #FAFBFC; }
      .gauge svg { flex: 0 0 auto; }
      .gauge-value { font-size: 18pt; font-weight: 700; color: var(--ink); letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
      .gauge-label { font-size: 8pt; color: var(--muted); text-transform: uppercase; letter-spacing: 0.2em; font-weight: 700; }

      .brief-cols { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
      .brief-col {
        background: var(--card);
        border: 1px solid var(--hairline);
        border-radius: 14px;
        padding: 16px;
      }
      .brief-col .eyebrow { margin-bottom: 8px; display: block; }
      .brief-col ul li { font-size: 9.5pt; }

      /* ======= KPI grid ======= */
      .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
      .kpi {
        background: var(--card);
        border: 1px solid var(--hairline);
        border-radius: 12px;
        padding: 12px 14px 10px;
        min-height: 100px;
        display: flex; flex-direction: column; justify-content: space-between;
      }
      .kpi-label { font-size: 7.5pt; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
      .kpi-value { font-size: 22pt; font-weight: 700; letter-spacing: -0.03em; color: var(--ink); margin: 6px 0 6px; }
      .kpi-foot { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; }

      /* ======= Pressure leaderboard ======= */
      .leaderboard { background: var(--card); border: 1px solid var(--hairline); border-radius: 14px; padding: 16px 18px; }
      .rank-row { display: grid; grid-template-columns: 32px 1fr; gap: 12px; padding: 9px 0; border-top: 1px solid var(--hairline); }
      .rank-row:first-child { border-top: 0; padding-top: 4px; }
      .rank-index { font-size: 16pt; font-weight: 700; color: var(--muted); letter-spacing: -0.02em; }
      .rank-head { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
      .rank-name { font-size: 12pt; font-weight: 700; color: var(--ink); letter-spacing: -0.01em; }
      .rank-score { font-size: 9pt; color: var(--muted); }
      .rank-score b { color: var(--ink); font-weight: 700; }
      .rank-bar { height: 6px; background: #EEF1F8; border-radius: 999px; overflow: hidden; margin: 6px 0 5px; }
      .rank-fill { display: block; height: 100%; border-radius: 999px; }
      .rank-fill-ok { background: linear-gradient(90deg, #10B981, #047857); }
      .rank-fill-warn { background: linear-gradient(90deg, #F59E0B, #B45309); }
      .rank-fill-risk { background: linear-gradient(90deg, #EF4444, #B91C1C); }
      .rank-concern { font-size: 9pt; color: var(--ink-mid); }

      /* ======= Facility scorecards ======= */
      .cards-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .facility-card {
        background: var(--card);
        border: 1px solid var(--hairline);
        border-radius: 16px;
        padding: 16px 18px;
        break-inside: avoid;
      }
      .facility-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; margin-bottom: 10px; }
      .facility-card-head h2 { font-size: 13pt; margin: 3px 0 2px; }
      .facility-card-head .meta { font-size: 9pt; }
      .pressure-badge { flex: 0 0 auto; padding: 7px 11px; border-radius: 10px; text-align: center; min-width: 68px; }
      .pressure-badge-label { font-size: 7pt; letter-spacing: 0.2em; text-transform: uppercase; font-weight: 700; opacity: 0.78; }
      .pressure-badge-value { font-size: 17pt; font-weight: 800; letter-spacing: -0.03em; margin-top: 2px; }
      .pressure-badge-ok { background: var(--emerald-soft); color: var(--emerald); }
      .pressure-badge-warn { background: var(--amber-soft); color: var(--amber); }
      .pressure-badge-risk { background: var(--crimson-soft); color: var(--crimson); }
      .facility-card-body { display: grid; grid-template-columns: 1fr; gap: 12px; margin-top: 12px; }
      .facility-block .block-eyebrow { font-size: 7.5pt; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin-bottom: 5px; }
      .facility-block ul { padding-left: 16px; }
      .facility-block li { font-size: 9pt; margin-bottom: 3px; }

      /* ======= Operating detail ======= */
      .op-section { margin-bottom: 20px; break-inside: avoid; }
      .op-section-head { margin-bottom: 10px; }
      .op-section-eyebrow { font-size: 7.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin-bottom: 4px; }
      .op-section-head h3 { font-size: 14pt; margin: 0; }
      .op-table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--card); border: 1px solid var(--hairline); border-radius: 12px; overflow: hidden; }
      .op-table thead th { font-size: 7.5pt; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); text-align: left; padding: 9px 12px; background: #F7F9FD; border-bottom: 1px solid var(--hairline); font-weight: 700; }
      .op-table tbody td { padding: 11px 12px; border-bottom: 1px solid var(--hairline); vertical-align: top; font-size: 9.5pt; color: var(--ink-soft); }
      .op-table tbody tr:last-child td { border-bottom: 0; }
      .op-table tbody tr:nth-child(even) td { background: #FBFCFE; }
      .op-table .col-metric { width: 34%; }
      .op-table .col-num { text-align: right; white-space: nowrap; }
      .op-table .col-tag { text-align: left; white-space: nowrap; }
      .op-table .metric-label { font-weight: 700; color: var(--ink); font-size: 10pt; }
      .op-table .metric-desc { margin-top: 2px; font-size: 8.5pt; color: var(--muted); line-height: 1.35; }
      .op-table .figure.primary { color: var(--ink); font-weight: 700; }
      .op-table.op-table-wide { font-size: 8.5pt; }
      .op-table.op-table-wide thead th { font-size: 7pt; }
      .op-table.op-table-wide .value { font-weight: 600; color: var(--ink); font-size: 9.5pt; }
      .op-table.op-table-wide .micro { margin-top: 4px; display: flex; gap: 4px; flex-wrap: wrap; }
      .op-table.op-table-wide .col-total { background: #EEF2F7 !important; }
      .op-table.op-table-wide tbody tr td.col-total { background: #EEF2F7 !important; }

      /* ======= Panel ======= */
      .panel { background: var(--card); border: 1px solid var(--hairline); border-radius: 14px; padding: 16px 18px; margin-bottom: 12px; }
      .panel-eyebrow { font-size: 7.5pt; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin-bottom: 8px; }
      .rich-list { padding-left: 18px; }
      .rich-list li { font-size: 9.5pt; color: var(--ink-soft); margin-bottom: 5px; }

      /* ======= Notes ======= */
      .note { border-radius: 12px; padding: 12px 16px; margin-bottom: 10px; border: 1px solid var(--hairline); background: #fff; }
      .note-eyebrow { font-size: 7.5pt; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); font-weight: 700; margin-bottom: 5px; }
      .note p { margin: 0; font-size: 9.5pt; color: var(--ink-soft); }
      .note-review { background: #FEFCE8; border-color: #FDE68A; }
      .note-draft { background: #EEF0FF; border-color: #C7D2FE; }

      /* ======= Week-over-week mini cards ======= */
      .mini-card { background: #fff; border: 1px solid var(--hairline); border-radius: 14px; padding: 14px 16px; break-inside: avoid; }
      .mini-card-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 4px; }
      .mini-card h3 { font-size: 11.5pt; margin: 0; }
      .mini-card ul { padding-left: 16px; margin-top: 8px; }
      .mini-card ul li { font-size: 9pt; margin-bottom: 3px; }
      .meta-divided { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
      .meta-divided .arrow { color: var(--muted); }

      /* ======= Legend / methodology ======= */
      .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
      .legend-list { list-style: none; padding: 0; margin: 0; }
      .legend-list li { display: grid; grid-template-columns: 110px 1fr; gap: 12px; padding: 10px 0; border-bottom: 1px dashed var(--hairline); font-size: 9.5pt; color: var(--ink-soft); margin: 0; }
      .legend-list li:last-child { border-bottom: 0; }
      .legend-tag { font-family: "SF Mono", ui-monospace, Menlo, monospace; font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; padding: 3px 8px; border-radius: 6px; background: #EEF1F8; color: var(--ink-mid); font-weight: 700; align-self: start; }
      .lineage { background: linear-gradient(180deg, #fff, #F7F9FD); border: 1px solid var(--hairline); border-radius: 14px; padding: 16px 18px; font-size: 9.5pt; color: var(--ink-mid); line-height: 1.6; }
      .lineage strong { color: var(--ink); }
      .lineage code { font-family: "SF Mono", ui-monospace, Menlo, monospace; background: #EEF1F8; color: var(--ink-mid); padding: 1px 5px; border-radius: 4px; font-size: 8.5pt; }

      /* ======= Footer ======= */
      .doc-foot { display: flex; justify-content: space-between; align-items: center; padding-top: 10px; margin-top: 20px; border-top: 1px solid var(--hairline); font-size: 8pt; color: var(--muted); letter-spacing: 0.06em; }
      .doc-foot .wordmark { display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: var(--ink); letter-spacing: 0.02em; }
      .doc-foot .mono-mark { width: 16px; height: 16px; border-radius: 4px; background: linear-gradient(140deg, #4F46E5, #5B21B6); color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 7pt; font-weight: 800; }

      @page { size: Letter; margin: 0.35in; }
    </style>
  </head>
  <body>
    <!-- =================== COVER =================== -->
    <section class="cover">
      <div class="cover-head">
        <div class="brand-lockup">
          <div class="brand-mark">H</div>
          <div class="brand-words">
            <div class="name">Haven</div>
            <div class="tag">Circle of Life · Owner Board</div>
          </div>
        </div>
        <div class="cover-meta-right">
          Executive Standup · Week of ${escapeHtml(packet.weekOf)} · v${packet.version}
        </div>
      </div>

      <div class="cover-headline">
        <div class="cover-kicker">Weekly executive standup · Confidence ${escapeHtml(packet.confidenceBand)} · ${completenessPct}% complete</div>
        <h1 class="cover-title">Circle of Life Portfolio.</h1>
        <div class="cover-sub">${escapeHtml(packet.focusStatement)}</div>
      </div>

      <div>
        <div class="cover-stats">
          ${coverStats
            .map(
              (stat) => `
              <div class="cover-stat">
                <div class="label">${escapeHtml(stat.label)}</div>
                <div class="value">${escapeHtml(stat.value)}</div>
              </div>
            `,
            )
            .join("")}
        </div>
        <div class="cover-foot">
          <div class="cover-foot-block">
            <div class="eyebrow">Prepared by</div>
            <div class="value">${escapeHtml(packet.generatedBy)}</div>
            <div class="sub">Generated ${escapeHtml(generatedAtDisplay)}</div>
          </div>
          <div class="cover-foot-block">
            <div class="eyebrow">Published</div>
            <div class="value">${escapeHtml(packet.publishedBy)}</div>
            <div class="sub">${escapeHtml(publishedAtDisplay)}</div>
          </div>
          <div class="cover-foot-block">
            <div class="eyebrow">Week of</div>
            <div class="value">${escapeHtml(weekLabel)}</div>
            <div class="sub">Packet version ${packet.version} · ${escapeHtml(packet.status)}</div>
          </div>
        </div>
      </div>
    </section>

    <!-- =================== EXECUTIVE BRIEF =================== -->
    <section class="page">
      <div class="page-head">
        <div class="page-head-row">
          <div>
            <div class="eyebrow">Owner briefing</div>
            <h1>Executive Brief</h1>
            <p class="lede">One-page operating read for ${escapeHtml(weekLabel)}. The single highest-value signal, what shifted, and what to do next.</p>
          </div>
          <div class="status-pills">
            <span class="pill pill-${statusTone}"><span class="dot"></span>${escapeHtml(packet.status)}</span>
            <span class="pill pill-${confidenceTone}"><span class="dot"></span>${escapeHtml(packet.confidenceBand)} confidence</span>
            <span class="pill pill-${completenessTone}"><span class="dot"></span>${completenessPct}% complete</span>
            <span class="pill pill-mono">v${packet.version}</span>
          </div>
        </div>
      </div>

      <div class="brief-hero">
        <div class="brief-focus">
          <div class="eyebrow">Primary focus this week</div>
          <div class="headline">${escapeHtml(packet.focusStatement)}</div>
          <div class="meta">This is the single highest-value read from the packet right now.</div>
        </div>
        <div class="brief-spotlight">
          <div class="eyebrow">Facility spotlight</div>
          ${
            packet.spotlightFacility
              ? `
                <div class="headline">${escapeHtml(packet.spotlightFacility.facilityName)}</div>
                <div class="meta">${escapeHtml(packet.spotlightFacility.topConcern)} · Pressure ${packet.spotlightFacility.pressureScore}</div>
                <ul style="margin-top:10px;">${packet.spotlightFacility.interventions
                  .map((item) => `<li>${escapeHtml(item)}</li>`)
                  .join("")}</ul>
              `
              : `<div class="meta" style="margin-top:10px;">No facility is flagged above portfolio baseline this week.</div>`
          }
          <div class="gauge">
            <svg width="66" height="66" viewBox="0 0 140 140" xmlns="http://www.w3.org/2000/svg">
              <circle cx="70" cy="70" r="${gaugeRadius}" fill="none" stroke="#EEF1F8" stroke-width="14" />
              <circle cx="70" cy="70" r="${gaugeRadius}" fill="none" stroke="${gaugeStroke}" stroke-width="14" stroke-linecap="round"
                transform="rotate(-90 70 70)"
                stroke-dasharray="${gaugeCirc.toFixed(2)}" stroke-dashoffset="${gaugeOffset.toFixed(2)}" />
            </svg>
            <div>
              <div class="gauge-value figure">${completenessPct}%</div>
              <div class="gauge-label">Packet completeness</div>
            </div>
          </div>
        </div>
      </div>

      <div class="brief-cols">
        <div class="brief-col">
          <span class="eyebrow">What matters now</span>
          <ul>${narrativeBullets || "<li>No narrative insights available.</li>"}</ul>
        </div>
        <div class="brief-col">
          <span class="eyebrow">What changed</span>
          <ul>${narrativeChanges || "<li>No prior published week available for comparison.</li>"}</ul>
        </div>
        <div class="brief-col">
          <span class="eyebrow">What to do</span>
          <ul>${narrativeActions || "<li>No intervention recommendations yet.</li>"}</ul>
        </div>
      </div>

      ${
        reviewNotesBlock || draftNotesBlock
          ? `<div class="two-col" style="margin-top:12px;">${reviewNotesBlock}${draftNotesBlock}</div>`
          : ""
      }

      <div class="doc-foot">
        <span class="wordmark"><span class="mono-mark">H</span>Haven · Circle of Life</span>
        <span>Executive brief · ${escapeHtml(weekLabel)}</span>
      </div>
    </section>

    <!-- =================== PORTFOLIO SIGNALS =================== -->
    <section class="page">
      <div class="page-head">
        <div class="eyebrow">Portfolio signals</div>
        <h1>Weekly Scorecard</h1>
        <p class="lede">Portfolio-level operating metrics with week-over-week movement, data source, and confidence band.</p>
      </div>

      <div class="kpi-grid">${kpiGrid}</div>

      <div class="op-section-head" style="margin-top:22px; margin-bottom:10px;">
        <div class="op-section-eyebrow">Facility pressure leaderboard</div>
        <h3>Who needs attention first</h3>
      </div>
      <div class="leaderboard">${pressureRows}</div>

      <div class="panel" style="margin-top:12px;">
        <div class="panel-eyebrow">Trust notes</div>
        <ul class="rich-list">${narrativeQuality || "<li>No data quality warnings for this packet.</li>"}</ul>
      </div>

      <div class="doc-foot">
        <span class="wordmark"><span class="mono-mark">H</span>Haven · Circle of Life</span>
        <span>Weekly scorecard · ${escapeHtml(weekLabel)}</span>
      </div>
    </section>

    <!-- =================== FACILITY SCORECARDS =================== -->
    <section class="page">
      <div class="page-head">
        <div class="eyebrow">Facility scorecards</div>
        <h1>By-Facility Detail</h1>
        <p class="lede">Per-facility pressure, why it is or isn't red, variance flags, and owner-ready interventions.</p>
      </div>
      <div class="cards-grid">${facilityScorecards}</div>
      <div class="doc-foot">
        <span class="wordmark"><span class="mono-mark">H</span>Haven · Circle of Life</span>
        <span>Facility scorecards · ${escapeHtml(weekLabel)}</span>
      </div>
    </section>

    ${comparisonBlock}

    <!-- =================== OPERATING DETAIL =================== -->
    <section class="page">
      <div class="page-head">
        <div class="eyebrow">Operating detail</div>
        <h1>Portfolio Metric Ledger</h1>
        <p class="lede">Only decision-relevant metrics are promoted into the primary packet. Previous vs. current vs. delta, with source and confidence for every row.</p>
      </div>
      ${sectionBlocks}
      <div class="doc-foot">
        <span class="wordmark"><span class="mono-mark">H</span>Haven · Circle of Life</span>
        <span>Operating detail · ${escapeHtml(weekLabel)}</span>
      </div>
    </section>

    <!-- =================== FULL APPENDIX =================== -->
    <section class="page">
      <div class="page-head">
        <div class="eyebrow">Workbook appendix</div>
        <h1>Facility-by-Facility Detail</h1>
        <p class="lede">Complete cross-facility breakdown, including low-signal rows kept out of the primary executive packet so the underlying workbook remains fully auditable.</p>
      </div>
      ${appendixRows}
      <div class="doc-foot">
        <span class="wordmark"><span class="mono-mark">H</span>Haven · Circle of Life</span>
        <span>Workbook appendix · ${escapeHtml(weekLabel)}</span>
      </div>
    </section>

    <!-- =================== METHODOLOGY =================== -->
    <section class="page">
      <div class="page-head">
        <div class="eyebrow">Trust &amp; methodology</div>
        <h1>How to Read This Packet</h1>
        <p class="lede">Every metric carries its source mode and confidence band. Low-confidence or manual rows are shown intentionally rather than hidden so the owner can trust the packet's limitations as well as its numbers.</p>
      </div>

      <div class="two-col">
        <div class="panel">
          <div class="panel-eyebrow">Legend</div>
          <ul class="legend-list">${legendList}</ul>
        </div>
        <div class="panel">
          <div class="panel-eyebrow">Methodology</div>
          <ul class="rich-list">${methodologyList}</ul>
        </div>
      </div>

      <div class="lineage" style="margin-top:12px;">
        <strong>Lineage rules.</strong> Every metric in this packet is displayed with its source mode, confidence band, freshness, and override state. Rows marked <code>manual</code> or <code>low</code> are intentionally surfaced — hiding them would give the portfolio a falsely confident read.
      </div>

      <div class="doc-foot">
        <span class="wordmark"><span class="mono-mark">H</span>Haven · Circle of Life</span>
        <span>Methodology · ${escapeHtml(weekLabel)}</span>
      </div>
    </section>
  </body>
</html>`;
}
