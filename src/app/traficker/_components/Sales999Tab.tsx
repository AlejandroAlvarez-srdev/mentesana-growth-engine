"use client";

// Ventas del diagnóstico 9,99€ que entran, con su fuente/atribución.
import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type Bucket = { key: string; count: number; revenue: number };
type Recent = { id: string; created: number; amount: number; email: string | null; utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string; landing: string };
type Resp = { days: number; count: number; revenue: number; bySource: Bucket[]; byCampaign: Bucket[]; byLanding: Bucket[]; recent: Recent[] };

function fmtTime(unix: number) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(unix * 1000));
}

export default function Sales999Tab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    fetch(`/api/traficker/sales-999?days=${days}`, { credentials: "include" })
      .then((r) => r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error ?? `HTTP ${r.status}`)))
      .then((d) => setData(d))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [days]);

  const maxSource = Math.max(1, ...(data?.bySource ?? []).map((b) => b.count));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Selector de rango */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ fontSize: 12, color: "#888", fontWeight: 600 }}>Rango:</span>
        {[7, 30, 90].map((d) => (
          <button key={d} onClick={() => setDays(d)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 800, borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", background: days === d ? PURPLE : "#fff", color: days === d ? "#fff" : "#475569", boxShadow: days === d ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)" }}>
            {d}d
          </button>
        ))}
      </div>

      {err && <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>⚠️ {err}</div>}
      {loading && !data && <div style={{ padding: 12, color: "#888", fontSize: 12 }}>Cargando ventas 9,99€…</div>}

      {data && (
        <>
          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Kpi label={`Ventas 9,99€ · ${days}d`} value={String(data.count)} accent />
            <Kpi label="Ingresos diagnóstico" value={`${data.revenue.toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`} />
            <Kpi label="Fuentes activas" value={String(data.bySource.length)} />
          </div>

          {/* Por fuente */}
          <section>
            <strong style={{ fontSize: 13, color: "#1a1a2e" }}>📊 Por fuente</strong>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {data.bySource.length === 0 && <div style={{ fontSize: 12, color: "#aaa" }}>Sin ventas en el rango.</div>}
              {data.bySource.map((b) => (
                <div key={b.key} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", background: "#fff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.key}</div>
                    <div style={{ height: 5, background: "rgba(106,23,140,0.08)", borderRadius: 3, marginTop: 4, overflow: "hidden" }}>
                      <div style={{ width: `${(b.count / maxSource) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${PURPLE}, #8B2FB5)` }} />
                    </div>
                  </div>
                  <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: PURPLE }}>{b.count}</span>
                    <span style={{ fontSize: 10.5, color: "#888", marginLeft: 6 }}>{b.revenue.toLocaleString("es-ES")}€</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Por campaña */}
          {data.byCampaign.some((b) => b.key !== "(sin fuente)") && (
            <section>
              <strong style={{ fontSize: 13, color: "#1a1a2e" }}>🎯 Por campaña</strong>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {data.byCampaign.map((b) => (
                  <span key={b.key} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, background: "rgba(106,23,140,0.06)", border: `1px solid ${PURPLE}22`, color: "#475569" }}>
                    {b.key} <strong style={{ color: PURPLE }}>{b.count}</strong>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Feed de últimas ventas */}
          <section>
            <strong style={{ fontSize: 13, color: "#1a1a2e" }}>🧾 Últimas ventas 9,99€</strong>
            <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
              {data.recent.length === 0 && <div style={{ fontSize: 12, color: "#aaa" }}>Sin ventas recientes.</div>}
              {data.recent.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", background: "#fff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#888" }}>{fmtTime(r.created)}</span>
                    <span style={{ fontSize: 11.5, color: "#1a1a2e", marginLeft: 8 }}>{r.email ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                    <span title="Fuente" style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: "rgba(106,23,140,0.1)", color: PURPLE }}>{r.utm_source}</span>
                    <span title="Medio" style={{ fontSize: 10, color: "#888" }}>{r.utm_medium}</span>
                    {r.utm_campaign && <span title="Campaña" style={{ fontSize: 10, color: "#475569", background: "rgba(0,0,0,0.04)", padding: "2px 7px", borderRadius: 4 }}>{r.utm_campaign}</span>}
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: "#065f46" }}>{r.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}€</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: accent ? "linear-gradient(135deg, #6A178C, #8B2FB5)" : "#fff", border: accent ? "none" : "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: accent ? "rgba(255,255,255,0.8)" : "#888" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ? "#fff" : "#1a1a2e", marginTop: 2 }}>{value}</div>
    </div>
  );
}
