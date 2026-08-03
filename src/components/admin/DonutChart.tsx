import { cn } from "@/lib/utils";

interface DonutChartDatum {
  label: string;
  value: number;
  color?: string;
}

interface DonutChartProps {
  data: DonutChartDatum[];
  size?: number;
  className?: string;
}

export function DonutChart({ data, size = 180, className }: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = size / 2;
  const stroke = size * 0.16;
  const cx = radius;
  const cy = radius;
  const r = radius - stroke / 2;
  const circumference = 2 * Math.PI * r;

  if (total === 0) {
    return (
      <div className={cn("flex items-center justify-center", className)} style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={stroke} />
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize="13" fill="var(--color-fg-muted)">
            No data
          </text>
        </svg>
      </div>
    );
  }

  let offset = 0;
  const segments = data.map((d, i) => {
    const fraction = d.value / total;
    const length = fraction * circumference;
    const dash = `${length} ${circumference - length}`;
    const rotation = (offset / circumference) * 360 - 90;
    offset += length;
    return (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={d.color ?? "var(--color-primary)"}
        strokeWidth={stroke}
        strokeDasharray={dash}
        strokeLinecap="round"
        transform={`rotate(${rotation} ${cx} ${cy})`}
        className="transition-all duration-500"
      >
        <title>{`${d.label}: ${d.value} (${(fraction * 100).toFixed(1)}%)`}</title>
      </circle>
    );
  });

  return (
    <div className={cn("flex items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--color-surface-2)" strokeWidth={stroke} opacity={0.3} />
        {segments}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="20" fontWeight="700" fill="var(--color-fg)">
          {total.toLocaleString()}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="var(--color-fg-muted)">
          Total
        </text>
      </svg>
    </div>
  );
}
