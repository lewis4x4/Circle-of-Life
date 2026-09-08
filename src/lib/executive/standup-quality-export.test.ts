import { describe, expect, it } from "vitest";
import { formatStandupMetricValue, formatStandupMetricDelta } from "./executive-display-copy";
import { buildStandupPacketDocument } from "./standup-packet";
import { buildStandupBoardPrintHtml } from "./standup-pdf";
import { standupQualityFixture } from "@/test-fixtures/standup-quality";

describe("consistent standup source qualifications", () => {
  it("qualifies historical methods and identifies corrected inventory methodology", () => {
    const current = standupQualityFixture();
    const historical = buildStandupPacketDocument(current);
    expect(historical.methodology.join(" ")).toContain("Historical bed figures may include");
    for (const facility of current.facilities) {
      for (const metric of Object.values(facility.metrics)) {
        metric.sourceRefJson = metric.sourceRefJson.map((entry) => entry && typeof entry === "object" && entry.kind === "source_quality" ? { ...entry, basis: "haven_live_v2" } : entry);
      }
    }
    const corrected = buildStandupPacketDocument(current);
    expect(corrected.methodology.join(" ")).toContain("V2 bed counts require available, unoccupied, unblocked and unreserved records");
    expect(corrected.methodology.join(" ")).toContain("targets can include drafts");
  });

  it("preserves recorded zero and partial scope through UI, packet and PDF HTML", () => {
    const current = standupQualityFixture();
    const previous = standupQualityFixture("2026-08-31");
    const metric = current.facilities[2].metrics.current_total_census;
    const value = formatStandupMetricValue(metric);
    expect(value).toBe("0 recorded — partial 1/2");
    expect(formatStandupMetricDelta(previous.facilities[2].metrics.current_total_census, metric)).toContain("Comparison unavailable");
    const packet = buildStandupPacketDocument(current, previous);
    expect(JSON.stringify(packet)).toContain(value);
    expect(packet.methodology.join(" ")).toContain("definitions remain TBD");
    const html = buildStandupBoardPrintHtml(current, previous);
    expect(html).toContain(value);
    expect(html).toContain("fields populated");
    expect(html).not.toContain("% complete");
    expect(html).toContain("Source as of: unconfirmed");
    expect(html).toContain("Comparison unavailable");
    expect(html).toContain("Ranking unavailable");
    expect(html).not.toContain('class="rank-row"');
    expect(html).not.toContain("owner-ready interventions");
    expect(html).not.toContain("No facility is flagged above");
    expect(html).not.toContain("No data quality warnings");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("null pressure");
  });
});
