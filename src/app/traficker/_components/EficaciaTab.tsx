"use client";

// Eficacia del lead — embudo por día de captación: captadas → asistidas → vendidas.
// El traficker ve la CALIDAD del lead (no solo volumen/CPA): de los que pagan el
// 9,99€, cuántos van al diagnóstico y cuántos compran terapia.
import { useEffect, useState, type CSSProperties } from "react";

const PURPLE = "#6A178C";
const GOLD = "#C9922B";
const GREEN = "#0F7A52";

type Daily = { date: string; captadas: number; asistidas: number; vendidas: number; pct_asist: number | null; pct_venta: number | null; inmaduro: boolean };
type Data = {
  days: number; since: string; amelia_ok: boolean;
  totales: { captadas: number; asistidas: number | null; vendidas: number; pct_asist: number | null; pct_venta: number | null; pct_venta_sobre_asist: number | null };
  daily: Daily[];
};

const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
const dow = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("es-ES", { weekday: "short" });

export default function EficaciaTab() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState(30);

  useEffect(() => {
    let alive = true;
    setLoading(true); setErr(null);
    fetch(`/api/traficker/eficacia?days=${days}`, { credentials: "include" })
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (!alive) return; if (!ok) throw new Error(d.message ?? d.error ?? "Error"); setData(d); })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [days]);

  const t = data?.totales;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", padding: "12px 15px", background: "rgba(106,23,140,0.05)", border: `1px solid ${PURPLE}22`, borderRadius: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 20 }}>🎯</span>
          <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5 }}>
            <strong style={{ color: PURPLE }}>Eficacia del lead.</strong> De los que pagan el <strong>9,99€</strong> (captadas), cuántos <strong>asisten</strong> al diagnóstico y cuántos <strong>compran terapia</strong>. Mide la CALIDAD del lead, no solo el volumen. Cohorte por día de captación.
          </div>
        </div>
        <div style={{ display: "inline-flex", padding: 3, borderRadius: 10, background: "#f1f5f9", gap: 2 }}>
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 800, borderRadius: 8, border: "none", cursor: "pointer", fontFamily: "inherit", background: days === d ? PURPLE : "transparent", color: days === d ? "#fff" : "#64748b" }}>{d}d</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Calculando la eficacia del lead…</div>}
      {err && <div style={{ padding: 16, background: "#fef2f2", color: "#991b1b", borderRadius: 12 }}>⚠️ {err}</div>}

      {data && t && (
        <>
          {/* Embudo */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12 }}>
            <FunnelStep n={1} color={PURPLE} label="Captadas" sub="pagaron 9,99€" value={t.captadas} pctOfTop={100} />
            <FunnelStep n={2} color={GOLD} label="Asistidas" sub={data.amelia_ok ? "fueron al diagnóstico" : "Amelia no disponible"} value={data.amelia_ok ? t.asistidas ?? 0 : null} pctOfTop={data.amelia_ok ? t.pct_asist : null} />
            <FunnelStep n={3} color={GREEN} label="Vendidas" sub="compraron terapia" value={t.vendidas} pctOfTop={t.pct_venta} />
          </div>

          {/* Tasas clave */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
            <RateCard label="Tasa de asistencia" value={t.pct_asist != null ? `${t.pct_asist}%` : "n/d"} hint="asistidas / captadas" color={GOLD} />
            <RateCard label="Tasa de venta" value={t.pct_venta != null ? `${t.pct_venta}%` : "—"} hint="vendidas / captadas" color={GREEN} />
            <RateCard label="Venta sobre asistentes" value={t.pct_venta_sobre_asist != null ? `${t.pct_venta_sobre_asist}%` : "n/d"} hint="vendidas / asistidas" color={PURPLE} />
          </div>

          {!data.amelia_ok && (
            <div style={{ fontSize: 11.5, color: "#9a3412", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 10, padding: "9px 12px" }}>
              ⚠️ La asistencia (Amelia) no está disponible ahora mismo; se muestran captadas y ventas. Reintenta en unos minutos.
            </div>
          )}

          {/* Tabla diaria */}
          <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: 16 }}>
            <h3 style={{ margin: "0 0 4px", color: PURPLE, fontSize: 15 }}>Eficacia por día de captación</h3>
            <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "#94a3b8" }}>Cada fila = leads que pagaron el 9,99€ ese día. Asistencia y venta cuentan aunque ocurran días después. <span style={{ color: GOLD }}>◐ inmaduro</span> = captado hace &lt;10 días (aún puede asistir/comprar).</p>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 520 }}>
                <thead>
                  <tr style={{ color: "#94a3b8", textAlign: "left", fontSize: 11 }}>
                    <th style={th}>Día</th>
                    <th style={thr}>Captadas</th>
                    <th style={thr}>Asistidas</th>
                    <th style={thr}>% asist.</th>
                    <th style={thr}>Vendidas</th>
                    <th style={thr}>% venta</th>
                    <th style={{ ...th, width: 120 }}>Embudo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((r) => (
                    <tr key={r.date} style={{ borderTop: "1px solid rgba(0,0,0,0.05)", opacity: r.inmaduro ? 0.62 : 1 }}>
                      <td style={td}>{r.inmaduro && <span title="inmaduro" style={{ color: GOLD }}>◐ </span>}<strong>{fmtDate(r.date)}</strong> <span style={{ color: "#cbd5e1", fontSize: 11 }}>{dow(r.date)}</span></td>
                      <td style={{ ...tdr, fontWeight: 800 }}>{r.captadas}</td>
                      <td style={tdr}>{data.amelia_ok ? r.asistidas : "—"}</td>
                      <td style={{ ...tdr, color: GOLD, fontWeight: 700 }}>{r.pct_asist != null ? `${r.pct_asist}%` : "—"}</td>
                      <td style={tdr}>{r.vendidas}</td>
                      <td style={{ ...tdr, color: GREEN, fontWeight: 800 }}>{r.pct_venta != null ? `${r.pct_venta}%` : "—"}</td>
                      <td style={td}><MiniFunnel cap={r.captadas} asi={data.amelia_ok ? r.asistidas : null} ven={r.vendidas} /></td>
                    </tr>
                  ))}
                  {data.daily.length === 0 && <tr><td colSpan={7} style={{ ...td, color: "#94a3b8", textAlign: "center", padding: 24 }}>Sin captaciones en el periodo.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FunnelStep({ n, color, label, sub, value, pctOfTop }: { n: number; color: string; label: string; sub: string; value: number | null; pctOfTop: number | null }) {
  return (
    <div style={{ background: "#fff", border: `1px solid ${color}33`, borderRadius: 14, padding: 16, position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: color }} />
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
        <span style={{ width: 22, height: 22, borderRadius: 7, background: color, color: "#fff", fontSize: 12, fontWeight: 800, display: "grid", placeItems: "center" }}>{n}</span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#1a1a2e" }}>{label}</span>
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, color, lineHeight: 1 }}>{value != null ? value.toLocaleString("es-ES") : "n/d"}</div>
      <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{sub}{pctOfTop != null && n > 1 ? ` · ${pctOfTop}% de captadas` : ""}</div>
    </div>
  );
}

function RateCard({ label, value, hint, color }: { label: string; value: string; hint: string; color: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color, marginTop: 2 }}>{value}</div>
      <div style={{ fontSize: 10.5, color: "#cbd5e1" }}>{hint}</div>
    </div>
  );
}

function MiniFunnel({ cap, asi, ven }: { cap: number; asi: number | null; ven: number }) {
  const w = (n: number) => (cap > 0 ? Math.max(3, Math.round((n / cap) * 100)) : 0);
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <div style={{ height: 5, borderRadius: 3, width: "100%", background: PURPLE }} />
      {asi != null && <div style={{ height: 5, borderRadius: 3, width: `${w(asi)}%`, background: GOLD }} />}
      <div style={{ height: 5, borderRadius: 3, width: `${w(ven)}%`, background: GREEN }} />
    </div>
  );
}

const th: CSSProperties = { padding: "6px 8px", fontWeight: 700 };
const thr: CSSProperties = { ...th, textAlign: "right" };
const td: CSSProperties = { padding: "8px" };
const tdr: CSSProperties = { padding: "8px", textAlign: "right" };
