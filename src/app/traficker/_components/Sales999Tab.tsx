"use client";

// Ventas del diagnóstico 9,99€ que entran, con su fuente/atribución.
// Rango (7/30/90d) o día concreto (histórico). Filtro por UTM (fuente + campaña).
import { useEffect, useMemo, useState } from "react";

const PURPLE = "#6A178C";

type Bucket = { key: string; count: number; revenue: number };
type Recent = { id: string; created: number; amount: number; email: string | null; utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string; landing: string };
type Resp = { days: number; date?: string | null; count: number; revenue: number; bySource: Bucket[]; byCampaign: Bucket[]; byLanding: Bucket[]; recent: Recent[] };

function fmtTime(unix: number) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(unix * 1000));
}
function fmtDayLabel(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "long" }).format(new Date(Date.UTC(y, m - 1, day, 12)));
}
function addDays(d: string, n: number) {
  const [y, m, day] = d.split("-").map(Number);
  const nd = new Date(Date.UTC(y, m - 1, day + n, 12));
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(nd);
}

export default function Sales999Tab() {
  const [mode, setMode] = useState<"rango" | "dia">("rango");
  const [days, setDays] = useState(30);
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date()));
  const [utmSource, setUtmSource] = useState("");
  const [utmCampaign, setUtmCampaign] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());

  useEffect(() => {
    setLoading(true); setErr(null);
    const url = mode === "dia" ? `/api/traficker/sales-999?date=${date}` : `/api/traficker/sales-999?days=${days}`;
    fetch(url, { credentials: "include" })
      .then((r) => r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error ?? `HTTP ${r.status}`)))
      .then((d) => setData(d))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [mode, days, date]);

  // Filtro por UTM (fuente + campaña) sobre el feed; el conteo usa el bucket real.
  const recentF = useMemo(() => (data?.recent ?? []).filter((r) =>
    (!utmSource || r.utm_source === utmSource) && (!utmCampaign || r.utm_campaign === utmCampaign)), [data, utmSource, utmCampaign]);
  const filteredCount = utmSource
    ? (data?.bySource.find((b) => b.key === utmSource)?.count ?? 0)
    : utmCampaign ? (data?.byCampaign.find((b) => b.key === utmCampaign)?.count ?? 0)
    : (data?.count ?? 0);
  const filteredRevenue = utmSource
    ? (data?.bySource.find((b) => b.key === utmSource)?.revenue ?? 0)
    : utmCampaign ? (data?.byCampaign.find((b) => b.key === utmCampaign)?.revenue ?? 0)
    : (data?.revenue ?? 0);
  const anyFilter = !!utmSource || !!utmCampaign;
  const maxSource = Math.max(1, ...(data?.bySource ?? []).map((b) => b.count));
  const periodo = mode === "dia" ? fmtDayLabel(date) : `${days}d`;

  const sel: React.CSSProperties = { padding: "5px 10px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "#fff", color: "#1a1a2e", cursor: "pointer", fontFamily: "inherit", maxWidth: 200 };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Modo: rango vs día concreto */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", padding: 3, borderRadius: 10, background: "#f1f5f9", gap: 2 }}>
          {([["rango", "📊 Rango"], ["dia", "📅 Día concreto"]] as const).map(([k, l]) => (
            <button key={k} onClick={() => setMode(k)} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 800, borderRadius: 7, border: "none", background: mode === k ? "#fff" : "transparent", color: mode === k ? PURPLE : "#475569", boxShadow: mode === k ? "0 1px 3px rgba(0,0,0,0.08)" : "none", cursor: "pointer", fontFamily: "inherit" }}>{l}</button>
          ))}
        </div>

        {mode === "rango" ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setDays(d)} style={{ padding: "5px 12px", fontSize: 12, fontWeight: 800, borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", background: days === d ? PURPLE : "#fff", color: days === d ? "#fff" : "#475569", boxShadow: days === d ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)" }}>{d}d</button>
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setDate(addDays(date, -1))} title="Día anterior" style={{ padding: "5px 9px", fontSize: 13, fontWeight: 800, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", color: "#475569", cursor: "pointer" }}>‹</button>
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} style={{ ...sel, maxWidth: 170 }} />
            <button onClick={() => setDate(addDays(date, 1))} disabled={date >= today} title="Día siguiente" style={{ padding: "5px 9px", fontSize: 13, fontWeight: 800, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", color: date >= today ? "#ccc" : "#475569", cursor: date >= today ? "default" : "pointer" }}>›</button>
            <button onClick={() => setDate(today)} style={{ padding: "5px 11px", fontSize: 11.5, fontWeight: 800, borderRadius: 999, border: "none", background: date === today ? PURPLE : "#fff", color: date === today ? "#fff" : "#475569", boxShadow: date === today ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)", cursor: "pointer" }}>Hoy</button>
            <button onClick={() => setDate(addDays(today, -1))} style={{ padding: "5px 11px", fontSize: 11.5, fontWeight: 800, borderRadius: 999, border: "none", background: date === addDays(today, -1) ? PURPLE : "#fff", color: date === addDays(today, -1) ? "#fff" : "#475569", boxShadow: date === addDays(today, -1) ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)", cursor: "pointer" }}>Ayer</button>
          </div>
        )}
      </div>

      {/* Filtro por UTM */}
      {data && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#888", fontWeight: 700 }}>Filtrar UTM:</span>
          <select value={utmSource} onChange={(e) => setUtmSource(e.target.value)} style={sel}>
            <option value="">Todas las fuentes</option>
            {data.bySource.map((b) => <option key={b.key} value={b.key}>{b.key} ({b.count})</option>)}
          </select>
          <select value={utmCampaign} onChange={(e) => setUtmCampaign(e.target.value)} style={sel}>
            <option value="">Todas las campañas</option>
            {data.byCampaign.filter((b) => b.key !== "(sin fuente)").map((b) => <option key={b.key} value={b.key}>{b.key} ({b.count})</option>)}
          </select>
          {anyFilter && <button onClick={() => { setUtmSource(""); setUtmCampaign(""); }} style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", color: "#dc2626", cursor: "pointer" }}>✕ Quitar</button>}
        </div>
      )}

      {err && <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>⚠️ {err}</div>}
      {loading && !data && <div style={{ padding: 12, color: "#888", fontSize: 12 }}>Cargando ventas 9,99€…</div>}

      {data && (
        <>
          {/* KPIs — cuántas van */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Kpi label={`Ventas 9,99€${anyFilter ? " (filtrado)" : ""} · ${periodo}`} value={String(filteredCount)} accent />
            <Kpi label="Ingresos" value={`${filteredRevenue.toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`} />
            {anyFilter
              ? <Kpi label="Total del periodo" value={String(data.count)} />
              : <Kpi label="Fuentes activas" value={String(data.bySource.length)} />}
          </div>

          {/* Por fuente */}
          <section>
            <strong style={{ fontSize: 13, color: "#1a1a2e" }}>📊 Por fuente</strong>
            <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
              {data.bySource.length === 0 && <div style={{ fontSize: 12, color: "#aaa" }}>Sin ventas en el periodo.</div>}
              {data.bySource.map((b) => (
                <div key={b.key} onClick={() => setUtmSource(utmSource === b.key ? "" : b.key)} title="Filtrar por esta fuente"
                  style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center", background: utmSource === b.key ? "rgba(106,23,140,0.06)" : "#fff", border: `1px solid ${utmSource === b.key ? PURPLE + "55" : "rgba(0,0,0,0.06)"}`, borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>
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
                {data.byCampaign.filter((b) => b.key !== "(sin fuente)").map((b) => (
                  <span key={b.key} onClick={() => setUtmCampaign(utmCampaign === b.key ? "" : b.key)} title="Filtrar por esta campaña"
                    style={{ fontSize: 11, padding: "4px 10px", borderRadius: 999, background: utmCampaign === b.key ? PURPLE : "rgba(106,23,140,0.06)", border: `1px solid ${PURPLE}22`, color: utmCampaign === b.key ? "#fff" : "#475569", cursor: "pointer" }}>
                    {b.key} <strong style={{ color: utmCampaign === b.key ? "#fff" : PURPLE }}>{b.count}</strong>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* Feed */}
          <section>
            <strong style={{ fontSize: 13, color: "#1a1a2e" }}>🧾 Ventas 9,99€ {anyFilter ? "(filtradas)" : ""} <span style={{ fontWeight: 400, color: "#888", fontSize: 11.5 }}>· {recentF.length} en el feed</span></strong>
            <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
              {recentF.length === 0 && <div style={{ fontSize: 12, color: "#aaa" }}>Sin ventas con este filtro.</div>}
              {recentF.map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", background: "#fff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#888" }}>{fmtTime(r.created)}</span>
                    <span style={{ fontSize: 11.5, color: "#1a1a2e", marginLeft: 8 }}>{r.email ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                    <span title="Fuente" style={{ fontSize: 10, fontWeight: 800, padding: "2px 8px", borderRadius: 4, background: "rgba(106,23,140,0.1)", color: PURPLE }}>{r.utm_source}</span>
                    <span title="Medio" style={{ fontSize: 10, color: "#888" }}>{r.utm_medium}</span>
                    {r.utm_campaign && <span title="Campaña" style={{ fontSize: 10, color: "#475569", background: "rgba(0,0,0,0.04)", padding: "2px 7px", borderRadius: 4 }}>{r.utm_campaign}</span>}
                    {r.utm_content && <span title="Contenido" style={{ fontSize: 10, color: "#94a3b8" }}>{r.utm_content}</span>}
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
