import { KPITile } from "./KPITile";

const SPARK = [48, 52, 55, 54, 58, 61, 64, 68];

export function KPITilePreview() {
  return (
    <div className="flex flex-col gap-4">
      <PreviewSection state="default" title="Default — count, no trend">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <KPITile
            label="Active admits"
            value={7}
            info="Admits pending move-in within 7 days"
          />
          <KPITile
            label="Beds open"
            value={12}
            info="Beds available portfolio-wide"
          />
          <KPITile
            label="Alerts"
            value={0}
            info="High/medium severity unacknowledged"
          />
        </div>
      </PreviewSection>

      <PreviewSection state="withTrendUp" title="Trend up · goodDirection up (success)">
        <KPITile
          label="Occupancy"
          value={92}
          unit="%"
          info="Census / licensed beds"
          trend={{
            direction: "up",
            value: 1.8,
            unit: "pp",
            period: "vs prior 7 days",
            goodDirection: "up",
          }}
        />
      </PreviewSection>

      <PreviewSection state="withTrendDown" title="Trend down · goodDirection up (danger)">
        <KPITile
          label="NPS"
          value={68}
          info="Family NPS rolling 30d"
          trend={{
            direction: "down",
            value: 4,
            unit: "pts",
            period: "vs prior 30 days",
            goodDirection: "up",
          }}
        />
      </PreviewSection>

      <PreviewSection state="withSparkline" title="Trend + sparkline">
        <KPITile
          label="Occupancy"
          value={92}
          unit="%"
          info="Census / licensed beds"
          trend={{
            direction: "up",
            value: 1.8,
            unit: "pp",
            period: "vs prior 7 days",
            goodDirection: "up",
          }}
          sparkline={SPARK}
        />
      </PreviewSection>

      <PreviewSection state="withBreachMessage" title="Breach message (danger tone)">
        <KPITile
          label="eMAR variance"
          value={14}
          unit="%"
          tone="danger"
          info="Missed/late doses as % of scheduled"
          trend={{
            direction: "up",
            value: 3,
            unit: "pp",
            period: "vs prior 7 days",
            goodDirection: "down",
          }}
          breachMessage="Above target: 14% &gt; 8% threshold"
        />
      </PreviewSection>

      <PreviewSection state="regulatoryTone" title="Regulatory tone">
        <KPITile
          label="Survey window"
          value={21}
          unit="days"
          tone="regulatory"
          info="Days until next scheduled AHCA survey window"
        />
      </PreviewSection>

      <PreviewSection state="dangerTone" title="Danger tone — clickable drill">
        <KPITile
          label="High-severity incidents"
          value={3}
          tone="danger"
          info="Open high-severity this week"
          onClick={() => undefined}
        />
      </PreviewSection>
    </div>
  );
}

function PreviewSection({
  title,
  state,
  children,
}: {
  title: string;
  state: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-state={state}
      className="rounded-md border border-border bg-surface"
    >
      <header className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
          {state}
        </span>
        <span className="text-xs text-text-secondary">{title}</span>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}
