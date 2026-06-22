"use client";

import { useMemo, useState } from "react";

const PURPLE = "#6A178C";

export type MonthPoint = {
  month: string;
  spend: number;
  impressions: number;
  ctr: number;
  hook_rate: number | null;
  cost_per_result: number | null;
  roas: number | null;
};

export type Metric = "spend" | "impressions" | "ctr" | "hook_rate" | "cost_per_result" | "roas";

const METRIC_META: Record<Metric, { label: string; suffix: string; emoji: string }> = {
  spend: { label: "Gasto", suffix: "€", emoji: "💰" },
  impressions: { label: "Impresiones", suffix: "", emoji: "👁" },
  ctr: { label: "CTR", suffix: "%", emoji: "🖱" },
  hook_rate: { label: "Hook Rate", suffix: "%", emoji: "🎣" },
  cost_per_result: { label: "CPA", suffix: "€", emoji: "📉" },
  roas: { label: "ROAS", suffix: "x", emoji: "🚀" },
};

export default function MonthlyEvolutionChart({
  data,
  metric,
  onMetricChange,
  height = 240,
}: {
  data: MonthPoint[];
  metric: Metric;
  onMetricChange: (m: Metric) => void;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  const series = useMemo(() => {
    return data.map((d) => {
      const v = d[metric];
      return { month: d.month, value: typeof v === "number" ? v : null };
    });
  }, [data, metric]);

  const W = 800;
  const H = height;
  const PAD_L = 50;
  const PAD_R = 16;
  const PAD_T = 14;
  const PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const nums = series.map((s) => s.value).filter((v): v is number => v != null);
  const maxV = nums.length > 0 ? Math.max(...nums) : 1;
  const minV = nums.length > 0 ? Math.min(0, Math.min(...nums)) : 0;
  const range = maxV - minV || 1;
  const padTop = range * 0.1;
  const yMax = maxV + padTop;
  const yMin = minV;

  const xFor = (i: number) => PAD_L + (series.length <= 1 ? innerW / 2 : (i / (series.length - 1)) * innerW);
  const yFor = (v: number) => PAD_T + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  const fmtVal = (v: number) => {
    const m = METRIC_META[metric];
    if (metric === "impressions") return v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v);
    if (metric === "ctr" || metric === "hook_rate") return `${v.toFixed(2)}${m.suffix}`;
    if (metric === "roas") return `${v.toFixed(2)}x`;
    if (metric === "cost_per_result" || metric === "spend") return `${v.toFixed(0)}${m.suffix}`;
    return `${v}${m.suffix}`;
  };

  const points = series.map((s, i) => (s.value == null ? null : { x: xFor(i), y: yFor(s.value), v: s.value, month: s.month }));
  const validPoints = points.filter((p): p is { x: number; y: number; v: number; month: string } => !!p);

  let path = "";
  let area = "";
  if (validPoints.length > 0) {
    path = validPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
    const first = validPoints[0];
    const last = validPoints[validPoints.length - 1];
    const baseY = yFor(yMin);
    area = `M${first.x.toFixed(1)},${baseY.toFixed(1)} ` + validPoints.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") + ` L${last.x.toFixed(1)},${baseY.toFixed(1)} Z`;
  }

  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTicks);

  const hoverPoint = hover != null ? points[hover] : null;

  return (
    <section style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 14, color: "#1a1a2e", fontWeight: 800 }}>📈 Evolución mensual</h3>
        <select value={metric} onChange={(e) => onMetricChange(e.target.value as Metric)} style={{ padding: "6px 10px", fontSize: 12, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, background: "#fff", fontWeight: 600, color: "#1a1a2e", cursor: "pointer" }}>
          {(Object.keys(METRIC_META) as Metric[]).map((m) => (
            <option key={m} value={m}>{METRIC_META[m].emoji} {METRIC_META[m].label}</option>
          ))}
        </select>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} preserveAspectRatio="none">
        <defs>
          <linearGradient id="evoGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PURPLE} stopOpacity="0.32" />
            <stop offset="100%" stopColor={PURPLE} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD_L} y1={yFor(t)} x2={W - PAD_R} y2={yFor(t)} stroke="rgba(0,0,0,0.06)" strokeDasharray="3 3" />
            <text x={PAD_L - 8} y={yFor(t) + 4} textAnchor="end" fontSize="10" fill="#888">{fmtVal(t)}</text>
          </g>
        ))}

        {area && <path d={area} fill="url(#evoGrad)" />}
        {path && <path d={path} fill="none" stroke={PURPLE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />}

        {validPoints.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="#fff" stroke={PURPLE} strokeWidth="2" />
        ))}

        {series.map((s, i) => (
          <g key={i}>
            <rect x={xFor(i) - innerW / (series.length * 2)} y={PAD_T} width={innerW / series.length} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }} />
            <text x={xFor(i)} y={H - 14} textAnchor="middle" fontSize="10" fill="#888">{s.month.slice(5)}</text>
            <text x={xFor(i)} y={H - 2} textAnchor="middle" fontSize="9" fill="#aaa">{s.month.slice(0, 4)}</text>
          </g>
        ))}

        {hoverPoint && (
          <g pointerEvents="none">
            <circle cx={hoverPoint.x} cy={hoverPoint.y} r="6" fill={PURPLE} />
            <rect x={Math.min(hoverPoint.x - 40, W - 90)} y={hoverPoint.y - 38} width="80" height="28" rx="6" fill="#1a1a2e" />
            <text x={Math.min(hoverPoint.x - 40, W - 90) + 40} y={hoverPoint.y - 20} textAnchor="middle" fontSize="11" fill="#fff" fontWeight="700">{fmtVal(hoverPoint.v)}</text>
          </g>
        )}
      </svg>

      {validPoints.length === 0 && (
        <div style={{ padding: 16, textAlign: "center", color: "#aaa", fontSize: 12 }}>Sin datos para esta métrica</div>
      )}
    </section>
  );
}
