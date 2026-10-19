"use client";
// Facturación de bonos por periodo, separada por embudo de ORIGEN del cliente
// (diagnóstico 9,99 · cita gratis · desconocido). Best-effort: el bono se
// identifica por importe (€90–€1200) y el origen por la señal de captación más antigua.
// Periodo: calendarios Desde/Hasta (días de Madrid) + atajos (este mes, mes pasado, 3/6/12 meses).
// Barras por día si el rango es corto (≤62 días) y por mes si es largo.
import { useEffect, useState } from "react";

const PURPLE = "#6A178C";
const TEAL = "#0d9488";
const GREY = "#94a3b8";
type Period = { mes: string; diag: number; cita: number; desc: number; rev_diag: number; rev_cita: number; rev_desc: number; total_bonos: number; total_rev: number };
type Resp = { from: string; to: string; gran: "day" | "month"; days: number; monthly: Period[]; totals: { rev_diag: number; rev_cita: number; rev_desc: number; rev_total: number; diag: number; cita: number; desc: number }; pct_diag: number | null };

const eur = (n: number) => `${Math.round(n).toLocaleString("es-ES")} €`;
const periodLabel = (k: string) => {
  const [y, m, d] = k.split("-").map(Number);
  if (d) return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" }).format(new Date(Date.UTC(y, m - 1, d)));
  return new Intl.DateTimeFormat("es-ES", { month: "short", year: "2-digit" }).format(new Date(Date.UTC(y, m - 1, 1)));
};
const fmtDay = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const madridToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
// Rango de N meses naturales hasta hoy (N=1 → este mes).
function rangeMonths(n: number): { from: string; to: string } {
  const today = madridToday();
  const [y, m] = today.split("-").map(Number);
  return { from: isoDay(new Date(Date.UTC(y, m - 1 - (n - 1), 1))), to: today };
}
function rangeLastMonth(): { from: string; to: string } {
  const [y, m] = madridToday().split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1)), last = new Date(Date.UTC(y, m - 1, 0));
  return { from: isoDay(first), to: isoDay(last) };
}

const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: "Este mes", range: () => rangeMonths(1) },
  { label: "Mes pasado", range: rangeLastMonth },
  { label: "3 meses", range: () => rangeMonths(3) },
  { label: "6 meses", range: () => rangeMonths(6) },
  { label: "12 meses", range: () => rangeMonths(12) },
];

export default function BonosEmbudoTab() {
  const [range, setRange] = useState<{ from: string; to: string }>(() => rangeMonths(6));
  const [draft, setDraft] = useState<{ from: string; to: string }>(range);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      setLoading(true); setErr(null);
      fetch(`/api/traficker/bonos-embudo?from=${range.from}&to=${range.to}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error ?? `HTTP ${r.status}`))))
        .then((d) => { if (alive) setData(d); })
        .catch((e) => { if (alive) setErr(String(e)); })
        .finally(() => { if (alive) setLoading(false); });
    });
    return () => { alive = false; };
  }, [range]);

  const apply = (r: { from: string; to: string }) => { setDraft(r); setRange(r); };
  const isActive = (r: { from: string; to: string }) => r.from === range.from && r.to === range.to;
  const draftOk = /^\d{4}-\d{2}-\d{2}$/.test(draft.from) && /^\d{4}-\d{2}-\d{2}$/.test(draft.to) && draft.from <= draft.to;
  const draftDirty = draft.from !== range.from || draft.to !== range.to;

  const btn = (active: boolean): React.CSSProperties => ({ padding: "5px 12px", fontSize: 12, fontWeight: 800, borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", background: active ? PURPLE : "rgba(0,0,0,0.05)", color: active ? "#fff" : "#475569" });
  const dateInput: React.CSSProperties = { padding: "5px 8px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "1.5px solid rgba(0,0,0,0.12)", fontFamily: "inherit", color: "#1a1a2e", background: "#fff" };

  const monthly = data?.monthly ?? [];
  const maxRev = Math.max(1, ...monthly.map((m) => m.total_rev));
  const t = data?.totals;
  const pctDesc = t && t.rev_total > 0 ? Math.round((t.rev_desc / t.rev_total) * 1000) / 10 : null;
  const rangoTxt = data ? `${fmtDay(data.from)} → ${fmtDay(data.to)}` : `${fmtDay(range.from)} → ${fmtDay(range.to)}`;
  const barW = data?.gran === "day" ? 34 : 54;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>Periodo</span>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#475569", fontWeight: 700 }}>
          Desde <input type="date" value={draft.from} max={draft.to || undefined} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} style={dateInput} />
        </label>
        <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, color: "#475569", fontWeight: 700 }}>
          Hasta <input type="date" value={draft.to} min={draft.from || undefined} max={madridToday()} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} style={dateInput} />
        </label>
        <button type="button" disabled={!draftOk || !draftDirty || loading} onClick={() => setRange({ ...draft })} style={{ ...btn(draftOk && draftDirty), opacity: draftOk && draftDirty ? 1 : 0.5, cursor: draftOk && draftDirty ? "pointer" : "not-allowed" }}>Aplicar</button>
        <span style={{ width: 1, height: 18, background: "rgba(0,0,0,0.1)", margin: "0 2px" }} />
        {PRESETS.map((p) => { const r = p.range(); return <button key={p.label} type="button" onClick={() => apply(r)} style={btn(isActive(r))}>{p.label}</button>; })}
      </div>

      {err && <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>⚠️ {err}</div>}
      {loading && !data && <div style={{ padding: 12, color: "#888", fontSize: 12 }}>Cargando facturación de bonos…</div>}

      {data && t && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Kpi label={`Facturación bonos · ${rangoTxt}`} value={eur(t.rev_total)} color={PURPLE} accent sub={`${t.diag + t.cita + t.desc} bonos · ${data.days} días`} />
            <Kpi label={`Diagnóstico 9,99€${data.pct_diag != null ? ` · ${data.pct_diag}%` : ""}`} value={eur(t.rev_diag)} color={PURPLE} sub={`${t.diag} bonos`} />
            <Kpi label={`Cita gratis`} value={eur(t.rev_cita)} color={TEAL} sub={`${t.cita} bonos`} />
            <Kpi label={`Desconocido${pctDesc != null ? ` · ${pctDesc}%` : ""}`} value={eur(t.rev_desc)} color={GREY} sub={`${t.desc} bonos`} />
          </div>

          {/* Barras apiladas de facturación por periodo */}
          <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, padding: 12, opacity: loading ? 0.6 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13, color: "#1a1a2e" }}>💰 Facturación de bonos por {data.gran === "day" ? "día" : "mes"} y embudo</strong>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: PURPLE, display: "inline-block" }} /> Diagnóstico 9,99€</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: TEAL, display: "inline-block" }} /> Cita gratis</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: GREY, display: "inline-block" }} /> Desconocido</span>
            </div>
            <div style={{ display: "flex", gap: data.gran === "day" ? 6 : 12, overflowX: "auto", paddingBottom: 6, alignItems: "flex-end" }}>
              {monthly.map((m) => {
                const H = 150;
                const h = (v: number) => (v / maxRev) * H;
                return (
                  <div key={m.mes} title={`${m.mes} · ${eur(m.total_rev)} · ${m.total_bonos} bonos`} style={{ flex: "0 0 auto", width: barW, textAlign: "center" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: "#1a1a2e", marginBottom: 3, whiteSpace: "nowrap" }}>{m.total_rev > 0 ? eur(m.total_rev) : ""}</div>
                    <div style={{ height: H, display: "flex", flexDirection: "column", justifyContent: "flex-end", borderRadius: "4px 4px 0 0", overflow: "hidden", width: data.gran === "day" ? 20 : 30, margin: "0 auto", background: "#f1f5f9" }}>
                      <div style={{ height: `${h(m.rev_desc)}px`, background: GREY }} />
                      <div style={{ height: `${h(m.rev_cita)}px`, background: TEAL }} />
                      <div style={{ height: `${h(m.rev_diag)}px`, background: PURPLE }} />
                    </div>
                    <div style={{ fontSize: 9.5, color: "#64748b", marginTop: 4, fontWeight: 700, whiteSpace: "nowrap" }}>{periodLabel(m.mes)}</div>
                    <div style={{ fontSize: 9, color: "#aaa" }}>{m.total_bonos > 0 ? `${m.total_bonos}` : ""}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {t.rev_cita === 0 && (
            <div style={{ fontSize: 11.5, color: "#94a3b8", padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px dashed rgba(0,0,0,0.1)" }}>
              ℹ️ No hay bonos atribuidos a <strong>Cita gratis</strong> en este periodo: ese embudo está parado desde mediados de septiembre.
            </div>
          )}

          <div style={{ fontSize: 11, color: "#94a3b8", padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px dashed rgba(0,0,0,0.1)", lineHeight: 1.5 }}>
            💰 <strong>Bono</strong> = pago de terapia de €90–€1200 (excluye el 9,99€, upsells pequeños y outliers). El <strong>embudo</strong> es el origen de captación del cliente (su primera señal: pago 9,99 / test de diagnóstico / cita de bienvenida); sin señal → desconocido. Las fechas son días de Madrid.
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, color, accent, sub }: { label: string; value: string; color: string; accent?: boolean; sub?: string }) {
  return (
    <div style={{ padding: "12px 14px", borderRadius: 12, background: accent ? `linear-gradient(135deg, ${color}, #8B2FB5)` : "#fff", border: accent ? "none" : "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3, color: accent ? "rgba(255,255,255,0.85)" : "#888" }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ? "#fff" : color, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: accent ? "rgba(255,255,255,0.8)" : "#94a3b8", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
