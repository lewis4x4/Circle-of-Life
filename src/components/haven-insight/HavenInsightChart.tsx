"use client";

import { cn } from "@/lib/utils";

export type ChartSpec = {
  kind: "bar" | "line" | "pie";
  series: Array<{ label: string; value: number }>;
};

type Props = { spec: ChartSpec; className?: string };

const W = 320;
const H = 180;
const P = 24;
const round = (n: number) => Number(n.toFixed(2));

function polar(cx: number, cy: number, r: number, angle: number) {
  const a = (angle - 90) * Math.PI / 180;
  return { x: round(cx + r * Math.cos(a)), y: round(cy + r * Math.sin(a)) };
}

function piePath(cx: number, cy: number, r: number, start: number, end: number) {
  const s = polar(cx, cy, r, end);
  const e = polar(cx, cy, r, start);
  const large = end - start <= 180 ? 0 : 1;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 0 ${e.x} ${e.y} Z`;
}

export function HavenInsightChart({ spec, className }: Props) {
  const data = spec.series.filter((item) => Number.isFinite(item.value)).slice(0, 8);
  if (!data.length) return null;

  const max = Math.max(...data.map((item) => Math.abs(item.value)), 1);
  const chartW = W - P * 2;
  const chartH = H - P * 2;
  const total = Math.max(data.reduce((sum, item) => sum + Math.max(item.value, 0), 0), 1);
  let pieCursor = 0;

  const points = data.map((item, index) => {
    const x = P + (data.length === 1 ? chartW / 2 : (index / (data.length - 1)) * chartW);
    const y = H - P - (Math.max(item.value, 0) / max) * chartH;
    return { x: round(x), y: round(y), label: item.label, value: item.value };
  });
  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");

  return (
    <div className={cn("max-w-[480px] aspect-[16/9] rounded-[var(--radius)] border border-border bg-background/60 p-3", className)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${spec.kind} chart`} className="h-full w-full overflow-visible">
        {spec.kind !== "pie" && (
          <>
            <path d={`M ${P} ${P} V ${H - P} H ${W - P}`} fill="none" stroke="var(--muted-foreground)" strokeOpacity="0.35" strokeWidth="1" />
            {data.map((item, index) => (
              <text key={item.label} x={P + (index + 0.5) * (chartW / data.length)} y={H - 6} textAnchor="middle" fill="var(--muted-foreground)" fontSize="8">
                {item.label.slice(0, 10)}
              </text>
            ))}
          </>
        )}
        {spec.kind === "bar" && data.map((item, index) => {
          const gap = 8;
          const bw = chartW / data.length - gap;
          const bh = (Math.max(item.value, 0) / max) * chartH;
          return <rect key={item.label} x={P + index * (chartW / data.length) + gap / 2} y={H - P - bh} width={bw} height={bh} rx="3" fill="var(--primary)" opacity="0.88" />;
        })}
        {spec.kind === "line" && <path d={linePath} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />}
        {spec.kind === "line" && points.map((point) => <circle key={point.label} cx={point.x} cy={point.y} r="3" fill="var(--primary)" />)}
        {spec.kind === "pie" && data.length === 1 && <circle cx={W / 2} cy={H / 2} r="62" fill="var(--primary)" opacity="0.9" />}
        {spec.kind === "pie" && data.length > 1 && data.map((item, index) => {
          const start = pieCursor;
          const end = pieCursor + (Math.max(item.value, 0) / total) * 360;
          pieCursor = end;
          return <path key={item.label} d={piePath(W / 2, H / 2, 62, start, end)} fill={index === 0 ? "var(--primary)" : "var(--muted-foreground)"} opacity={index === 0 ? 0.9 : 0.25 + index * 0.08} />;
        })}
      </svg>
    </div>
  );
}
