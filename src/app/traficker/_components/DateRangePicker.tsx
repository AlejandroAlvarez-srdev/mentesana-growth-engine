"use client";

const PURPLE = "#6A178C";

export type DateRange = { from: string; to: string; preset?: string };

const PRESETS = [
  { key: "7d", label: "Últimos 7d" },
  { key: "14d", label: "Últimos 14d" },
  { key: "30d", label: "Últimos 30d" },
  { key: "month", label: "Este mes" },
  { key: "lastMonth", label: "Mes pasado" },
  { key: "custom", label: "Custom" },
] as const;

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function presetToRange(preset: string, today = new Date()): DateRange {
  const to = new Date(today);
  to.setHours(0, 0, 0, 0);
  const from = new Date(to);
  if (preset === "7d") from.setDate(from.getDate() - 6);
  else if (preset === "14d") from.setDate(from.getDate() - 13);
  else if (preset === "30d") from.setDate(from.getDate() - 29);
  else if (preset === "month") from.setDate(1);
  else if (preset === "lastMonth") {
    from.setMonth(from.getMonth() - 1, 1);
    to.setDate(0); // último día del mes anterior
  }
  return { from: fmt(from), to: fmt(to), preset };
}

export default function DateRangePicker({
  value,
  onChange,
  compare,
  onCompareChange,
}: {
  value: DateRange;
  onChange: (v: DateRange) => void;
  compare: boolean;
  onCompareChange: (v: boolean) => void;
}) {
  const isCustom = value.preset === "custom";

  return (
    <section style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 12, padding: 10, marginBottom: 12, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, flex: 1, minWidth: 0 }}>
        {PRESETS.map((p) => {
          const active = (value.preset ?? "30d") === p.key;
          return (
            <button
              key={p.key}
              onClick={() => onChange(p.key === "custom" ? { ...value, preset: "custom" } : presetToRange(p.key))}
              style={{
                padding: "6px 12px",
                fontSize: 11.5,
                fontWeight: 700,
                background: active ? PURPLE : "rgba(106,23,140,0.05)",
                color: active ? "#fff" : PURPLE,
                border: "none",
                borderRadius: 999,
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {isCustom && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value, preset: "custom" })} style={inputStyle} />
          <span style={{ color: "#888", fontSize: 12 }}>→</span>
          <input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value, preset: "custom" })} style={inputStyle} />
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 8, borderLeft: "1px solid rgba(0,0,0,0.06)" }}>
        <label htmlFor="cmp-toggle" style={{ fontSize: 11.5, color: "#475569", fontWeight: 600, cursor: "pointer", userSelect: "none" }}>vs período anterior</label>
        <button
          id="cmp-toggle"
          onClick={() => onCompareChange(!compare)}
          aria-pressed={compare}
          style={{
            width: 36,
            height: 20,
            borderRadius: 999,
            border: "none",
            background: compare ? PURPLE : "rgba(0,0,0,0.15)",
            position: "relative",
            cursor: "pointer",
            transition: "background 0.2s",
            padding: 0,
          }}
        >
          <span style={{ position: "absolute", top: 2, left: compare ? 18 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
        </button>
      </div>
    </section>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "5px 8px",
  fontSize: 12,
  border: "1px solid rgba(0,0,0,0.12)",
  borderRadius: 6,
  fontFamily: "inherit",
};
