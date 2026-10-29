"use client";

// Bloque "📱 App" del resumen del traficker: datos propios de la app + eventos del SDK de Meta
// atribuidos a la pauta. Va arriba del todo, antes de "Inversión y resultados".
import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type Counts = { installs: number; registros: number; aperturas: number; compras: number; spend: number };
type Data = {
  days: number;
  app:
    | { available: true; cuentas_total: number; cuentas_nuevas: number; diagnosticos: number; checkouts_tienda: number; activos: number; push_total: number; push_nuevos: number }
    | { available: false; reason: string };
  compras: { n: number; eur: number; n_total: number; eur_total: number; primera: string | null; ultima: string | null; fuente: string };
  pauta:
    | { available: true; spend_app: number; campana_app: Counts; cuenta: Counts; coste_install: number | null; coste_registro: number | null }
    | { available: false; reason: string; spend_app: number };
};

const eur = (n: number, dec = 0) => `${n.toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec })}€`;
const num = (n: number) => n.toLocaleString("es-ES");

function Kpi({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div style={{ padding: 12, background: "#fff", borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

const Title = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 10.5, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 8px" }}>{children}</div>
);
const Grid = ({ children }: { children: React.ReactNode }) => (
  <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>{children}</section>
);

export default function AppMetricsBlock({ days }: { days: number }) {
  // Estado único {days, data, error}: "cargando" se deriva de que el periodo cargado no sea el pedido,
  // así el efecto no llama a setState de forma síncrona (regla react-hooks/set-state-in-effect).
  const [state, setState] = useState<{ days: number | null; data: Data | null; error: string | null }>({ days: null, data: null, error: null });
  const loading = state.days !== days;
  const data = state.data;
  const error = state.error;

  useEffect(() => {
    let alive = true;
    fetch(`/api/traficker/app-metrics?days=${days}`, { credentials: "include" })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Data) => { if (alive) setState({ days, data: d, error: null }); })
      .catch((e) => { if (alive) setState((s) => ({ days, data: s.data, error: String(e?.message ?? e) })); });
    return () => { alive = false; };
  }, [days]);

  const app = data?.app;
  const compras = data?.compras;
  const pauta = data?.pauta;

  return (
    <div style={{ marginBottom: 6 }}>
      <Title>
        📱 App Mente Sana · últimos {days}d {loading && <span style={{ fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>· actualizando…</span>}
        {error && <span style={{ color: "#dc2626", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}> · error: {error}</span>}
      </Title>
      <Grid>
        <Kpi label="📲 Cuentas nuevas" value={app?.available ? num(app.cuentas_nuevas) : "—"} sub={app?.available ? `${num(app.cuentas_total)} cuentas en total` : app ? app.reason : undefined} color={PURPLE} />
        <Kpi label="👥 Usuarios activos" value={app?.available ? num(app.activos) : "—"} sub="con sesión en la app en el periodo" color="#0891b2" />
        <Kpi label="🧠 Diagnósticos en app" value={app?.available ? num(app.diagnosticos) : "—"} sub="completados en el periodo" color="#0891b2" />
        <Kpi
          label="🧾 Compras 9,99 en app"
          value={compras ? num(compras.n) : "—"}
          sub={compras ? `${eur(compras.eur, 2)} · ${num(compras.n_total)} desde el inicio (${eur(compras.eur_total, 2)})` : undefined}
          color="#16a34a"
        />
        <Kpi label="🛒 Checkouts tienda" value={app?.available ? num(app.checkouts_tienda) : "—"} sub="abiertos desde la app" color="#d97706" />
        <Kpi label="🔔 Con push" value={app?.available ? num(app.push_total) : "—"} sub={app?.available ? `${num(app.push_nuevos)} nuevos en el periodo` : undefined} color="#475569" />
      </Grid>

      <Title>📣 App · atribuido a la pauta (SDK de Meta, últimos {days}d)</Title>
      <Grid>
        <Kpi label="💰 Gasto campaña APP" value={pauta ? eur(pauta.spend_app) : "—"} color={PURPLE} />
        <Kpi label="📥 Instalaciones" value={pauta?.available ? num(pauta.campana_app.installs) : "—"} sub={pauta?.available ? `${num(pauta.cuenta.installs)} en toda la cuenta Aux` : pauta ? pauta.reason : undefined} color="#16a34a" />
        <Kpi label="✅ Registros" value={pauta?.available ? num(pauta.campana_app.registros) : "—"} sub={pauta?.available ? `${num(pauta.cuenta.registros)} en toda la cuenta Aux` : undefined} color="#16a34a" />
        <Kpi label="🚀 Aperturas de app" value={pauta?.available ? num(pauta.campana_app.aperturas) : "—"} sub={pauta?.available ? `${num(pauta.cuenta.aperturas)} en toda la cuenta Aux` : undefined} color="#0891b2" />
        <Kpi label="💳 Compras (SDK)" value={pauta?.available ? num(pauta.campana_app.compras) : "—"} sub="la app aún no envía Purchase" color="#d97706" />
        <Kpi
          label="📉 Coste / registro"
          value={pauta?.available && pauta.coste_registro != null ? eur(pauta.coste_registro, 2) : "—"}
          sub={pauta?.available && pauta.coste_install != null ? `${eur(pauta.coste_install, 2)} por instalación` : undefined}
          color={pauta?.available && pauta.coste_registro != null && pauta.coste_registro <= 6 ? "#16a34a" : "#d97706"}
        />
      </Grid>
      <div style={{ fontSize: 10.5, color: "#94a3b8", margin: "-8px 0 14px" }}>
        Compras = pagos del 9,99 hechos desde la app (tabla payments). Instalaciones, registros y aperturas = eventos del SDK atribuidos a anuncios; los totales del SDK de toda la app solo están en el Events Manager de Meta.
      </div>
    </div>
  );
}
