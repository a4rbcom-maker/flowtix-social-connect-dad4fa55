import { cn } from "@/lib/utils";

export interface LineChartDatum {
  label: string;
  value: number;
}

interface LineChartProps {
  data: LineChartDatum[];
  height?: number;
  className?: string;
}

export function LineChart({ data, height = 200, className }: LineChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className={cn("flex items-center justify-center text-sm text-[var(--color-fg-muted)]", className)} style={{ height }}>
        No data
      </div>
    );
  }

  const width = 800;
  const padding = { top: 16, right: 16, bottom: 32, left: 40 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const max = Math.max(...data.map((d) => d.value), 1);
  const niceMax = Math.ceil(max * 1.1);

  const stepX = data.length > 1 ? chartW / (data.length - 1) : 0;

  const points = data.map((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + chartH - (d.value / niceMax) * chartH;
    return { x, y, ...d };
  });

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  const areaD = `${pathD} L ${points[points.length - 1].x.toFixed(2)} ${(padding.top + chartH).toFixed(2)} L ${points[0].x.toFixed(2)} ${(padding.top + chartH).toFixed(2)} Z`;

  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => niceMax - (i * niceMax) / yTicks);

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="none" style={{ minHeight: height }}>
        <defs>
          <linearGradient id="lc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {ticks.map((tk, i) => {
          const y = padding.top + (i * chartH) / yTicks;
          return (
            <g key={i}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="var(--color-border)" strokeWidth="1" strokeDasharray={i === yTicks ? "0" : "3 3"} />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--color-fg-muted)">
                {Math.round(tk)}
              </text>
            </g>
          );
        })}

        <path d={areaD} fill="url(#lc-area)" />
        <path d={pathD} fill="none" stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, i) => (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="3" fill="var(--color-primary)" />
          </g>
        ))}

        {data.map((d, i) => {
          if (data.length > 14 && i % Math.ceil(data.length / 7) !== 0) return null;
          const x = padding.left + i * stepX;
          return (
            <text key={i} x={x} y={height - padding.bottom + 18} textAnchor="middle" fontSize="10" fill="var(--color-fg-muted)">
              {d.label.slice(5)}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
