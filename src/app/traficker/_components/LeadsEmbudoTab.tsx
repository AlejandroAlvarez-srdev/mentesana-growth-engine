"use client";
// Leads captados por día, separados por embudo (Diagnóstico 9,99€ vs Cita gratis).
// Son leads que ENTRAN al embudo (no ventas): sirve para ver volumen real de
// captación y cruzarlo con el gasto/rendimiento de los anuncios.
import { useEffect, useState } from "react";

const PURPLE = "#6A178C";
const TEAL = "#0d9488";
type Daily = { date: string; diag: number; cita: number };
type Resp = { days: number; since: string; today: string; totals: { diag: number; cita: number }; daily: Daily[] };

const shortDay = (d: string) => { const [, m, dd] = d.split("-"); return `${Number(dd)}/${Number(m)}`; };

export default function LeadsEmbudoTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    fetch(`/api/traficker/leads-embudo?days=${days}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error ?? `HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [days]);

  const btn = (active: boolean): React.CSSProperties => ({ padding: "5px 12px", fontSize: 12, fontWeight: 800, borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", background: active ? PURPLE : "#fff", color: active ? "#fff" : "#475569", boxShadow: active ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)" });

  const daily = data?.daily ?? [];
  const max = Math.max(1, ...daily.map((d) => Math.max(d.diag, d.cita)));
  const totalLeads = (data?.totals.diag ?? 0) + (data?.totals.cita ?? 0);
  const avgDiag = daily.length ? data!.totals.diag / daily.length : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>Periodo</span>
        {[7, 30, 90].map((d) => (<button key={d} onClick={() => setDays(d)} style={btn(days === d)}>{d}d</button>))}
      </div>

      {err && <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>⚠️ {err}</div>}
      {loading && !data && <div style={{ padding: 12, color: "#888", fontSize: 12 }}>Cargando leads…</div>}

      {data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Kpi label={`Leads Diagnóstico 9,99€ · ${days}d`} value={String(data.totals.diag)} color={PURPLE} accent />
            <Kpi label={`Leads Cita gratis · ${days}d`} value={String(data.totals.cita)} color={TEAL} />
            <Kpi label="Total leads" value={String(totalLeads)} color="#1a1a2e" />
            <Kpi label="Media/día · Diagnóstico" value={avgDiag.toFixed(1)} color="#475569" />
          </div>

          {/* Gráfico de barras agrupadas por día */}
          <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13, color: "#1a1a2e" }}>🧲 Leads/día por embudo</strong>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: PURPLE, display: "inline-block" }} /> Diagnóstico 9,99€</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: TEAL, display: "inline-block" }} /> Cita gratis</span>
              <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>{data.totals.diag} + {data.totals.cita} leads</span>
            </div>
            <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, alignItems: "flex-end" }}>
              {daily.map((d) => (
                <div key={d.date} title={`${d.date} · ${d.diag} diagnóstico · ${d.cita} cita gratis`} style={{ flex: "0 0 auto", width: 30, textAlign: "center" }}>
                  <div style={{ height: 110, display: "flex", gap: 2, alignItems: "flex-end", justifyContent: "center" }}>
                    <div style={{ width: 10, height: `${Math.max(d.diag > 0 ? 3 : 0, (d.diag / max) * 110)}px`, background: PURPLE, borderRadius: "3px 3px 0 0" }} />
                    <div style={{ width: 10, height: `${Math.max(d.cita > 0 ? 3 : 0, (d.cita / max) * 110)}px`, background: TEAL, borderRadius: "3px 3px 0 0" }} />
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 800, color: PURPLE, marginTop: 3 }}>{d.diag}</div>
                  <div style={{ fontSize: 8.5, color: "#94a3b8" }}>{shortDay(d.date)}</div>
                </div>
              ))}
            </div>
          </div>

          {data.totals.cita === 0 && (
            <div style={{ fontSize: 11.5, color: "#94a3b8", padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px dashed rgba(0,0,0,0.1)" }}>
              ℹ️ El embudo de <strong>Cita gratis</strong> no tiene leads en este periodo (está parado desde mediados de septiembre). En cuanto se reactive, aparecerá aquí automáticamente.
            </div>
          )}

          <div style={{ fontSize: 11.5, color: "#94a3b8", padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px dashed rgba(0,0,0,0.1)" }}>
            🧲 <strong>Lead</strong> = alguien que entra al embudo dejando sus datos (envío del test con email en Diagnóstico 9,99€; token de cita en Cita gratis). No es una venta: sirve para ver el volumen de captación real y cruzarlo con el gasto de los anuncios.
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, color, accent }: { label: string; value: string; color: string; accent?: boolean }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: accent ? `linear-gradient(135deg, ${color}, #8B2FB5)` : "#fff", border: accent ? "none" : "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: accent ? "rgba(255,255,255,0.85)" : "#888" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ? "#fff" : color, marginTop: 2 }}>{value}</div>
    </div>
  );
}
