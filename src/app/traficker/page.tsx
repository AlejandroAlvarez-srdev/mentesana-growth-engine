"use client";

import { useEffect, useState } from "react";
import NotificationBell from "@/components/NotificationBell";
import PanelTabs, { usePanelTab } from "@/components/PanelTabs";
import AdPreviewModalNew, { type AdPreviewData } from "./_components/AdPreviewModal";
import DateRangePicker, { type DateRange, presetToRange } from "./_components/DateRangePicker";
import MonthlyEvolutionChart, { type Metric, type MonthPoint } from "./_components/MonthlyEvolutionChart";
import AssignTaskModal from "./_components/AssignTaskModal";
import ActiveAdsStrip from "./_components/ActiveAdsStrip";
import ClinicalInsightsTab from "./_components/ClinicalInsightsTab";
import Sales999Tab from "./_components/Sales999Tab";
import CampaignAITab from "./_components/CampaignAITab";
import { clasificarCampana, EMBUDO_LABEL, type Embudo } from "@/lib/meta-embudos";

const PURPLE = "#6A178C";

// Agrupa los ganadores por EMBUDO (según la nomenclatura de campaña). La agencia
// pidió verlos diferenciados por embudo; la plataforma (IG/FB) requiere el desglose
// por publisher_platform en el sync de Meta (pendiente).
const EMBUDO_ORDER: Embudo[] = ["999", "directo", "cg", "li", "otros", "desconocido"];
function groupWinnersByEmbudo(winners: Winner[]): { embudo: Embudo; label: string; items: Winner[] }[] {
  const map = new Map<Embudo, Winner[]>();
  for (const w of winners) {
    const e = clasificarCampana(w.campaign_name).embudo;
    if (!map.has(e)) map.set(e, []);
    map.get(e)!.push(w);
  }
  return EMBUDO_ORDER.filter((e) => map.has(e)).map((e) => ({ embudo: e, label: EMBUDO_LABEL[e], items: map.get(e)! }));
}

type Account = { id: string; fb_account_id: string; name: string; currency: string | null; business_name: string | null; last_synced_at: string | null };
type AdRow = { fb_ad_id: string; ad_name: string; campaign_name: string; adset_name?: string | null; creative_thumbnail?: string | null; title?: string | null; body?: string | null; cta?: string | null; link_url?: string | null; preview_shareable_link?: string | null; impressions: number; clicks: number; spend: number; ctr: number; frequency: number; thumbstop_rate: number; hook_rate?: number | null; video_avg_watch_sec?: number | null; results: number; cost_per_result: number | null; roas: number | null; effective_status?: string };
type Winner = AdRow & { score: number; reasons: string[]; days?: number };
type UrgentAction = { ad_id: string; ad_name: string; action: string; severity: "critical" | "warning"; reason: string };

export default function TrafickerDashboard() {
  const [me, setMe] = useState<{ name: string; email: string; via_admin?: boolean } | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAcc, setSelectedAcc] = useState<string>("");
  const [dashDays, setDashDays] = useState(30); // ventana del resumen/dashboard (7/30/90d)
  const [dashboard, setDashboard] = useState<{ totals: any; ads: AdRow[]; winners: Winner[]; urgent_actions: UrgentAction[] } | null>(null);
  const [loadingDash, setLoadingDash] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [meta_error, setMetaError] = useState<string | null>(null);
  const [showTokenModal, setShowTokenModal] = useState(false);
  const [diagResult, setDiagResult] = useState<{ steps: any[]; recommendation: string } | null>(null);
  const [pausedIds, setPausedIds] = useState<Set<string>>(new Set());
  const [tab, setTab] = usePanelTab("resumen");
  const [previewAdData, setPreviewAdData] = useState<AdPreviewData | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>(() => presetToRange("30d"));
  const [compareMode, setCompareMode] = useState(false);
  const [evolutionData, setEvolutionData] = useState<MonthPoint[]>([]);
  const [evolutionMetric, setEvolutionMetric] = useState<Metric>("spend");
  const [showAssignTask, setShowAssignTask] = useState(false);

  async function diagnose(accId: string) {
    const r = await fetch("/api/agent/meta/diagnose-account", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: accId }) });
    if (!r.ok) { alert("Error: " + ((await r.json()).message ?? "")); return; }
    setDiagResult(await r.json());
  }

  const loadAccounts = () => fetch("/api/agent/meta/accounts", { credentials: "include" }).then(r => r.json()).then(d => setAccounts(d.accounts ?? []));
  const loadDash = (accId: string, silent = false, daysOverride?: number) => {
    if (!silent) setLoadingDash(true);
    const dd = daysOverride ?? dashDays;
    const url = `/api/agent/meta/dashboard?days=${dd}${accId ? `&account_id=${accId}` : ""}`;
    fetch(url, { credentials: "include" }).then(r => r.json()).then(d => setDashboard(d)).finally(() => { if (!silent) setLoadingDash(false); });
  };

  // Live silent sync: si la cuenta seleccionada no ha sincronizado en >5 min,
  // dispara sync silencioso al cambiar de cuenta. Reusa /api/agent/meta/sync.
  async function liveSync(accId: string, force = false) {
    if (!accId) return;
    const acc = accounts.find(a => a.id === accId);
    if (!force && acc?.last_synced_at) {
      const age = Date.now() - new Date(acc.last_synced_at).getTime();
      if (age < 5 * 60 * 1000) return; // fresco
    }
    try {
      await fetch("/api/agent/meta/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account_id: accId, date_preset: "last_30d" }),
      });
      loadAccounts();
      loadDash(accId, true);
    } catch {}
  }

  useEffect(() => {
    fetch("/api/traficker/whoami", { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!d?.authenticated) { window.location.href = "/traficker/login"; return; } setMe({ ...d.traficker, via_admin: d.via_admin }); });
    const p = new URLSearchParams(window.location.search);
    if (p.get("meta_error")) setMetaError(p.get("meta_error"));
    if (p.get("meta_connected")) { history.replaceState({}, "", "/traficker"); }
    loadAccounts();
    loadDash("");
  }, []);

  // Auto-sync al cambiar cuenta + polling cada 60s para mantener dashboard live.
  useEffect(() => {
    if (!selectedAcc) return;
    void liveSync(selectedAcc);
    const polling = setInterval(() => loadDash(selectedAcc, true), 60_000);
    return () => clearInterval(polling);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAcc, accounts.length]);

  async function logout() {
    if (me?.via_admin) { window.location.href = "/ceo"; return; }
    await fetch("/api/traficker/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/traficker/login";
  }

  function connectMeta() { setShowTokenModal(true); }
  async function sync(accId: string) {
    setSyncing(true);
    const r = await fetch("/api/agent/meta/sync", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: accId, date_preset: "last_30d" }) });
    setSyncing(false);
    const d = await r.json();
    if (!r.ok) { alert("⚠️ " + (d.message ?? "Error")); return; }
    if (d.inserted === 0 && d.message) { alert(d.message); return; }
    alert(d.message ?? `✓ ${d.inserted} insights actualizados`);
    loadAccounts(); loadDash(selectedAcc);
  }
  async function actOn(adId: string, action: "pause" | "resume") {
    if (!selectedAcc) { alert("Selecciona cuenta primero"); return; }
    if (!confirm(`¿${action === "pause" ? "Pausar" : "Reactivar"} este ad?`)) return;
    const r = await fetch("/api/agent/meta/action", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: selectedAcc, fb_object_id: adId, action, reason: "desde panel traficker" }) });
    if (!r.ok) { alert("Error"); return; }
    // Estado optimista: marca el ad como pausado/reanudado al instante.
    setPausedIds(prev => {
      const next = new Set(prev);
      if (action === "pause") next.add(adId); else next.delete(adId);
      return next;
    });
    // Refresca dashboard en background para confirmar el estado real desde Meta.
    setTimeout(() => loadDash(selectedAcc), 2500);
  }

  if (!me) return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>…</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#FFFAF2", fontFamily: "Inter, sans-serif" }}>
      <header style={{ background: "#fff", borderBottom: "1px solid rgba(0,0,0,0.06)", padding: "14px 20px", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ maxWidth: 1300, margin: "0 auto", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 22 }}>📊</span>
            <strong style={{ fontSize: 14, color: PURPLE }}>Traficker · Mente Sana</strong>
          </div>
          <div style={{ flex: 1 }} />
          <NotificationBell api="/api/traficker/notifications" />
          {me.via_admin && <span style={{ fontSize: 10.5, fontWeight: 800, padding: "3px 8px", background: "linear-gradient(135deg, #6A178C, #8B2FB5)", color: "#fff", borderRadius: 999, letterSpacing: 0.5 }}>👑 MODO ADMIN</span>}
          <span style={{ fontSize: 13, color: "#666" }}>👋 {me.name}</span>
          <button onClick={logout} style={{ padding: "6px 12px", fontSize: 11, fontWeight: 700, color: me.via_admin ? "#6A178C" : "#666", background: "transparent", border: `1px solid ${me.via_admin ? "rgba(106,23,140,0.3)" : "rgba(0,0,0,0.1)"}`, borderRadius: 8, cursor: "pointer" }}>{me.via_admin ? "← Volver al CEO" : "Salir"}</button>
        </div>
      </header>

    <main style={{ maxWidth: 1300, margin: "0 auto", padding: "16px 20px 40px" }}>
      {/* ─── Barra de control sticky: cuenta + sync + diagnose ─── */}
      <section style={{ position: "sticky", top: 60, zIndex: 41, background: "rgba(255,250,242,0.95)", backdropFilter: "blur(10px)", marginBottom: 10, padding: "10px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h1 style={{ margin: 0, fontSize: 18, color: "#1a1a2e", fontWeight: 800, marginRight: 6 }}>📊 Meta Ads</h1>
          {accounts.length > 0 ? (
            <>
              <select value={selectedAcc} onChange={e => { setSelectedAcc(e.target.value); loadDash(e.target.value); }} style={{ padding: "9px 12px", fontSize: 13, fontWeight: 600, border: `2px solid ${selectedAcc ? PURPLE : "rgba(0,0,0,0.12)"}`, borderRadius: 10, background: "#fff", fontFamily: "inherit", color: "#1a1a2e", minWidth: 240 }}>
                <option value="">📂 Todas las cuentas</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} {a.currency ? `(${a.currency})` : ""}</option>)}
              </select>
              {selectedAcc && <button onClick={() => sync(selectedAcc)} disabled={syncing} style={{ ...btnSecondary, opacity: syncing ? 0.6 : 1 }}>{syncing ? "↻ Sincronizando…" : "↻ Force sync"}</button>}
              {selectedAcc && <button onClick={() => diagnose(selectedAcc)} style={{ ...btnSecondary, color: "#dc2626", borderColor: "rgba(220,38,38,0.3)" }}>🩺 Diagnosticar</button>}
              {selectedAcc && <LiveBadge lastSyncedAt={accounts.find(x => x.id === selectedAcc)?.last_synced_at ?? null} />}
              <div style={{ flex: 1 }} />
              <a href="/agent/meta-auditor" style={{ padding: "9px 14px", fontSize: 12.5, fontWeight: 800, borderRadius: 8, border: `1.5px solid ${PURPLE}33`, background: "#fff", color: PURPLE, textDecoration: "none", fontFamily: "inherit" }}>🤖 Auditor</a>
              <button onClick={() => setShowAssignTask(true)} style={{ ...btnSecondary, color: PURPLE, borderColor: `${PURPLE}55`, fontWeight: 800 }}>➕ Asignar tarea</button>
              <button onClick={connectMeta} style={{ ...btnSecondary, color: PURPLE, borderColor: `${PURPLE}33` }}>+ Cuenta</button>
            </>
          ) : (
            <button onClick={connectMeta} style={btnPrimary}>+ Conectar cuenta Meta</button>
          )}
        </div>
      </section>

      {meta_error && <div style={{ padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 10, marginBottom: 12, fontSize: 13 }}>⚠️ Error: {meta_error}</div>}

      {accounts.length === 0 ? (
        <div style={{ padding: 40, background: "#fff", borderRadius: 14, textAlign: "center", border: "1px dashed rgba(106,23,140,0.3)", marginTop: 20 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📈</div>
          <h2 style={{ margin: "0 0 6px", color: PURPLE }}>Conecta tu primera cuenta de Meta Ads</h2>
          <p style={{ margin: "0 0 14px", color: "#666", fontSize: 13 }}>Pega un access token (long-lived o System User) y autodetectamos tus cuentas publicitarias.</p>
          <button onClick={() => setShowTokenModal(true)} style={btnPrimary}>+ Pegar token de Meta</button>
          <p style={{ margin: "12px 0 0", fontSize: 11, color: "#888" }}>Genera el token desde Business Manager → System Users → Generate Token (permisos ads_read, ads_management).</p>
        </div>
      ) : (
        <>
          {/* ─── Tabs principal ─── */}
          <PanelTabs
            active={tab}
            onChange={setTab}
            tabs={[
              { key: "resumen", label: "Resumen", emoji: "📊" },
              { key: "winners", label: "Ganadores", emoji: "🏆", badge: dashboard?.winners?.length },
              { key: "ads", label: "Todos los ads", emoji: "📋", badge: dashboard?.ads?.length },
              { key: "evolucion", label: "Evolución", emoji: "📈" },
              { key: "drilldown", label: "Drill-down", emoji: "🔬" },
              { key: "extras", label: "Extras", emoji: "💡" },
              { key: "brief", label: "Daily brief", emoji: "📨" },
              { key: "ventas999", label: "Ventas 9,99€", emoji: "🧾" },
              { key: "campaign_ai", label: "IA campañas", emoji: "🤖" },
              { key: "insights", label: "Insights clínicos", emoji: "🧠" },
              { key: "cuentas", label: "Cuentas", emoji: "⚙️", badge: accounts.length },
            ]}
          />

          {/* ─── Resumen: KPIs + top winners + urgentes preview ─── */}
          {tab === "resumen" && (
            <>
              {/* Selector de periodo del resumen (7/30/90 días) */}
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "#475569" }}>Resumen de:</span>
                <div style={{ display: "inline-flex", padding: 3, borderRadius: 10, background: "#f1f5f9", gap: 2 }}>
                  {[7, 30, 90].map((d) => (
                    <button key={d} onClick={() => { setDashDays(d); loadDash(selectedAcc, false, d); }} style={{ padding: "6px 14px", fontSize: 12, fontWeight: 800, borderRadius: 7, border: "none", background: dashDays === d ? "#fff" : "transparent", color: dashDays === d ? PURPLE : "#475569", boxShadow: dashDays === d ? "0 1px 3px rgba(0,0,0,0.08)" : "none", cursor: "pointer", fontFamily: "inherit" }}>Últimos {d}d</button>
                  ))}
                </div>
                {loadingDash && <span style={{ fontSize: 11, color: "#94a3b8" }}>actualizando…</span>}
              </div>
              <ActiveAdsStrip accountId={selectedAcc} />
              {dashboard?.totals && (
                <>
                  {/* Bloque 1 — Inversión y resultados */}
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 8px" }}>💼 Inversión y resultados</div>
                  <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
                    <Kpi label={`💰 Gasto ${dashDays}d`} value={`${dashboard.totals.spend.toFixed(0)}€`} color={PURPLE} />
                    <Kpi label="📅 Gasto/día" value={dashboard.totals.spend_per_day ? `${dashboard.totals.spend_per_day.toFixed(1)}€` : "—"} color={PURPLE} />
                    <Kpi label="🎯 Conv. Meta (píxel)" value={dashboard.totals.results} color="#16a34a" />
                    <Kpi label="📉 CPA" value={dashboard.totals.cpa ? `${dashboard.totals.cpa.toFixed(2)}€` : "—"} color={dashboard.totals.cpa && dashboard.totals.cpa < 10 ? "#16a34a" : "#d97706"} />
                    <Kpi label="💵 Revenue" value={`${(dashboard.totals.purchase_value ?? 0).toFixed(0)}€`} color="#0891b2" />
                    <Kpi label="🚀 ROAS" value={dashboard.totals.roas ? `${dashboard.totals.roas.toFixed(2)}x` : "—"} color={dashboard.totals.roas && dashboard.totals.roas >= 2 ? "#16a34a" : "#d97706"} />
                  </section>

                  {/* Bloque 2 — Alcance y eficiencia */}
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 8px" }}>📡 Alcance y eficiencia</div>
                  <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
                    <Kpi label="👁 Impresiones" value={dashboard.totals.impressions.toLocaleString("es-ES")} color="#0891b2" />
                    <Kpi label="🌍 Alcance" value={(dashboard.totals.reach ?? 0).toLocaleString("es-ES")} color="#0891b2" />
                    <Kpi label="🔁 Frecuencia" value={dashboard.totals.frequency ? dashboard.totals.frequency.toFixed(2) : "—"} color={dashboard.totals.frequency >= 4 ? "#dc2626" : dashboard.totals.frequency >= 2.5 ? "#d97706" : "#16a34a"} />
                    <Kpi label="💸 CPM" value={dashboard.totals.cpm ? `${dashboard.totals.cpm.toFixed(2)}€` : "—"} color="#475569" />
                    <Kpi label="🖱 CTR" value={`${dashboard.totals.ctr.toFixed(2)}%`} color={dashboard.totals.ctr >= 1.5 ? "#16a34a" : dashboard.totals.ctr >= 0.8 ? "#d97706" : "#dc2626"} />
                    <Kpi label="🛒 CVR" value={dashboard.totals.cvr != null ? `${dashboard.totals.cvr.toFixed(2)}%` : "—"} color={dashboard.totals.cvr != null && dashboard.totals.cvr >= 5 ? "#16a34a" : "#475569"} />
                  </section>

                  {/* Bloque 3 — Performance del creativo */}
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: 0.6, margin: "0 0 8px" }}>🎬 Performance del creativo</div>
                  <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 16 }}>
                    <Kpi label="🎣 Hook Rate" value={dashboard.totals.hook_rate != null ? `${dashboard.totals.hook_rate.toFixed(1)}%` : "—"} color={dashboard.totals.hook_rate != null && dashboard.totals.hook_rate >= 25 ? "#16a34a" : dashboard.totals.hook_rate != null && dashboard.totals.hook_rate < 10 ? "#dc2626" : "#d97706"} />
                    <Kpi label="👆 Thumbstop" value={dashboard.totals.thumbstop_rate ? `${dashboard.totals.thumbstop_rate.toFixed(1)}%` : "—"} color={dashboard.totals.thumbstop_rate >= 25 ? "#16a34a" : "#475569"} />
                    <Kpi label="⏱ AVG Watch" value={dashboard.totals.video_avg_watch_sec != null ? `${dashboard.totals.video_avg_watch_sec.toFixed(1)}s` : "—"} color="#475569" />
                    <Kpi label="▶ Vistas 3s+" value={(dashboard.totals.video_3s_views ?? 0).toLocaleString("es-ES")} color="#0891b2" />
                    <Kpi label="📋 Ads con gasto 30d" value={dashboard.totals.ads_with_spend ?? 0} color={PURPLE} />
                    <Kpi label="🗓 Días" value={dashboard.totals.days_covered ?? 0} color="#475569" />
                  </section>
                </>
              )}
              {dashboard?.urgent_actions && dashboard.urgent_actions.length > 0 && (
                <section style={{ marginBottom: 16, padding: 12, background: "#fff", borderRadius: 12, border: "2px solid #fee2e2" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <strong style={{ color: "#991b1b" }}>🚨 {dashboard.urgent_actions.length} acciones urgentes</strong>
                    <button onClick={() => setTab("urgentes")} style={{ background: "transparent", border: "none", color: "#dc2626", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Ver todas →</button>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: "#666" }}>Tienes ads que deberías pausar o revisar.</p>
                </section>
              )}
              {dashboard?.winners && dashboard.winners.length > 0 && (
                <section style={{ marginBottom: 16, padding: 12, background: "#fff", borderRadius: 12, border: `2px solid ${PURPLE}22` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <strong style={{ color: PURPLE }}>🏆 {dashboard.winners.length} creativos ganadores</strong>
                    <button onClick={() => setTab("winners")} style={{ background: "transparent", border: "none", color: PURPLE, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Ver todos →</button>
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>Top: <strong>{dashboard.winners[0].ad_name}</strong> · Score {dashboard.winners[0].score}</div>
                </section>
              )}
              {loadingDash && <div style={{ color: "#888", padding: 20, textAlign: "center" }}>Cargando…</div>}
              {!loadingDash && dashboard && dashboard.ads.length === 0 && (
                <div style={{ padding: 30, background: "#fff", borderRadius: 12, color: "#666", textAlign: "center" }}>
                  Sin insights aún. Pulsa <strong>↻ Sync 30d</strong> arriba para cargar datos.
                </div>
              )}
            </>
          )}

          {/* ─── Urgentes ─── */}

          {/* ─── Winners ─── */}
          {tab === "winners" && (
            dashboard?.winners && dashboard.winners.length > 0 ? (
              <section>
                <div style={{ fontSize: 11.5, color: "#94a3b8", marginBottom: 10, background: "#f8fafc", border: "1px dashed rgba(0,0,0,0.1)", borderRadius: 8, padding: "8px 12px" }}>
                  🏆 Ganadores <strong>agrupados por embudo</strong> (según la nomenclatura de la campaña). La <strong>plataforma</strong> (IG/FB) aún no se separa: requiere activar el desglose por <code>publisher_platform</code> en el sync de Meta.
                </div>
                {groupWinnersByEmbudo(dashboard.winners).map(g => (
                  <div key={g.embudo} style={{ marginBottom: 16 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 8px" }}>
                      <span style={{ fontSize: 13, fontWeight: 800, color: PURPLE }}>🔻 {g.label}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", background: "rgba(106,23,140,0.06)", padding: "2px 8px", borderRadius: 999 }}>{g.items.length}</span>
                    </div>
                    <div style={{ display: "grid", gap: 8 }}>
                      {g.items.map(w => (
                        <div key={w.fb_ad_id} style={{ padding: 12, background: "#fff", borderRadius: 10, border: `2px solid ${PURPLE}33` }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                            <strong style={{ fontSize: 13 }}>{w.ad_name}</strong>
                            <span style={{ padding: "2px 8px", background: PURPLE, color: "#fff", borderRadius: 6, fontSize: 11, fontWeight: 800 }}>SCORE {w.score}</span>
                          </div>
                          <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{w.campaign_name}</div>
                          <div style={{ display: "flex", gap: 10, fontSize: 11, marginTop: 6, flexWrap: "wrap", color: "#475569" }}>
                            {typeof w.days === "number" && <span title="Días con datos (proxy de días en circulación)">📆 {w.days}d</span>}
                            <span>💰 {w.spend.toFixed(0)}€</span>
                            <span>🖱 CTR {w.ctr.toFixed(2)}%</span>
                            <span>👁 Thumbstop {w.thumbstop_rate.toFixed(1)}%</span>
                            <span>📊 Frec {w.frequency.toFixed(2)}</span>
                            {w.cost_per_result && <span>💵 CPA {w.cost_per_result.toFixed(2)}€</span>}
                            {w.roas && <span>🚀 ROAS {w.roas.toFixed(2)}x</span>}
                          </div>
                          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                            {w.reasons.map((r, i) => <span key={i} style={{ fontSize: 10.5, padding: "2px 6px", background: "rgba(16,185,129,0.14)", color: "#065f46", borderRadius: 4, fontWeight: 700 }}>✓ {r}</span>)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ) : <EmptyTab emoji="🏆" title="Sin ganadores aún" sub="Cuando un ad rinda bien, aparecerá aquí con su score." />
          )}

          {/* ─── Todos los ads ─── */}
          {tab === "ads" && (
            dashboard?.ads && dashboard.ads.length > 0 ? (
              <section>
                <div style={{ background: "#fff", borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)", overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead><tr style={{ background: "rgba(106,23,140,0.04)" }}>
                      <Th>Ad</Th><Th align="center">Estado</Th><Th align="right">Spend</Th><Th align="right">CTR</Th><Th align="right">Frec</Th><Th align="right">Hook</Th><Th align="right">AVG Watch</Th><Th align="right">Thumbstop</Th><Th align="right">CPA</Th><Th align="right">ROAS</Th><Th></Th>
                    </tr></thead>
                    <tbody>
                      {dashboard.ads.slice(0, 100).map(a => {
                        const isPaused = pausedIds.has(a.fb_ad_id) || a.effective_status === "PAUSED";
                        return (
                          <tr key={a.fb_ad_id} style={{ borderTop: "1px solid rgba(0,0,0,0.05)", opacity: isPaused ? 0.55 : 1 }}>
                            <Td><div style={{ fontWeight: 700, textDecoration: isPaused ? "line-through" : undefined }}>{a.ad_name}</div><div style={{ fontSize: 10, color: "#888" }}>{a.campaign_name}</div></Td>
                            <Td align="center">{isPaused ? <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", background: "rgba(0,0,0,0.06)", color: "#475569", borderRadius: 4 }}>⏸ PAUSED</span> : <span style={{ fontSize: 10, fontWeight: 800, padding: "2px 7px", background: "rgba(16,163,74,0.14)", color: "#065f46", borderRadius: 4 }}>● ACTIVE</span>}</Td>
                            <Td align="right">{a.spend.toFixed(0)}€</Td>
                            <Td align="right" style={{ color: a.ctr >= 1.5 ? "#16a34a" : a.ctr < 0.7 ? "#dc2626" : "#475569" }}>{a.ctr.toFixed(2)}%</Td>
                            <Td align="right" style={{ color: a.frequency >= 4 ? "#dc2626" : "#475569" }}>{a.frequency.toFixed(2)}</Td>
                            <Td align="right" style={{ color: a.hook_rate != null && a.hook_rate >= 25 ? "#16a34a" : a.hook_rate != null && a.hook_rate < 10 ? "#dc2626" : "#475569" }}>{a.hook_rate != null ? `${a.hook_rate.toFixed(1)}%` : "—"}</Td>
                            <Td align="right">{a.video_avg_watch_sec != null ? `${a.video_avg_watch_sec.toFixed(1)}s` : "—"}</Td>
                            <Td align="right">{a.thumbstop_rate.toFixed(1)}%</Td>
                            <Td align="right">{a.cost_per_result ? `${a.cost_per_result.toFixed(2)}€` : "—"}</Td>
                            <Td align="right" style={{ color: a.roas && a.roas >= 2 ? "#16a34a" : "#475569" }}>{a.roas ? `${a.roas.toFixed(2)}x` : "—"}</Td>
                            <Td><div style={{ display: "flex", gap: 4 }}><button onClick={() => setPreviewAdData({ fb_ad_id: a.fb_ad_id, ad_name: a.ad_name, campaign_name: a.campaign_name, adset_name: a.adset_name, creative_thumbnail: a.creative_thumbnail, title: a.title, body: a.body, cta: a.cta, link_url: a.link_url, preview_shareable_link: a.preview_shareable_link, spend: a.spend, impressions: a.impressions, ctr: a.ctr, hook_rate: a.hook_rate, video_avg_watch_sec: a.video_avg_watch_sec, results: a.results })} style={{ padding: "4px 8px", fontSize: 10, color: PURPLE, background: "transparent", border: `1px solid ${PURPLE}55`, borderRadius: 4, cursor: "pointer" }}>👁</button>{isPaused ? <button onClick={() => actOn(a.fb_ad_id, "resume")} style={{ padding: "4px 8px", fontSize: 10, color: "#16a34a", background: "transparent", border: "1px solid rgba(16,163,74,0.3)", borderRadius: 4, cursor: "pointer" }}>▶</button> : <button onClick={() => actOn(a.fb_ad_id, "pause")} style={{ padding: "4px 8px", fontSize: 10, color: "#dc2626", background: "transparent", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 4, cursor: "pointer" }}>⏸</button>}</div></Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : <EmptyTab emoji="📋" title="Sin ads cargados" sub="Pulsa ↻ Sync 30d arriba para traerlos desde Meta." />
          )}

          {/* ─── Evolución mensual ─── */}
          {tab === "evolucion" && (
            <EvolutionWrapper
              accountId={selectedAcc}
              data={evolutionData}
              setData={setEvolutionData}
              metric={evolutionMetric}
              setMetric={setEvolutionMetric}
            />
          )}

          {/* ─── Bitácora ─── */}
          {/* ─── Drill-down · Extras · Daily brief · Cuentas ─── */}
          {tab === "drilldown" && <BreakdownDashboard accountId={selectedAcc} />}
          {tab === "extras" && <ExtrasDashboard accountId={selectedAcc} />}
          {tab === "brief" && <DailyBrief accountId={selectedAcc} />}
          {tab === "cuentas" && (
            <section style={{ background: "#fff", borderRadius: 12, padding: 16, border: "1px solid rgba(0,0,0,0.06)" }}>
              <h3 style={{ ...hd, marginTop: 0 }}>Cuentas conectadas ({accounts.length})</h3>
              <div style={{ display: "grid", gap: 6 }}>
                {accounts.map(a => (
                  <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 10, background: "rgba(106,23,140,0.03)", borderRadius: 8, gap: 8, flexWrap: "wrap" }}>
                    <div style={{ minWidth: 200 }}>
                      <strong style={{ fontSize: 13 }}>{a.name}</strong>
                      <div style={{ fontSize: 11, color: "#666" }}>act_{a.fb_account_id}{a.business_name && ` · ${a.business_name}`}{a.currency && ` · ${a.currency}`}</div>
                      {a.last_synced_at && <div style={{ fontSize: 10.5, color: "#888", marginTop: 2 }}>Último sync: {new Date(a.last_synced_at).toLocaleString("es-ES")}</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button onClick={() => sync(a.id)} disabled={syncing} style={{ ...btnSecondary, padding: "5px 10px", fontSize: 11 }}>↻ Sync</button>
                      <button onClick={() => diagnose(a.id)} style={{ ...btnSecondary, padding: "5px 10px", fontSize: 11, color: "#dc2626", borderColor: "rgba(220,38,38,0.3)" }}>🩺</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {tab === "ventas999" && <Sales999Tab />}

          {tab === "campaign_ai" && <CampaignAITab accountId={selectedAcc} />}

          {tab === "insights" && <ClinicalInsightsTab />}
        </>
      )}

      {showTokenModal && <TokenConnectModal onClose={() => setShowTokenModal(false)} onDone={() => { setShowTokenModal(false); loadAccounts(); }} />}
      <AdPreviewModalNew open={!!previewAdData} ad={previewAdData} onClose={() => setPreviewAdData(null)} />
      {showAssignTask && <AssignTaskModal onClose={() => setShowAssignTask(false)} onAssigned={() => alert("✓ Tarea asignada — el destinatario recibirá email + notificación en su panel")} />}
      {/* Unused — DateRangePicker disponible para filtros futuros */}
      {false && <DateRangePicker value={dateRange} onChange={setDateRange} compare={compareMode} onCompareChange={setCompareMode} />}

      {diagResult && (
        <div onClick={() => setDiagResult(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, padding: 24, maxWidth: 640, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
            <h2 style={{ margin: "0 0 14px", fontSize: 19, color: PURPLE }}>🩺 Diagnóstico de la cuenta Meta</h2>
            <div style={{ padding: 14, background: diagResult.recommendation.includes("✅") ? "rgba(16,185,129,0.08)" : diagResult.recommendation.includes("🔴") ? "rgba(220,38,38,0.08)" : "rgba(217,119,6,0.08)", borderRadius: 10, marginBottom: 14, fontSize: 13.5, fontWeight: 700, lineHeight: 1.5 }}>{diagResult.recommendation}</div>
            <div style={{ display: "grid", gap: 6 }}>
              {diagResult.steps.map((s, i) => (
                <div key={i} style={{ padding: 10, background: "#fff", borderRadius: 8, borderLeft: `4px solid ${s.status === "ok" ? "#16a34a" : s.status === "warn" ? "#d97706" : "#dc2626"}`, border: "1px solid rgba(0,0,0,0.06)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                    <strong style={{ fontSize: 12.5 }}>{s.status === "ok" ? "✓" : s.status === "warn" ? "⚠️" : "✗"} {s.name}</strong>
                    <span style={{ fontSize: 9.5, padding: "2px 7px", borderRadius: 4, background: s.status === "ok" ? "rgba(16,163,74,0.14)" : s.status === "warn" ? "rgba(217,119,6,0.14)" : "rgba(220,38,38,0.14)", color: s.status === "ok" ? "#065f46" : s.status === "warn" ? "#92400e" : "#991b1b", fontWeight: 800, textTransform: "uppercase" }}>{s.status}</span>
                  </div>
                  <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.55, wordBreak: "break-word" }}>{s.detail}</div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, textAlign: "right" }}><button onClick={() => setDiagResult(null)} style={{ padding: "9px 18px", background: PURPLE, color: "#fff", border: "none", borderRadius: 8, fontSize: 12.5, fontWeight: 800, cursor: "pointer" }}>Cerrar</button></div>
          </div>
        </div>
      )}

    </main>
    </div>
  );
}

// ─── DASHBOARD EXTRAS · cards adicionales ───
function ExtrasDashboard({ accountId }: { accountId: string }) {
  const [d, setD] = useState<any>(null);
  const [reqAd, setReqAd] = useState<any>(null);
  useEffect(() => {
    const qs = new URLSearchParams({ days: "30" });
    if (accountId) qs.set("account_id", accountId);
    fetch(`/api/agent/meta/insights-extras?${qs}`, { credentials: "include" }).then(r => r.ok ? r.json() : null).then(setD);
  }, [accountId]);
  if (!d || d.spend_total === 0) return null;

  return (
    <section style={{ marginBottom: 22 }}>
      <h2 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>💡 Insights extras · últimos {d.days}d</h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {/* Pixel health */}
        {d.pixel_health.pct !== null && (
          <div style={{ padding: 14, background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)", borderLeft: `4px solid ${d.pixel_health.pct >= 70 ? "#16a34a" : d.pixel_health.pct >= 40 ? "#d97706" : "#dc2626"}` }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 }}>🩺 Pixel Health</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: d.pixel_health.pct >= 70 ? "#16a34a" : d.pixel_health.pct >= 40 ? "#d97706" : "#dc2626", marginTop: 4 }}>{d.pixel_health.pct}%</div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>{d.pixel_health.ads_with_results}/{d.pixel_health.ads_with_spend} ads con conversiones</div>
          </div>
        )}
        {/* CPC + CPM */}
        <div style={{ padding: 14, background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 }}>🖱 CPC medio</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: PURPLE, marginTop: 4 }}>{d.avg_cpc !== null ? `${d.avg_cpc.toFixed(2)}€` : "—"}</div>
          <div style={{ fontSize: 10.5, color: "#666", marginTop: 4 }}>CPM medio · <strong>{d.avg_cpm !== null ? `${d.avg_cpm.toFixed(2)}€` : "—"}</strong></div>
        </div>
        {/* Best day */}
        {d.best_day && (
          <div style={{ padding: 14, background: "#fff", borderRadius: 12, border: "1px solid rgba(16,163,74,0.2)" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 }}>🏆 Mejor día</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#16a34a", marginTop: 4 }}>{new Date(d.best_day.date).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{d.best_day.results} conv · {d.best_day.spend}€{d.best_day.cpa ? ` · ${d.best_day.cpa}€ CPA` : ""}</div>
          </div>
        )}
        {/* Worst day */}
        {d.worst_day && (
          <div style={{ padding: 14, background: "#fff", borderRadius: 12, border: "1px solid rgba(220,38,38,0.2)" }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 }}>📉 Peor día</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: "#dc2626", marginTop: 4 }}>{new Date(d.worst_day.date).toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" })}</div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{d.worst_day.results} conv · {d.worst_day.spend}€{d.worst_day.cpa ? ` · ${d.worst_day.cpa}€ CPA` : ""}</div>
          </div>
        )}
      </div>

      {/* Hidden gems */}
      {d.hidden_gems && d.hidden_gems.length > 0 && (
        <div style={{ marginTop: 14, padding: 14, background: "#fff", borderRadius: 12, border: `1px solid ${PURPLE}22` }}>
          <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 900, color: PURPLE }}>💎 Hidden gems — gastan poco pero rinden mucho</h3>
          <p style={{ margin: "0 0 10px", fontSize: 11, color: "#666" }}>Anuncios con &lt;100€ de gasto y ROAS ≥2x. Pide variaciones o sube presupuesto.</p>
          <div style={{ display: "grid", gap: 5 }}>
            {d.hidden_gems.map((a: any) => (
              <div key={a.fb_ad_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, background: "rgba(106,23,140,0.04)", borderRadius: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 12, color: "#1a1a2e" }}>{a.ad_name}</strong>
                  <div style={{ fontSize: 10.5, color: "#666" }}>{a.spend}€ · CTR {a.ctr.toFixed(2)}% · {a.results} conv</div>
                </div>
                <span style={{ fontSize: 14, fontWeight: 900, color: "#16a34a" }}>{a.roas?.toFixed(2)}x</span>
                <button onClick={() => setReqAd(a)} style={btnRequest}>✨ Pedir variaciones</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Format mix */}
      {d.formats && d.formats.length > 0 && (
        <div style={{ marginTop: 14, padding: 14, background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 900, color: "#1a1a2e" }}>🎬 Formato · gasto y conversiones</h3>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${d.formats.length}, 1fr)`, gap: 10 }}>
            {d.formats.map((f: any) => (
              <div key={f.format} style={{ padding: 10, background: "rgba(0,0,0,0.02)", borderRadius: 8 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase" }}>{f.format} · {f.count} ads</div>
                <div style={{ fontSize: 16, fontWeight: 800, color: PURPLE, marginTop: 4 }}>{f.spend.toFixed(0)}€</div>
                <div style={{ fontSize: 10.5, color: "#666", marginTop: 2 }}>{f.results} conv{f.cpa ? ` · ${f.cpa}€ CPA` : ""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top campañas */}
      {d.top_campaigns && d.top_campaigns.length > 0 && (
        <div style={{ marginTop: 14, padding: 14, background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)" }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 900, color: "#1a1a2e" }}>🚀 Top campañas por gasto</h3>
          <div style={{ display: "grid", gap: 5 }}>
            {d.top_campaigns.map((c: any) => (
              <div key={c.fb_campaign_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: 8, background: "rgba(0,0,0,0.02)", borderRadius: 6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 12 }}>{c.name}</strong>
                  <div style={{ fontSize: 10.5, color: "#666" }}>{c.spend}€ · {c.results} conv{c.cpa ? ` · ${c.cpa}€ CPA` : ""} · CTR {c.ctr.toFixed(2)}%</div>
                </div>
                {c.roas !== null && <span style={{ fontSize: 13, fontWeight: 900, color: c.roas >= 2 ? "#16a34a" : c.roas >= 1 ? "#d97706" : "#dc2626" }}>{c.roas.toFixed(2)}x</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {reqAd && <RequestCreativeModal ad={reqAd} onClose={() => setReqAd(null)} />}
    </section>
  );
}

// ─── PEDIR CREATIVO AL VIDEO MAKER ───
function RequestCreativeModal({ ad, onClose }: { ad: any; onClose: () => void }) {
  const [kind, setKind] = useState("variations");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const kinds = [
    { value: "variations", label: "✨ 3-5 variaciones del ganador" },
    { value: "refresh", label: "🔄 Refresh creativo completo" },
    { value: "testimonial", label: "🎤 Versión testimonio / UGC" },
    { value: "reel_short", label: "⚡ Reel ultra-corto (≤10s)" },
    { value: "image_static", label: "🖼️ Versión estática" },
    { value: "custom", label: "📨 Petición personalizada" },
  ];
  async function send() {
    setBusy(true);
    const r = await fetch("/api/agent/meta/request-creative", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ad_name: ad.ad_name, fb_ad_id: ad.fb_ad_id, note, stats: { spend: ad.spend, ctr: ad.ctr, roas: ad.roas, cpa: ad.cpa, frequency: ad.frequency, results: ad.results } }),
    });
    setBusy(false);
    if (!r.ok) { alert("Error: " + ((await r.json()).message ?? "")); return; }
    const d = await r.json();
    alert(`✓ Tarea creada para video maker (${d.assigned_to}). Llegará a su panel con todo el contexto del anuncio.`);
    onClose();
  }
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 22, maxWidth: 500, width: "100%" }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 18, color: PURPLE }}>📨 Pedir creativo al video maker</h2>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#666" }}>Referencia: <strong>{ad.ad_name}</strong>{ad.roas ? ` · ROAS ${ad.roas.toFixed(2)}x` : ""}</p>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>Tipo de petición</span>
          <select value={kind} onChange={e => setKind(e.target.value)} style={inpModal}>
            {kinds.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </label>
        <label style={{ display: "block", marginBottom: 10 }}>
          <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", marginBottom: 4 }}>Nota / instrucciones extra</span>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={4} placeholder="Ej: enfoca al ángulo 'no decido empezar terapia'. Mantén el hook visual de la primera escena." style={{ ...inpModal, fontFamily: "inherit", resize: "vertical" }} />
        </label>
        <p style={{ margin: 0, fontSize: 11, color: "#888" }}>Se asigna automáticamente al maker con menos tareas hoy (round-robin). Stats del anuncio incluidas en la descripción.</p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button onClick={onClose} style={{ padding: "9px 14px", fontSize: 12.5, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", color: "#475569", cursor: "pointer" }}>Cancelar</button>
          <button onClick={send} disabled={busy} style={{ padding: "9px 18px", fontSize: 12.5, fontWeight: 800, borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${PURPLE}, #8B2FB5)`, color: "#fff", cursor: "pointer", opacity: busy ? 0.5 : 1 }}>{busy ? "Enviando…" : "📨 Pedir al video maker"}</button>
        </div>
      </div>
    </div>
  );
}

const btnRequest: React.CSSProperties = { padding: "5px 10px", fontSize: 10.5, fontWeight: 800, color: "#fff", background: `linear-gradient(135deg, ${PURPLE}, #8B2FB5)`, border: "none", borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap" };
const inpModal: React.CSSProperties = { width: "100%", padding: "9px 12px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, boxSizing: "border-box", fontFamily: "inherit", color: "#1a1a2e" };

// ─── DRILL-DOWN Campañas → Adsets → Ads ───
type AdRow2 = { fb_ad_id: string; name: string; spend: number; impressions: number; clicks: number; ctr: number; frequency: number; thumbstop: number; results: number; cpa: number | null; roas: number | null };
type AdsetRow = { fb_adset_id: string; name: string; spend: number; clicks: number; ctr: number; frequency: number; results: number; cpa: number | null; roas: number | null; ads_count: number; ads: AdRow2[] };
type CampRow = { fb_campaign_id: string; name: string; spend: number; clicks: number; ctr: number; results: number; cpa: number | null; roas: number | null; adsets_count: number; adsets: AdsetRow[] };

function BreakdownDashboard({ accountId }: { accountId: string }) {
  const [range, setRange] = useState<"today" | "yesterday" | "7d" | "30d" | "90d" | "mtd" | "all">("7d");
  const [data, setData] = useState<{ totals: any; campaigns: CampRow[]; startDate: string; endDate: string } | null>(null);
  const [openCamp, setOpenCamp] = useState<string | null>(null);
  const [openAdset, setOpenAdset] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [reqAd, setReqAd] = useState<any>(null);
  const [previewAd, setPreviewAd] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const qs = new URLSearchParams({ range });
    if (accountId) qs.set("account_id", accountId);
    fetch(`/api/agent/meta/breakdown?${qs}`, { credentials: "include" }).then(r => r.ok ? r.json() : null).then(setData).finally(() => setLoading(false));
  }, [range, accountId]);

  async function pauseAd(adId: string) {
    if (!accountId) { alert("Selecciona cuenta arriba"); return; }
    if (!confirm("¿Pausar este anuncio?")) return;
    setActing(adId);
    const r = await fetch("/api/agent/meta/action", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: accountId, fb_object_id: adId, action: "pause", reason: "desde breakdown" }) });
    setActing(null);
    if (!r.ok) { alert("Error"); return; }
    alert("✓ Pausado");
  }

  const t = data?.totals;

  return (
    <section style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 10, marginBottom: 10 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#1a1a2e" }}>📊 Performance · drill-down</h2>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {(["today","yesterday","7d","30d","90d","mtd","all"] as const).map(r => (
            <button key={r} onClick={() => setRange(r)} style={{ padding: "5px 10px", fontSize: 11.5, fontWeight: 700, borderRadius: 6, border: range === r ? `1px solid ${PURPLE}` : "1px solid rgba(0,0,0,0.1)", background: range === r ? PURPLE : "#fff", color: range === r ? "#fff" : "#475569", cursor: "pointer" }}>
              {r === "today" ? "Hoy" : r === "yesterday" ? "Ayer" : r === "mtd" ? "Mes" : r === "all" ? "Todo" : r}
            </button>
          ))}
        </div>
      </div>
      {loading && <div style={{ padding: 20, color: "#888", textAlign: "center" }}>Cargando…</div>}
      {data && (
        <>
          <div style={{ background: "#FEF9C3", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 12px", marginBottom: 10, fontSize: 11.5, color: "#854d0e", lineHeight: 1.45 }}>
            ⚠️ <strong>&quot;Conv&quot; = conversiones que reporta el píxel de Meta</strong>, no ventas verificadas. Las ventas reales del test 9,99€ (cruzadas con Stripe) están en la pestaña <strong>Ventas 9,99€</strong>.
          </div>
          {t && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 12 }}>
              <Tile label="Gasto" value={`${t.spend.toFixed(0)}€`} color={PURPLE} />
              <Tile label="Impresiones" value={t.impressions.toLocaleString("es-ES")} color="#475569" />
              <Tile label="CTR" value={`${t.ctr.toFixed(2)}%`} color={t.ctr >= 1.5 ? "#16a34a" : t.ctr >= 0.8 ? "#d97706" : "#dc2626"} />
              <Tile label="Conv. Meta (píxel)" value={t.results} color="#16a34a" />
              <Tile label="CPA" value={t.cpa !== null ? `${t.cpa.toFixed(2)}€` : "—"} color={t.cpa !== null && t.cpa < 10 ? "#16a34a" : t.cpa !== null && t.cpa < 25 ? "#d97706" : "#dc2626"} />
              <Tile label="ROAS" value={t.roas !== null ? `${t.roas.toFixed(2)}x` : "—"} color={t.roas !== null && t.roas >= 2 ? "#16a34a" : t.roas !== null && t.roas >= 1 ? "#d97706" : "#dc2626"} />
            </div>
          )}
          {data.campaigns.length === 0 ? (
            <div style={{ padding: 30, background: "#fff", borderRadius: 12, color: "#aaa", textAlign: "center" }}>Sin datos en este periodo. Pulsa ↻ Sincronizar arriba.</div>
          ) : (
            <div style={{ background: "#fff", borderRadius: 12, border: "1px solid rgba(0,0,0,0.06)", overflow: "hidden" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 60px 70px 70px 90px 40px", gap: 8, padding: "8px 12px", background: "rgba(106,23,140,0.06)", fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 }}>
                <span>Campaña / Adset / Anuncio</span><span style={{ textAlign: "right" }}>Spend</span><span style={{ textAlign: "right" }}>CTR</span><span style={{ textAlign: "right" }}>Frec</span><span style={{ textAlign: "right" }} title="Conversiones del píxel de Meta, no ventas verificadas">Conv Meta</span><span style={{ textAlign: "right" }}>CPA</span><span style={{ textAlign: "right" }}>ROAS</span><span />
              </div>
              {data.campaigns.map(c => (
                <div key={c.fb_campaign_id} style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                  <div onClick={() => setOpenCamp(openCamp === c.fb_campaign_id ? null : c.fb_campaign_id)} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 60px 70px 70px 90px 40px", gap: 8, padding: "10px 12px", cursor: "pointer", fontSize: 12.5, alignItems: "center", background: openCamp === c.fb_campaign_id ? "rgba(106,23,140,0.03)" : "transparent" }}>
                    <span><span style={{ color: PURPLE, fontWeight: 800, marginRight: 4 }}>{openCamp === c.fb_campaign_id ? "▼" : "▶"}</span><strong>{c.name}</strong> <span style={{ color: "#94a3b8", fontSize: 10.5 }}>· {c.adsets_count} adset(s)</span></span>
                    <span style={{ textAlign: "right", fontWeight: 700 }}>{c.spend.toFixed(0)}€</span>
                    <span style={{ textAlign: "right", color: c.ctr >= 1.5 ? "#16a34a" : c.ctr < 0.7 ? "#dc2626" : "#475569" }}>{c.ctr.toFixed(2)}%</span>
                    <span style={{ textAlign: "right", color: "#94a3b8" }}>—</span>
                    <span style={{ textAlign: "right", fontWeight: 700, color: "#16a34a" }}>{c.results}</span>
                    <span style={{ textAlign: "right" }}>{c.cpa !== null ? `${c.cpa.toFixed(2)}€` : "—"}</span>
                    <span style={{ textAlign: "right", fontWeight: 800, color: c.roas !== null && c.roas >= 2 ? "#16a34a" : "#475569" }}>{c.roas !== null ? `${c.roas.toFixed(2)}x` : "—"}</span>
                    <span />
                  </div>
                  {openCamp === c.fb_campaign_id && c.adsets.map(s => (
                    <div key={s.fb_adset_id}>
                      <div onClick={() => setOpenAdset(openAdset === s.fb_adset_id ? null : s.fb_adset_id)} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 60px 70px 70px 90px 40px", gap: 8, padding: "8px 12px 8px 28px", cursor: "pointer", fontSize: 11.5, alignItems: "center", background: "rgba(0,0,0,0.02)", borderTop: "1px solid rgba(0,0,0,0.04)" }}>
                        <span><span style={{ color: "#0891b2", marginRight: 4 }}>{openAdset === s.fb_adset_id ? "▼" : "▶"}</span>{s.name} <span style={{ color: "#94a3b8", fontSize: 10 }}>· {s.ads_count} ad(s)</span></span>
                        <span style={{ textAlign: "right" }}>{s.spend.toFixed(0)}€</span>
                        <span style={{ textAlign: "right", color: s.ctr >= 1.5 ? "#16a34a" : s.ctr < 0.7 ? "#dc2626" : "#475569" }}>{s.ctr.toFixed(2)}%</span>
                        <span style={{ textAlign: "right", color: s.frequency >= 4 ? "#dc2626" : "#475569" }}>{s.frequency.toFixed(2)}</span>
                        <span style={{ textAlign: "right" }}>{s.results}</span>
                        <span style={{ textAlign: "right" }}>{s.cpa !== null ? `${s.cpa.toFixed(2)}€` : "—"}</span>
                        <span style={{ textAlign: "right", color: s.roas !== null && s.roas >= 2 ? "#16a34a" : "#475569" }}>{s.roas !== null ? `${s.roas.toFixed(2)}x` : "—"}</span>
                        <span />
                      </div>
                      {openAdset === s.fb_adset_id && s.ads.map(ad => (
                        <div key={ad.fb_ad_id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 60px 70px 70px 90px 40px", gap: 8, padding: "7px 12px 7px 44px", fontSize: 11, alignItems: "center", borderTop: "1px solid rgba(0,0,0,0.03)" }}>
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>🎬 {ad.name}{ad.thumbstop ? <span style={{ marginLeft: 6, fontSize: 9.5, color: "#94a3b8" }}>thumb {ad.thumbstop}%</span> : null}</span>
                          <span style={{ textAlign: "right" }}>{ad.spend.toFixed(0)}€</span>
                          <span style={{ textAlign: "right", color: ad.ctr >= 1.5 ? "#16a34a" : ad.ctr < 0.7 ? "#dc2626" : "#475569" }}>{ad.ctr.toFixed(2)}%</span>
                          <span style={{ textAlign: "right", color: ad.frequency >= 4 ? "#dc2626" : "#475569" }}>{ad.frequency.toFixed(2)}</span>
                          <span style={{ textAlign: "right" }}>{ad.results}</span>
                          <span style={{ textAlign: "right" }}>{ad.cpa !== null ? `${ad.cpa.toFixed(2)}€` : "—"}</span>
                          <span style={{ textAlign: "right", fontWeight: 700, color: ad.roas !== null && ad.roas >= 2 ? "#16a34a" : ad.roas !== null && ad.roas < 1 ? "#dc2626" : "#475569" }}>{ad.roas !== null ? `${ad.roas.toFixed(2)}x` : "—"}</span>
                          <button onClick={() => setPreviewAd(ad.fb_ad_id)} title="Ver preview del anuncio" style={{ padding: "2px 6px", fontSize: 10, color: "#0891b2", background: "transparent", border: "1px solid rgba(8,145,178,0.3)", borderRadius: 4, cursor: "pointer", marginRight: 4 }}>👁</button>
                          <button onClick={() => setReqAd({ ad_name: ad.name, fb_ad_id: ad.fb_ad_id, spend: ad.spend, ctr: ad.ctr, roas: ad.roas, cpa: ad.cpa, frequency: ad.frequency, results: ad.results })} title="Pedir creativo al video maker" style={{ padding: "2px 6px", fontSize: 10, color: PURPLE, background: "transparent", border: `1px solid ${PURPLE}55`, borderRadius: 4, cursor: "pointer", marginRight: 4 }}>📨</button>
                          <button onClick={() => pauseAd(ad.fb_ad_id)} disabled={acting === ad.fb_ad_id} style={{ padding: "2px 6px", fontSize: 10, color: "#dc2626", background: "transparent", border: "1px solid rgba(220,38,38,0.3)", borderRadius: 4, cursor: "pointer", opacity: acting === ad.fb_ad_id ? 0.4 : 1 }}>⏸</button>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {previewAd && <AdPreviewModal adId={previewAd} onClose={() => setPreviewAd(null)} />}
    </section>
  );
}

// ─── AD PREVIEW MODAL (Meta Graph API) ───
function AdPreviewModal({ adId, onClose }: { adId: string; onClose: () => void }) {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch(`/api/agent/meta/ad-preview?fb_ad_id=${adId}`, { credentials: "include" })
      .then(async r => r.ok ? r.json() : Promise.reject((await r.json()).message)).then(setD).catch(e => setErr(String(e)));
  }, [adId]);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 22, maxWidth: 720, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 17, color: PURPLE }}>👁 Preview del anuncio</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 18, cursor: "pointer", color: "#94a3b8" }}>×</button>
        </div>
        {err && <div style={{ padding: 12, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12.5 }}>⚠️ {err}</div>}
        {!d && !err && <div style={{ padding: 24, textAlign: "center", color: "#888" }}>Cargando…</div>}
        {d && (
          <>
            <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#666" }}>{d.ad_name}</p>
            {d.creative?.video_url ? <video src={d.creative.video_url} poster={d.creative.video_thumbnail} controls style={{ width: "100%", borderRadius: 10, background: "#000", maxHeight: 500 }} /> : d.creative?.image_url ? <img src={d.creative.image_url} alt={d.ad_name} style={{ width: "100%", borderRadius: 10 }} /> : d.creative?.thumbnail ? <img src={d.creative.thumbnail} alt={d.ad_name} style={{ width: "100%", borderRadius: 10, maxWidth: 400 }} /> : null}
            {(d.creative?.title || d.creative?.body) && (
              <div style={{ marginTop: 12, padding: 12, background: "rgba(0,0,0,0.03)", borderRadius: 8 }}>
                {d.creative.title && <strong style={{ display: "block", fontSize: 13, color: "#1a1a2e", marginBottom: 4 }}>{d.creative.title}</strong>}
                {d.creative.body && <p style={{ margin: 0, fontSize: 12.5, color: "#475569", whiteSpace: "pre-line" }}>{d.creative.body}</p>}
              </div>
            )}
            {d.preview_html && (
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontSize: 11.5, color: PURPLE, fontWeight: 700 }}>📱 Ver preview oficial Meta</summary>
                <div style={{ marginTop: 8, padding: 10, background: "#000", borderRadius: 8, overflow: "auto" }} dangerouslySetInnerHTML={{ __html: d.preview_html }} />
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, color }: { label: string; value: any; color: string }) {
  return <div style={{ padding: 10, background: "#fff", borderRadius: 8, border: "1px solid rgba(0,0,0,0.06)" }}>
    <div style={{ fontSize: 9.5, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
    <div style={{ fontSize: 19, fontWeight: 800, color, marginTop: 3, lineHeight: 1 }}>{value}</div>
  </div>;
}

// ─── Brief diario JARVIS-style para el traficker ───
type DailyAction = { priority: "alta" | "media" | "baja"; emoji: string; title: string; detail: string; ad_id?: string; suggested: "pausar" | "escalar" | "refrescar" | "revisar" | null };
type DailyBriefData = {
  yesterday_summary: { spend: number; results: number; cpa: number | null; roas: number | null; delta_spend_pct: number | null; delta_results_pct: number | null };
  insights: string[];
  actions: DailyAction[];
  summary: { ads_active_week: number; ads_no_conversion: number; spend_week: number; spend_prev_week: number };
};

function DailyBrief({ accountId }: { accountId: string }) {
  const [d, setD] = useState<DailyBriefData | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  // Persistencia local de items finalizados del brief de HOY (se resetea cada día porque la key incluye la fecha)
  const todayKey = `brief-done-traficker-${new Date().toISOString().slice(0, 10)}`;
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { const raw = localStorage.getItem(todayKey); if (raw) setDoneIds(new Set(JSON.parse(raw))); } catch {}
  }, [todayKey]);
  function toggleDone(id: string) {
    setDoneIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem(todayKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  }

  useEffect(() => {
    const url = accountId ? `/api/agent/meta/daily-brief?account_id=${accountId}` : "/api/agent/meta/daily-brief";
    fetch(url, { credentials: "include" }).then(r => r.ok ? r.json() : null).then(setD);
  }, [accountId]);

  async function applyAction(adId: string, action: "pause" | "resume") {
    if (!accountId) { alert("Selecciona una cuenta arriba antes."); return; }
    if (!confirm(`¿${action === "pause" ? "Pausar" : "Reactivar"} este anuncio?`)) return;
    setActing(adId);
    const r = await fetch("/api/agent/meta/action", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account_id: accountId, fb_object_id: adId, action, reason: "desde daily-brief" }) });
    setActing(null);
    alert(r.ok ? "✓ Aplicado" : "Error");
  }

  if (!d) return null;

  const ys = d.yesterday_summary;
  const wdelta = d.summary.spend_prev_week > 0 ? ((d.summary.spend_week - d.summary.spend_prev_week) / d.summary.spend_prev_week) * 100 : null;

  return (
    <section style={{ marginBottom: 22, padding: 18, borderRadius: 16, background: "linear-gradient(135deg, #1a0a1f 0%, #2D0F44 100%)", color: "#fff", boxShadow: "0 12px 32px rgba(106,23,140,0.25)", border: "1px solid rgba(255,215,0,0.2)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 11, fontWeight: 900, color: "#FCD34D", letterSpacing: 2 }}>⚡ BRIEF DIARIO</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", letterSpacing: 1 }}>· {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}</span>
      </div>

      {/* Resumen ayer */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, marginBottom: 14 }}>
        <BriefStat label="Gasto ayer" value={`${ys.spend.toFixed(0)}€`} delta={ys.delta_spend_pct} />
        <BriefStat label="Conversiones" value={ys.results} delta={ys.delta_results_pct} />
        <BriefStat label="CPA" value={ys.cpa !== null ? `${ys.cpa.toFixed(2)}€` : "—"} color={ys.cpa && ys.cpa > 25 ? "#F87171" : ys.cpa && ys.cpa < 10 ? "#10B981" : "#FBBF24"} />
        <BriefStat label="ROAS" value={ys.roas !== null ? `${ys.roas.toFixed(2)}x` : "—"} color={ys.roas && ys.roas >= 2 ? "#10B981" : ys.roas && ys.roas < 1 ? "#F87171" : "#FBBF24"} />
        <BriefStat label="Esta semana" value={`${d.summary.spend_week.toFixed(0)}€`} delta={wdelta} small />
      </div>

      {/* Insights narrativos */}
      {d.insights.length > 0 && (
        <div style={{ marginBottom: 14, padding: 12, background: "rgba(255,255,255,0.04)", borderRadius: 10, borderLeft: "3px solid #FCD34D" }}>
          <div style={{ fontSize: 10, fontWeight: 900, color: "#FCD34D", letterSpacing: 1, marginBottom: 6 }}>🛰️ J.A.R.V.I.S. OBSERVA</div>
          {d.insights.map((ins, i) => (
            <p key={i} style={{ margin: i === 0 ? "0" : "4px 0 0", fontSize: 12.5, color: "rgba(255,255,255,0.92)", lineHeight: 1.5 }}>· {ins}</p>
          ))}
        </div>
      )}

      {/* Acciones priorizadas */}
      <div style={{ fontSize: 11, fontWeight: 800, color: "rgba(255,255,255,0.5)", letterSpacing: 1, marginBottom: 8 }}>📋 ACCIONES DEL DÍA · {d.actions.length}</div>
      {d.actions.length === 0 ? (
        <div style={{ padding: 16, background: "rgba(16,185,129,0.1)", borderRadius: 10, color: "#10B981", fontSize: 13, fontWeight: 700, textAlign: "center" }}>✓ Sin acciones urgentes. Todo en orden, señor.</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {d.actions.map((a, i) => {
            const priColor = a.priority === "alta" ? "#F87171" : a.priority === "media" ? "#FBBF24" : "#94a3b8";
            const sugBg = a.suggested === "escalar" ? "#10B981" : a.suggested === "pausar" ? "#DC2626" : a.suggested === "refrescar" ? "#0891B2" : "#6B7280";
            const itemId = `${a.ad_id ?? a.title}-${i}`;
            const isDone = doneIds.has(itemId);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: 10, background: "rgba(255,255,255,0.04)", borderRadius: 8, borderLeft: `3px solid ${priColor}`, opacity: isDone ? 0.45 : 1, transition: "opacity 0.2s" }}>
                <input type="checkbox" checked={isDone} onChange={() => toggleDone(itemId)} title={isDone ? "Marcar como pendiente" : "Marcar como finalizado"} style={{ width: 17, height: 17, accentColor: "#10B981", cursor: "pointer", flexShrink: 0 }} />
                <span style={{ fontSize: 18 }}>{a.emoji}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 12.5, color: "#fff", textDecoration: isDone ? "line-through" : "none" }}>{a.title}</strong>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.7)", marginTop: 2, textDecoration: isDone ? "line-through" : "none" }}>{a.detail}</div>
                </div>
                {a.suggested && a.ad_id && !isDone && (
                  <button onClick={() => applyAction(a.ad_id!, a.suggested === "escalar" || a.suggested === "refrescar" ? "resume" : "pause")} disabled={acting === a.ad_id} style={{ padding: "5px 11px", fontSize: 11, fontWeight: 800, color: "#fff", background: sugBg, border: "none", borderRadius: 6, cursor: "pointer", textTransform: "uppercase", letterSpacing: 0.5, opacity: acting === a.ad_id ? 0.5 : 1 }}>
                    {a.suggested === "pausar" ? "⏸ Pausar" : a.suggested === "escalar" ? "🚀 Escalar" : a.suggested === "refrescar" ? "🔄 Refresh" : "Revisar"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function BriefStat({ label, value, delta, color, small }: { label: string; value: any; delta?: number | null; color?: string; small?: boolean }) {
  const dc = delta === null || delta === undefined ? null : delta >= 0 ? "#10B981" : "#F87171";
  return (
    <div>
      <div style={{ fontSize: 9.5, fontWeight: 800, color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: small ? 18 : 24, fontWeight: 900, color: color ?? "#fff", lineHeight: 1, letterSpacing: -0.5 }}>{value}</div>
      {dc && delta !== null && delta !== undefined && (
        <div style={{ fontSize: 11, color: dc, marginTop: 3, fontWeight: 700 }}>{delta >= 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(0)}%</div>
      )}
    </div>
  );
}

function TokenConnectModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [token, setToken] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [accountId, setAccountId] = useState("");
  const [preview, setPreview] = useState<{ me: any; accounts: any[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function check() {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/agent/meta/manual-connect?token=${encodeURIComponent(token)}`, { credentials: "include" });
    setBusy(false);
    if (!r.ok) { setErr(((await r.json()).message ?? "Token inválido")); return; }
    const d = await r.json();
    setPreview({ me: d.me, accounts: d.accounts });
    setSelected(new Set(d.accounts.map((a: any) => a.fb_account_id)));
  }

  async function saveDirect() {
    setBusy(true); setErr(null);
    const r = await fetch("/api/agent/meta/save-direct", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ad_account_id: accountId, expires_at: expiresAt || null }) });
    setBusy(false);
    if (!r.ok) { setErr(((await r.json()).message ?? "Error")); return; }
    const d = await r.json();
    alert(`✓ Cuenta vinculada: ${d.account.name} (${d.account.currency})`);
    onDone();
  }

  async function save() {
    setBusy(true);
    const r = await fetch("/api/agent/meta/manual-connect", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, expires_at: expiresAt || null, fb_account_ids: [...selected] }) });
    setBusy(false);
    if (!r.ok) { setErr(((await r.json()).message ?? "Error")); return; }
    const d = await r.json();
    alert(`✓ Guardado: ${d.saved} cuentas vinculadas (token de ${d.fb_user})`);
    onDone();
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 22, maxWidth: 560, width: "100%", maxHeight: "90vh", overflow: "auto" }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, color: PURPLE }}>Conectar Meta Ads con token</h2>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#666" }}>Pega un access token. Si el modo automático falla, usa el manual con el ad account ID.</p>

        <div style={{ display: "flex", gap: 4, marginBottom: 12, background: "rgba(0,0,0,0.04)", padding: 4, borderRadius: 8, width: "fit-content" }}>
          <button onClick={() => setMode("auto")} style={{ padding: "6px 12px", fontSize: 11.5, fontWeight: 700, borderRadius: 6, border: "none", background: mode === "auto" ? "#fff" : "transparent", color: mode === "auto" ? PURPLE : "#666", cursor: "pointer" }}>🔍 Auto-detectar cuentas</button>
          <button onClick={() => setMode("manual")} style={{ padding: "6px 12px", fontSize: 11.5, fontWeight: 700, borderRadius: 6, border: "none", background: mode === "manual" ? "#fff" : "transparent", color: mode === "manual" ? PURPLE : "#666", cursor: "pointer" }}>✋ Manual (account ID)</button>
        </div>

        <label style={{ display: "block", marginBottom: 8 }}>
          <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Access token *</span>
          <textarea value={token} onChange={e => setToken(e.target.value)} placeholder="EAAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx…" rows={3} style={{ width: "100%", padding: "8px 10px", fontSize: 11, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontFamily: "ui-monospace, monospace", color: "#1a1a2e", boxSizing: "border-box", resize: "vertical" }} />
        </label>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Fecha caducidad (opcional)</span>
          <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} style={{ padding: "8px 10px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8 }} />
        </label>

        {err && <div style={{ padding: 10, background: "#fef2f2", color: "#991b1b", borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>⚠️ {err}</div>}

        {mode === "manual" ? (
          <>
            <label style={{ display: "block", marginBottom: 8 }}>
              <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>Ad Account ID *</span>
              <input value={accountId} onChange={e => setAccountId(e.target.value)} placeholder="REDACTED_ID (sin el prefijo act_)" style={{ width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, boxSizing: "border-box" }} />
              <span style={{ fontSize: 10.5, color: "#888", marginTop: 4, display: "block" }}>Lo encuentras en Ads Manager → arriba a la izquierda junto al nombre de la cuenta (números después de "act_").</span>
            </label>
            <button onClick={saveDirect} disabled={!token || !accountId || busy} style={{ padding: "9px 14px", fontSize: 12.5, fontWeight: 800, borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${PURPLE}, #8B2FB5)`, color: "#fff", cursor: "pointer", opacity: !token || !accountId || busy ? 0.5 : 1 }}>{busy ? "Verificando…" : "✓ Conectar esta cuenta"}</button>
          </>
        ) : !preview ? (
          <button onClick={check} disabled={!token || busy} style={{ ...btnPrimary, opacity: !token || busy ? 0.5 : 1 }}>{busy ? "Verificando…" : "🔍 Verificar token y listar cuentas"}</button>
        ) : (
          <>
            <div style={{ padding: 10, background: "rgba(16,185,129,0.08)", borderRadius: 8, marginBottom: 10, fontSize: 12.5, color: "#065f46" }}>
              ✓ Token válido — <strong>{preview.me.name}</strong> · {preview.accounts.length} cuentas disponibles
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 12, color: "#888", fontWeight: 800, textTransform: "uppercase" }}>Selecciona cuentas a vincular</h3>
            <div style={{ display: "grid", gap: 4, maxHeight: 240, overflowY: "auto", marginBottom: 12 }}>
              {preview.accounts.map(a => (
                <label key={a.fb_account_id} style={{ display: "flex", alignItems: "center", gap: 8, padding: 8, background: selected.has(a.fb_account_id) ? "rgba(106,23,140,0.05)" : "rgba(0,0,0,0.02)", borderRadius: 6, cursor: "pointer" }}>
                  <input type="checkbox" checked={selected.has(a.fb_account_id)} onChange={() => { const n = new Set(selected); n.has(a.fb_account_id) ? n.delete(a.fb_account_id) : n.add(a.fb_account_id); setSelected(n); }} style={{ accentColor: PURPLE }} />
                  <div style={{ flex: 1 }}>
                    <strong style={{ fontSize: 12.5 }}>{a.name}</strong>
                    <div style={{ fontSize: 10.5, color: "#666" }}>act_{a.fb_account_id}{a.currency && ` · ${a.currency}`}{a.business_name && ` · ${a.business_name}`}</div>
                  </div>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => { setPreview(null); setSelected(new Set()); }} style={btnSecondary}>← Cambiar token</button>
              <button onClick={save} disabled={busy || selected.size === 0} style={{ ...btnPrimary, opacity: busy || selected.size === 0 ? 0.5 : 1 }}>{busy ? "Guardando…" : `✓ Vincular ${selected.size} cuenta${selected.size === 1 ? "" : "s"}`}</button>
            </div>
          </>
        )}

        <p style={{ margin: "14px 0 0", fontSize: 10.5, color: "#888", lineHeight: 1.5 }}>
          💡 <strong>Cómo generar el token correcto</strong>:<br/>
          1. Business Manager → <strong>Configuración del negocio</strong><br/>
          2. <strong>Usuarios del sistema</strong> → click en tu System User<br/>
          3. Pestaña <strong>Activos asignados</strong> → añade la <strong>Ad Account</strong> con permiso "Administrar campañas"<br/>
          4. Botón <strong>Generar nuevo token</strong> → app de la empresa → scopes <code>ads_management</code> + <code>ads_read</code> + <code>business_management</code><br/>
          5. Copia el token COMPLETO (es muy largo) y pégalo aquí<br/><br/>
          ⚠️ Si sigue fallando: usa modo <strong>Manual</strong> arriba y pega el ID de la cuenta directamente.
        </p>
      </div>
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: any; color: string }) {
  return <div style={{ padding: 12, background: "#fff", borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)" }}>
    <div style={{ fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
    <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 4, lineHeight: 1 }}>{value}</div>
  </div>;
}
const Th = ({ children, align = "left" }: { children?: React.ReactNode; align?: "left" | "center" | "right" }) => <th style={{ padding: "8px 10px", textAlign: align, fontSize: 10, fontWeight: 800, color: "#888", textTransform: "uppercase", letterSpacing: 0.4 }}>{children}</th>;
const Td = ({ children, align = "left", style }: { children?: React.ReactNode; align?: "left" | "center" | "right"; style?: React.CSSProperties }) => <td style={{ padding: "8px 10px", textAlign: align, verticalAlign: "middle", ...style }}>{children}</td>;
function EmptyTab({ emoji, title, sub }: { emoji: string; title: string; sub: string }) {
  return (
    <div style={{ padding: "50px 20px", background: "#fff", borderRadius: 14, textAlign: "center", border: "1px dashed rgba(0,0,0,0.08)" }}>
      <div style={{ fontSize: 40, marginBottom: 10 }}>{emoji}</div>
      <h3 style={{ margin: "0 0 4px", fontSize: 16, color: "#1a1a2e", fontWeight: 800 }}>{title}</h3>
      <p style={{ margin: 0, fontSize: 13, color: "#666" }}>{sub}</p>
    </div>
  );
}

const hd: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: "#1a1a2e", margin: "0 0 8px" };
const btnPrimary: React.CSSProperties = { padding: "9px 14px", fontSize: 12.5, fontWeight: 800, borderRadius: 8, border: "none", background: `linear-gradient(135deg, ${PURPLE}, #8B2FB5)`, color: "#fff", cursor: "pointer", fontFamily: "inherit" };
const btnSecondary: React.CSSProperties = { padding: "7px 12px", fontSize: 12, fontWeight: 700, borderRadius: 8, border: "1px solid rgba(0,0,0,0.12)", background: "#fff", color: "#475569", cursor: "pointer", fontFamily: "inherit" };

function LiveBadge({ lastSyncedAt }: { lastSyncedAt: string | null }) {
  const [, force] = useState(0);
  useEffect(() => { const t = setInterval(() => force(n => n + 1), 30_000); return () => clearInterval(t); }, []);
  if (!lastSyncedAt) {
    return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 10.5, fontWeight: 800, background: "#fef3c7", color: "#92400e", borderRadius: 999 }}>⏳ Sin sync</span>;
  }
  const ageMin = Math.floor((Date.now() - new Date(lastSyncedAt).getTime()) / 60_000);
  const isLive = ageMin < 5;
  const ageLabel = ageMin < 1 ? "ahora" : ageMin < 60 ? `${ageMin}m` : `${Math.floor(ageMin / 60)}h${ageMin % 60 ? ` ${ageMin % 60}m` : ""}`;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", fontSize: 10.5, fontWeight: 800, background: isLive ? "rgba(16,163,74,0.14)" : "rgba(217,119,6,0.14)", color: isLive ? "#065f46" : "#92400e", borderRadius: 999 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: isLive ? "#16a34a" : "#d97706", boxShadow: isLive ? "0 0 0 0 rgba(16,163,74,0.6)" : "none", animation: isLive ? "livepulse 1.6s infinite" : "none" }} />
      {isLive ? "LIVE" : "STALE"} · hace {ageLabel}
      <style>{`@keyframes livepulse { 0% { box-shadow: 0 0 0 0 rgba(16,163,74,0.6); } 70% { box-shadow: 0 0 0 6px rgba(16,163,74,0); } 100% { box-shadow: 0 0 0 0 rgba(16,163,74,0); } }`}</style>
    </span>
  );
}

function EvolutionWrapper({ accountId, data, setData, metric, setMetric }: { accountId: string; data: MonthPoint[]; setData: (d: MonthPoint[]) => void; metric: Metric; setMetric: (m: Metric) => void }) {
  const [loading, setLoading] = useState(false);
  const [months, setMonths] = useState(6);

  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    fetch(`/api/traficker/evolution-monthly?account_id=${accountId}&months=${months}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { months: [] })
      .then(d => setData(d.months ?? []))
      .finally(() => setLoading(false));
  }, [accountId, months, setData]);

  if (!accountId) {
    return <div style={{ padding: 30, background: "#fff", borderRadius: 12, color: "#666", textAlign: "center", border: "1px solid rgba(0,0,0,0.06)" }}>Selecciona una cuenta arriba para ver la evolución.</div>;
  }

  return (
    <section>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ fontSize: 12, color: "#666" }}>Periodo:</strong>
        {[3, 6, 12, 18, 24].map(m => (
          <button key={m} onClick={() => setMonths(m)} style={{ padding: "5px 11px", fontSize: 11.5, fontWeight: 700, background: months === m ? PURPLE : "rgba(106,23,140,0.05)", color: months === m ? "#fff" : PURPLE, border: "none", borderRadius: 999, cursor: "pointer" }}>{m}m</button>
        ))}
        {loading && <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>Cargando…</span>}
      </div>
      <MonthlyEvolutionChart data={data} metric={metric} onMetricChange={(m) => setMetric(m as Metric)} />
    </section>
  );
}
