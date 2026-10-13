"use client";
// Facturación de bonos por mes, separada por embudo de ORIGEN del cliente
// (diagnóstico 9,99 · cita gratis · desconocido). Best-effort: el bono se
// identifica por importe (€90–€1200) y el origen por customer_origin.
import { useEffect, useState } from "react";

const PURPLE = "#6A178C";
const TEAL = "#0d9488";
const GREY = "#94a3b8";
type Month = { mes: string; diag: number; cita: number; desc: number; rev_diag: number; rev_cita: number; rev_desc: number; total_bonos: number; total_rev: number };
type Resp = { months: number; since: string; monthly: Month[]; totals: { rev_diag: number; rev_cita: number; rev_desc: number; rev_total: number; diag: number; cita: number; desc: number }; pct_diag: number | null };

const eur = (n: number) => `${Math.round(n).toLocaleString("es-ES")} €`;
const monthLabel = (m: string) => { const [y, mm] = m.split("-"); return new Intl.DateTimeFormat("es-ES", { month: "short", year: "2-digit" }).format(new Date(Date.UTC(Number(y), Number(mm) - 1, 12))); };

export default function BonosEmbudoTab() {
  const [months, setMonths] = useState(6);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setErr(null);
    fetch(`/api/traficker/bonos-embudo?months=${months}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : r.json().then((d) => Promise.reject(d.error ?? `HTTP ${r.status}`))))
      .then(setData)
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [months]);

  const btn = (active: boolean): React.CSSProperties => ({ padding: "5px 12px", fontSize: 12, fontWeight: 800, borderRadius: 999, border: "none", cursor: "pointer", fontFamily: "inherit", background: active ? PURPLE : "#fff", color: active ? "#fff" : "#475569", boxShadow: active ? "none" : "inset 0 0 0 1px rgba(0,0,0,0.1)" });

  const monthly = data?.monthly ?? [];
  const maxRev = Math.max(1, ...monthly.map((m) => m.total_rev));
  const t = data?.totals;
  const pctDesc = t && t.rev_total > 0 ? Math.round((t.rev_desc / t.rev_total) * 1000) / 10 : null;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>Periodo</span>
        {[3, 6, 12].map((m) => (<button key={m} onClick={() => setMonths(m)} style={btn(months === m)}>{m} meses</button>))}
      </div>

      {err && <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>⚠️ {err}</div>}
      {loading && !data && <div style={{ padding: 12, color: "#888", fontSize: 12 }}>Cargando facturación de bonos…</div>}

      {data && t && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <Kpi label={`Facturación bonos · ${months}m`} value={eur(t.rev_total)} color={PURPLE} accent />
            <Kpi label={`Diagnóstico 9,99€${data.pct_diag != null ? ` · ${data.pct_diag}%` : ""}`} value={eur(t.rev_diag)} color={PURPLE} />
            <Kpi label={`Cita gratis`} value={eur(t.rev_cita)} color={TEAL} />
            <Kpi label={`Desconocido${pctDesc != null ? ` · ${pctDesc}%` : ""}`} value={eur(t.rev_desc)} color={GREY} />
          </div>

          {/* Barras apiladas de facturación por mes */}
          <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 12, padding: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
              <strong style={{ fontSize: 13, color: "#1a1a2e" }}>💰 Facturación de bonos/mes por embudo</strong>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: PURPLE, display: "inline-block" }} /> Diagnóstico 9,99€</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: TEAL, display: "inline-block" }} /> Cita gratis</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#475569" }}><i style={{ width: 10, height: 10, borderRadius: 2, background: GREY, display: "inline-block" }} /> Desconocido</span>
            </div>
            <div style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 6, alignItems: "flex-end" }}>
              {monthly.map((m) => {
                const H = 150;
                const h = (v: number) => (v / maxRev) * H;
                return (
                  <div key={m.mes} title={`${m.mes} · ${eur(m.total_rev)} · ${m.total_bonos} bonos`} style={{ flex: "0 0 auto", width: 54, textAlign: "center" }}>
                    <div style={{ fontSize: 9.5, fontWeight: 800, color: "#1a1a2e", marginBottom: 3 }}>{eur(m.total_rev)}</div>
                    <div style={{ height: H, display: "flex", flexDirection: "column", justifyContent: "flex-end", borderRadius: "4px 4px 0 0", overflow: "hidden", width: 30, margin: "0 auto", background: "#f1f5f9" }}>
                      <div style={{ height: `${h(m.rev_desc)}px`, background: GREY }} />
                      <div style={{ height: `${h(m.rev_cita)}px`, background: TEAL }} />
                      <div style={{ height: `${h(m.rev_diag)}px`, background: PURPLE }} />
                    </div>
                    <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, fontWeight: 700 }}>{monthLabel(m.mes)}</div>
                    <div style={{ fontSize: 9, color: "#aaa" }}>{m.total_bonos} bonos</div>
                  </div>
                );
              })}
            </div>
          </div>

          {t.rev_cita === 0 && (
            <div style={{ fontSize: 11.5, color: "#94a3b8", padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px dashed rgba(0,0,0,0.1)" }}>
              ℹ️ Apenas hay bonos atribuidos a <strong>Cita gratis</strong>: ese embudo está parado desde mediados de septiembre.
            </div>
          )}

          <div style={{ fontSize: 11, color: "#94a3b8", padding: "8px 12px", background: "#f8fafc", borderRadius: 8, border: "1px dashed rgba(0,0,0,0.1)", lineHeight: 1.5 }}>
            💰 <strong>Bono</strong> = pago de terapia de €90–€1200 (excluye el 9,99€, upsells pequeños y outliers). El <strong>embudo</strong> es el origen de captación del cliente (su primer toque: test/9,99 = diagnóstico, token = cita gratis). <strong>Desconocido</strong> = clientes sin rastro de ninguno de los dos embudos (venta directa, antiguos, B2B…). Es <em>best-effort</em>: la atribución mejora según se va llenando el origen por cliente.
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
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ? "#fff" : color, marginTop: 2 }}>{value}</div>
    </div>
  );
}
