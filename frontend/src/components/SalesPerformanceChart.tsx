import { useMemo, useState } from "react";

export type MonthlySalesPoint = {
  month: string;
  value: number;
};

type SalesPerformanceChartProps = {
  points: MonthlySalesPoint[];
  activeMonth: string | null;
  onSelectMonth: (month: string | null) => void;
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-MY", {
    style: "currency",
    currency: "MYR",
    maximumFractionDigits: 0
  }).format(value);
}

export function SalesPerformanceChart({ points, activeMonth, onSelectMonth }: SalesPerformanceChartProps) {
  const width = 304;
  const height = 200;
  const padding = { top: 14, right: 14, bottom: 30, left: 14 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const barWidth = chartWidth / Math.max(points.length, 1) - 12;
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);

  const focusedPoint = useMemo(
    () => points.find((point) => point.month === hoveredMonth) || points.find((point) => point.month === activeMonth) || null,
    [activeMonth, hoveredMonth, points]
  );

  return (
    <section className="glass-panel p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-ink">Monthly Sales Performance</h3>
        {activeMonth ? (
          <button
            type="button"
            className="rounded-full border border-whatsapp-line bg-white px-3 py-1 text-xs font-semibold text-whatsapp-muted transition hover:text-whatsapp-deep"
            onClick={() => onSelectMonth(null)}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="mt-3 overflow-hidden rounded-xl border border-whatsapp-line bg-white/80 p-2.5">
        <svg aria-label="Monthly sales performance chart" viewBox={`0 0 ${width} ${height}`} className="h-auto w-full">
          {[0, 1, 2, 3].map((line) => {
            const y = padding.top + (chartHeight / 4) * line;
            return <line key={line} x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#e9e3dc" strokeDasharray="4 4" />;
          })}

          {points.map((point, index) => {
            const barHeight = (point.value / maxValue) * chartHeight;
            const x = padding.left + index * (chartWidth / Math.max(points.length, 1)) + 6;
            const y = padding.top + chartHeight - barHeight;
            const isActive = activeMonth === point.month;
            const isDimmed = Boolean(activeMonth && !isActive);
            return (
              <g key={point.month}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx="4"
                  fill={isActive ? "#4fb690" : "#8fd0af"}
                  opacity={isDimmed ? 0.35 : 1}
                  className="cursor-pointer transition-all"
                  onClick={() => onSelectMonth(isActive ? null : point.month)}
                  onMouseEnter={() => setHoveredMonth(point.month)}
                  onMouseLeave={() => setHoveredMonth(null)}
                />
                {/* Show value above bar on hover or active */}
                {(hoveredMonth === point.month || isActive) && (
                  <text
                    x={x + barWidth / 2}
                    y={y - 8}
                    textAnchor="middle"
                    className="fill-whatsapp-dark text-[11px] font-semibold"
                  >
                    {formatCurrency(point.value)}
                  </text>
                )}
                {/* Month label below bar */}
                <text
                  x={x + barWidth / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-whatsapp-muted text-[11px] font-semibold"
                >
                  {point.month}
                </text>
              </g>
            );
          })}

          <polyline
            fill="none"
            points={points
              .map((point, index) => {
                const x = padding.left + index * (chartWidth / Math.max(points.length, 1)) + 6 + barWidth / 2;
                const y = padding.top + chartHeight - (point.value / maxValue) * chartHeight;
                return `${x},${y}`;
              })
              .join(" ")}
            stroke="#52b788"
            strokeWidth="2.5"
          />
        </svg>
      </div>
      <div className="mt-2 rounded-xl border border-whatsapp-line bg-white/80 px-3 py-1.5 text-xs text-whatsapp-muted">
        {focusedPoint ? (
          <p>
            <span className="font-semibold text-ink">{focusedPoint.month}</span>
            {` - ${formatCurrency(focusedPoint.value)}`}
          </p>
        ) : (
          <p>Hover or click a month to inspect and filter.</p>
        )}
      </div>
    </section>
  );
}
