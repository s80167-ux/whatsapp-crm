import { useMemo, useState } from "react";

export type FunnelStage = {
  name: string;
  count: number;
  percent: number;
  color: string;
};

type SalesFunnelChartProps = {
  stages: FunnelStage[];
  activeStage: string | null;
  onSelectStage: (stageName: string | null) => void;
};

export function SalesFunnelChart({ stages, activeStage, onSelectStage }: SalesFunnelChartProps) {
  const chartWidth = 240;
  const chartHeight = 220;
  const topWidth = 218;
  const bottomWidth = 88;
  const segmentHeight = chartHeight / Math.max(stages.length, 1);
  const denominator = Math.max(stages.length - 1, 1);
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);

  const focusedStage = useMemo(
    () => stages.find((stage) => stage.name === hoveredStage) || stages.find((stage) => stage.name === activeStage) || null,
    [activeStage, hoveredStage, stages]
  );

  return (
    <section className="glass-panel p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-ink">Sales Funnel</h3>
        {activeStage ? (
          <button
            type="button"
            className="rounded-full border border-whatsapp-line bg-white px-3 py-1 text-xs font-semibold text-whatsapp-muted transition hover:text-whatsapp-deep"
            onClick={() => onSelectStage(null)}
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex justify-center">
        <svg aria-label="Sales funnel" viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="h-auto w-full max-w-[248px]">
          {stages.map((stage, index) => {
            const nextTopWidth = index === stages.length - 1 ? bottomWidth : topWidth - ((topWidth - bottomWidth) / denominator) * (index + 1);
            const currentTopWidth = topWidth - ((topWidth - bottomWidth) / denominator) * index;
            const yTop = index * segmentHeight;
            const yBottom = yTop + segmentHeight - 2;
            const xTopLeft = (chartWidth - currentTopWidth) / 2;
            const xTopRight = xTopLeft + currentTopWidth;
            const xBottomLeft = (chartWidth - nextTopWidth) / 2;
            const xBottomRight = xBottomLeft + nextTopWidth;
            const isActive = activeStage === stage.name;
            const isDimmed = Boolean(activeStage && !isActive);

            return (
              <g key={stage.name}>
                <polygon
                  points={`${xTopLeft},${yTop} ${xTopRight},${yTop} ${xBottomRight},${yBottom} ${xBottomLeft},${yBottom}`}
                  fill={stage.color}
                  opacity={isDimmed ? 0.42 : 1}
                  stroke={isActive ? "#0f766e" : "transparent"}
                  strokeWidth={isActive ? 2 : 0}
                  className="cursor-pointer transition-all"
                  onClick={() => onSelectStage(isActive ? null : stage.name)}
                  onMouseEnter={() => setHoveredStage(stage.name)}
                  onMouseLeave={() => setHoveredStage(null)}
                />
                <text
                  x={chartWidth / 2}
                  y={yTop + segmentHeight / 2 + 6}
                  textAnchor="middle"
                  className="funnel-label"
                  fill="#fff"
                  dominantBaseline="middle"
                >
                  {stage.name} {stage.percent}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="mt-2 rounded-xl border border-whatsapp-line bg-white/80 px-3 py-1.5 text-xs text-whatsapp-muted">
        {focusedStage ? (
          <p>
            <span className="font-semibold text-ink">{focusedStage.name}</span>
            {` - ${focusedStage.count} item(s), ${focusedStage.percent}% of funnel`}
          </p>
        ) : (
          <p>Hover or click a stage to inspect and filter.</p>
        )}
      </div>
    </section>
  );
}
