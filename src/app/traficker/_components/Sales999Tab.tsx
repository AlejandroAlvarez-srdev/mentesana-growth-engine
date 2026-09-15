"use client";

// Ventas del diagnóstico 9,99€ que entran, con atribución completa por UTM.
// Rango (7/30/90d) o día concreto (histórico). Pipelines visuales por dimensión + filtros cruzados.
//
// Taxonomía UTM del equipo:
//   utm_campaign → CAMPAÑA · utm_source → UBICACIÓN (ej. IG Stories) · utm_medium → ORGÁNICO/PAID
//   utm_content → AUDIENCIA · utm_term → AD
import { useEffect, useMemo, useState } from "react";

const PURPLE = "#6A178C";

type Recent = { id: string; created: number; amount: number; email: string | null; utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string; utm_term: string; landing: string };
type SpendCamp = { campaign: string; spend: number; metaResults: number };
type Daily = { date: string; sales: number; revenue: number; spend: number; cac: number | null };
type Ltv = { buyers: number; matched: number; total_value: number; avg_value: number };
type Resp = { days: number; date?: string | null; count: number; revenue: number; spendByCampaign?: SpendCamp[]; daily?: Daily[]; ltv?: Ltv | null; recent: Recent[] };

// Normaliza nombres de campaña para casar utm_campaign (Stripe) con campaign_name (Meta):
// minúsculas, sin acentos, sin caracteres no alfanuméricos.
const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "");

// Las 5 dimensiones de atribución con la etiqueta de negocio.
const DIMS = [
  { key: "utm_medium", label: "Origen (Paid / Orgánico)", icon: "💳", color: "#16a34a", hint: "paid u orgánico" },
  { key: "utm_campaign", label: "Campaña", icon: "🎯", color: "#6A178C", hint: "" },
  { key: "utm_content", label: "Audiencia", icon: "👥", color: "#0891b2", hint: "" },
  { key: "utm_term", label: "Ad (anuncio)", icon: "🖼️", color: "#db2777", hint: "" },
  { key: "utm_source", label: "Ubicación", icon: "📍", color: "#2563eb", hint: "ej. IG Stories" },
] as const;
type DimKey = (typeof DIMS)[number]["key"];

const isPaid = (medium: string) => /paid|cpc|ppc|cpm|\bads?\b|meta|facebook|\bfb\b|instagram|\big\b|tiktok|social|display/i.test(medium || "");

function fmtTime(unix: number) {
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(unix * 1000));
}
function fmtDayLabel(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", weekday: "short", day: "numeric", month: "long" }).format(new Date(Date.UTC(y, m - 1, day, 12)));
}
function addDays(d: string, n: number) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day + n, 12)));
}

export default function Sales999Tab() {
  const [mode, setMode] = useState<"rango" | "dia">("rango");
  const [days, setDays] = useState(30);
  const [date, setDate] = useState(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date()));
  const [filters, setFilters] = useState<Partial<Record<DimKey, string>>>({});
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

  const all = data?.recent ?? [];
  const val = (r: Recent, k: DimKey) => (r[k] || "").trim() || (k === "utm_medium" ? "organic" : "(sin dato)");
  const activeFilters = useMemo(() => Object.entries(filters).filter(([, v]) => !!v) as [DimKey, string][], [filters]);

  // Feed totalmente filtrado (aplica TODOS los filtros activos).
  const recentF = useMemo(() => all.filter((r) => activeFilters.every(([k, v]) => val(r, k) === v)), [all, activeFilters]);
  const paidCount = recentF.filter((r) => isPaid(r.utm_medium)).length;
  const orgCount = recentF.length - paidCount;

  // CAC: gasto de Meta por campaña (mismo periodo) casado con utm_campaign por nombre normalizado.
  const spendMap = useMemo(() => {
    const m: Record<string, SpendCamp> = {};
    for (const s of data?.spendByCampaign ?? []) m[norm(s.campaign)] = s;
    return m;
  }, [data]);
  const cacFor = (campaignValue: string, count: number): { spend: number; cac: number | null } | null => {
    const sp = spendMap[norm(campaignValue)];
    if (!sp) return null;
    return { spend: sp.spend, cac: count > 0 ? sp.spend / count : null };
  };
  // CAC medio del periodo sobre campañas casadas (usa TODAS las ventas, no el filtro).
  const cacGlobal = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of all) { const c = (r.utm_campaign || "").trim(); if (c) counts[c] = (counts[c] || 0) + 1; }
    let spend = 0, sales = 0, campaigns = 0, unmatched = 0;
    for (const [c, cnt] of Object.entries(counts)) {
      const sp = spendMap[norm(c)];
      if (sp) { spend += sp.spend; sales += cnt; campaigns++; } else unmatched++;
    }
    return { spend: Math.round(spend * 100) / 100, sales, campaigns, unmatched, cac: sales > 0 ? spend / sales : null };
  }, [all, spendMap]);

  // Buckets de una dimensión = datos filtrados por TODAS las OTRAS dimensiones (cross-filter),
  // así puedes re-elegir dentro de la misma dimensión sin vaciarla.
  const bucketsFor = (dimKey: DimKey) => {
    const rows = all.filter((r) => activeFilters.every(([k, v]) => k === dimKey || val(r, k) === v));
    const map: Record<string, { count: number; revenue: number; paid: boolean }> = {};
    for (const r of rows) {
      const key = val(r, dimKey);
      if (!map[key]) map[key] = { count: 0, revenue: 0, paid: dimKey === "utm_medium" ? isPaid(key) : true };
      map[key].count++; map[key].revenue += r.amount;
    }
    return Object.entries(map).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count);
  };

  const anyFilter = activeFilters.length > 0;
  const periodo = mode === "dia" ? fmtDayLabel(date) : `últimos ${days}d`;
  const toggleF = (k: DimKey, v: string) => setFilters((f) => ({ ...f, [k]: f[k] === v ? "" : v }));

  const btn = (active: boolean): React.CSSProperties => ({ padding: "5px 12px", fontSize: 12, fontWeight: 800, borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", background: active ? PURPLE : "#fff", color: active ? "#fff" : "#475569", boxShadow: active ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)" });

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
            {[7, 30, 90].map((d) => (<button key={d} onClick={() => setDays(d)} style={btn(days === d)}>{d}d</button>))}
            <button onClick={() => { setMode("dia"); setDate(today); }} title="Ver cuántas van hoy" style={{ ...btn(false), color: PURPLE, boxShadow: `inset 0 0 0 1.5px ${PURPLE}` }}>📅 Hoy</button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={() => setDate(addDays(date, -1))} title="Día anterior" style={{ padding: "5px 9px", fontSize: 13, fontWeight: 800, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", color: "#475569", cursor: "pointer" }}>‹</button>
            <input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} style={{ padding: "5px 10px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(0,0,0,0.14)", background: "#fff", color: "#1a1a2e", fontFamily: "inherit" }} />
            <button onClick={() => setDate(addDays(date, 1))} disabled={date >= today} title="Día siguiente" style={{ padding: "5px 9px", fontSize: 13, fontWeight: 800, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", color: date >= today ? "#ccc" : "#475569", cursor: date >= today ? "default" : "pointer" }}>›</button>
            <button onClick={() => setDate(today)} style={btn(date === today)}>Hoy</button>
            <button onClick={() => setDate(addDays(today, -1))} style={btn(date === addDays(today, -1))}>Ayer</button>
          </div>
        )}
      </div>

      {err && <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>⚠️ {err}</div>}
      {loading && !data && <div style={{ padding: 12, color: "#888", fontSize: 12 }}>Cargando ventas 9,99€…</div>}

      {data && (
        <>
          {/* Filtros activos (chips) */}
          {anyFilter && (
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 10px", background: "rgba(106,23,140,0.04)", borderRadius: 10, border: `1px solid ${PURPLE}22` }}>
              <span style={{ fontSize: 11.5, fontWeight: 800, color: PURPLE }}>Filtrando:</span>
              {activeFilters.map(([k, v]) => {
                const d = DIMS.find((x) => x.key === k)!;
                return (
                  <span key={k} onClick={() => toggleF(k, v)} style={{ fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: "#fff", border: `1px solid ${d.color}55`, color: d.color, cursor: "pointer" }}>
                    {d.icon} {d.label.split(" ")[0]}: {v} ✕
                  </span>
                );
              })}
              <button onClick={() => setFilters({})} style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 8, border: "none", background: "transparent", color: "#dc2626", cursor: "pointer" }}>Limpiar todo</button>
            </div>
          )}

          {/* KPIs — cuántas van */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <Kpi label={`Ventas 9,99€ · ${periodo}`} value={String(recentF.length)} accent />
            <Kpi label="Ingresos" value={`${recentF.reduce((a, r) => a + r.amount, 0).toLocaleString("es-ES", { minimumFractionDigits: 2 })} €`} />
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,0.06)" }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: "#888" }}>Origen</div>
              <div style={{ display: "flex", gap: 10, marginTop: 4, alignItems: "baseline" }}>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#16a34a" }}>💳 {paidCount}<span style={{ fontSize: 10.5, fontWeight: 600, color: "#888", marginLeft: 3 }}>paid</span></span>
                <span style={{ fontSize: 18, fontWeight: 800, color: "#0891b2" }}>🌱 {orgCount}<span style={{ fontSize: 10.5, fontWeight: 600, color: "#888", marginLeft: 3 }}>org.</span></span>
              </div>
              {/* Barra split paid/orgánico */}
              <div style={{ display: "flex", height: 6, borderRadius: 3, overflow: "hidden", marginTop: 8, background: "#eee" }}>
                <div style={{ width: `${recentF.length ? (paidCount / recentF.length) * 100 : 0}%`, background: "#16a34a" }} />
                <div style={{ width: `${recentF.length ? (orgCount / recentF.length) * 100 : 0}%`, background: "#0891b2" }} />
              </div>
            </div>
            {/* CAC medio del periodo (campañas casadas con Meta) */}
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,0.06)" }} title="Gasto de Meta de campañas casadas ÷ ventas 9,99€ de esas campañas, en el periodo">
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: "#888" }}>CAC medio (paid)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: cacGlobal.cac != null ? PURPLE : "#c0c0c0", marginTop: 2 }}>{cacGlobal.cac != null ? `${cacGlobal.cac.toFixed(2)} €` : "—"}</div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>
                {cacGlobal.cac != null
                  ? `${cacGlobal.campaigns} camp. · ${cacGlobal.spend.toLocaleString("es-ES")}€ gasto${cacGlobal.unmatched ? ` · ${cacGlobal.unmatched} sin casar` : ""}`
                  : "Sin gasto casado con estas ventas"}
              </div>
            </div>
            {/* LTV — valor medio del cliente que entra por el 9,99€ */}
            <div style={{ padding: "12px 14px", borderRadius: 12, background: "#fff", border: "1px solid rgba(0,0,0,0.06)" }} title="Valor medio total (suma de todos sus pagos) de los clientes que entraron por el 9,99€ en este periodo. Aproximado: cruce por email con la tabla de pagos.">
              <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: "#888" }}>Valor medio cliente (LTV)</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: data.ltv && data.ltv.avg_value > 0 ? "#065f46" : "#c0c0c0", marginTop: 2 }}>
                {data.ltv && data.ltv.avg_value > 0 ? `${data.ltv.avg_value.toLocaleString("es-ES", { minimumFractionDigits: 2 })} €` : "—"}
              </div>
              <div style={{ fontSize: 10, color: "#aaa", marginTop: 2 }}>
                {data.ltv && data.ltv.avg_value > 0
                  ? `×${(data.ltv.avg_value / 9.99).toFixed(1)} sobre el 9,99€ · ${data.ltv.matched}/${data.ltv.buyers} casados (aprox.)`
                  : "Sin datos de valor"}
              </div>
            </div>
          </div>

          {/* Evolución diaria: inversión · ventas · CAC */}
          {mode === "rango" && data.daily && data.daily.length > 1 && <DailyChart daily={data.daily} />}

          {/* Pipelines visuales por dimensión */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
            {DIMS.map((d) => (
              <Pipeline key={d.key} dim={d} rows={bucketsFor(d.key)} active={filters[d.key] || ""} onPick={(v) => toggleF(d.key, v)} cacFor={d.key === "utm_campaign" ? cacFor : undefined} />
            ))}
          </div>

          {/* Cómo se calcula el CAC */}
          <div style={{ fontSize: 11.5, color: "#94a3b8", padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px dashed rgba(0,0,0,0.1)" }}>
            💶 <strong>CAC</strong> = gasto de Meta de la campaña ÷ ventas 9,99€ de esa campaña (mismo periodo). Se casa por <em>nombre de campaña</em> = <code>utm_campaign</code>. Si una campaña sale <em>«sin gasto casado»</em>, revisa que el <code>utm_campaign</code> del anuncio coincida con el nombre en Meta. El gasto se toma del último sync de Meta.
          </div>

          {/* Feed */}
          <section>
            <strong style={{ fontSize: 13, color: "#1a1a2e" }}>🧾 Ventas 9,99€ {anyFilter ? "(filtradas)" : ""} <span style={{ fontWeight: 400, color: "#888", fontSize: 11.5 }}>· {recentF.length}</span></strong>
            <div style={{ display: "grid", gap: 5, marginTop: 8 }}>
              {recentF.length === 0 && <div style={{ fontSize: 12, color: "#aaa" }}>Sin ventas con este filtro.</div>}
              {recentF.slice(0, 120).map((r) => (
                <div key={r.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", background: "#fff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: "#888" }}>{fmtTime(r.created)}</span>
                    <span style={{ fontSize: 11.5, color: "#1a1a2e", marginLeft: 8 }}>{r.email ?? "—"}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                    <Tag title="Origen" color={isPaid(r.utm_medium) ? "#16a34a" : "#0891b2"}>{isPaid(r.utm_medium) ? "💳" : "🌱"} {r.utm_medium || "org"}</Tag>
                    {r.utm_campaign && <Tag title="Campaña" color={PURPLE}>🎯 {r.utm_campaign}</Tag>}
                    {r.utm_content && <Tag title="Audiencia" color="#0891b2">👥 {r.utm_content}</Tag>}
                    {r.utm_term && <Tag title="Ad" color="#db2777">🖼️ {r.utm_term}</Tag>}
                    {r.utm_source && <Tag title="Ubicación" color="#2563eb">📍 {r.utm_source}</Tag>}
                    <span style={{ fontSize: 11.5, fontWeight: 800, color: "#065f46" }}>{r.amount.toLocaleString("es-ES", { minimumFractionDigits: 2 })}€</span>
                  </div>
                </div>
              ))}
              {recentF.length > 120 && <div style={{ fontSize: 11, color: "#aaa", textAlign: "center", padding: 4 }}>… y {recentF.length - 120} más</div>}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

// Gráfico de barras diario: inversión (Meta) + ventas 9,99€ agrupadas por día,
// con el CAC bajo cada columna. Scroll horizontal para 30/90 días.
function DailyChart({ daily }: { daily: Daily[] }) {
  const maxSpend = Math.max(1, ...daily.map((d) => d.spend));
  const maxSales = Math.max(1, ...daily.map((d) => d.sales));
  const totSpend = daily.reduce((a, d) => a + d.spend, 0);
  const totSales = daily.reduce((a, d) => a + d.sales, 0);
  const H = 92;
  const short = (d: string) => { const [, m, dd] = d.split("-"); return `${Number(dd)}/${Number(m)}`; };
  const cacColor = (c: number | null) => (c == null ? "#c8c8c8" : c <= 10 ? "#16a34a" : c <= 20 ? "#d97706" : "#dc2626");
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13, color: "#1a1a2e" }}>📈 Evolución diaria</strong>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: PURPLE, display: "inline-block" }} /> Inversión</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: "#16a34a", display: "inline-block" }} /> Ventas</span>
        <span style={{ fontSize: 11, color: "#94a3b8" }}>· CAC = cifra bajo cada día</span>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#94a3b8" }}>{totSpend.toLocaleString("es-ES", { maximumFractionDigits: 0 })}€ · {totSales} ventas</span>
      </div>
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 6, alignItems: "flex-end" }}>
        {daily.map((d) => (
          <div key={d.date} title={`${d.date} · ${d.spend.toLocaleString("es-ES")}€ inversión · ${d.sales} ventas · CAC ${d.cac != null ? d.cac.toFixed(2) + "€" : "—"}`} style={{ flex: "0 0 auto", width: 34, textAlign: "center" }}>
            <div style={{ height: H, display: "flex", gap: 2, alignItems: "flex-end", justifyContent: "center" }}>
              <div style={{ width: 11, height: `${Math.max(d.spend > 0 ? 4 : 0, (d.spend / maxSpend) * H)}px`, background: PURPLE, borderRadius: "3px 3px 0 0" }} />
              <div style={{ width: 11, height: `${Math.max(d.sales > 0 ? 4 : 0, (d.sales / maxSales) * H)}px`, background: "#16a34a", borderRadius: "3px 3px 0 0" }} />
            </div>
            <div style={{ fontSize: 9, color: "#94a3b8", marginTop: 3 }}>{short(d.date)}</div>
            <div style={{ fontSize: 9, fontWeight: 800, color: cacColor(d.cac) }}>{d.cac != null ? `${d.cac.toFixed(0)}€` : "·"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Un "pipeline" = barras embudo (desc) de una dimensión; click filtra.
function Pipeline({ dim, rows, active, onPick, cacFor }: { dim: (typeof DIMS)[number]; rows: { key: string; count: number; revenue: number; paid: boolean }[]; active: string; onPick: (v: string) => void; cacFor?: (key: string, count: number) => { spend: number; cac: number | null } | null }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = rows.reduce((a, r) => a + r.count, 0);
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#1a1a2e" }}>{dim.icon} {dim.label}</span>
        {dim.hint && <span style={{ fontSize: 10.5, color: "#aaa" }}>· {dim.hint}</span>}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#aaa" }}>{rows.length} seg.</span>
      </div>
      <div style={{ display: "grid", gap: 5 }}>
        {rows.length === 0 && <div style={{ fontSize: 11.5, color: "#bbb" }}>Sin datos.</div>}
        {rows.slice(0, 12).map((r) => {
          const pct = total ? Math.round((r.count / total) * 100) : 0;
          const on = active === r.key;
          const barColor = dim.key === "utm_medium" ? (r.paid ? "#16a34a" : "#0891b2") : dim.color;
          return (
            <div key={r.key} onClick={() => onPick(r.key)} title={`Filtrar: ${r.key}`}
              style={{ cursor: "pointer", borderRadius: 8, padding: "5px 7px", background: on ? `${barColor}12` : "transparent", border: `1px solid ${on ? barColor + "55" : "transparent"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 11.5, fontWeight: on ? 800 : 600, color: "#1a1a2e", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "62%" }}>{r.key}</span>
                <span style={{ fontSize: 11.5, whiteSpace: "nowrap" }}><strong style={{ color: barColor }}>{r.count}</strong> <span style={{ color: "#bbb" }}>· {pct}%</span></span>
              </div>
              <div style={{ height: 7, borderRadius: 4, background: "rgba(0,0,0,0.05)", overflow: "hidden" }}>
                <div style={{ width: `${(r.count / max) * 100}%`, height: "100%", background: `linear-gradient(90deg, ${barColor}, ${barColor}bb)`, borderRadius: 4 }} />
              </div>
              {cacFor && (() => {
                const info = cacFor(r.key, r.count);
                if (!info) return <div style={{ fontSize: 9.5, color: "#c8c8c8", marginTop: 3 }}>sin gasto casado</div>;
                return (
                  <div style={{ fontSize: 9.5, color: "#888", marginTop: 3, display: "flex", gap: 8 }}>
                    <span>💶 {info.spend.toLocaleString("es-ES")}€</span>
                    {info.cac != null && <span style={{ fontWeight: 800, color: info.cac <= 10 ? "#16a34a" : info.cac <= 20 ? "#d97706" : "#dc2626" }}>CAC {info.cac.toFixed(2)}€</span>}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Tag({ children, color, title }: { children: React.ReactNode; color: string; title: string }) {
  return <span title={title} style={{ fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: `${color}15`, color, whiteSpace: "nowrap" }}>{children}</span>;
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: accent ? "linear-gradient(135deg, #6A178C, #8B2FB5)" : "#fff", border: accent ? "none" : "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: accent ? "rgba(255,255,255,0.8)" : "#888" }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: accent ? "#fff" : "#1a1a2e", marginTop: 2 }}>{value}</div>
    </div>
  );
}
