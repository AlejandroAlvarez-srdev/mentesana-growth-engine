"use client";

import { useCallback, useEffect, useState } from "react";

const PURPLE = "#6A178C";

type Counts = {
  total: number;
  active: number;
  paused: number;
  dead: number;
  other: number;
  by_status: Record<string, number>;
  last_synced_at: string | null;
  stale: boolean;
};

export default function ActiveAdsStrip({ accountId }: { accountId: string | null }) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : "";
      const r = await fetch(`/api/agent/meta/active-ads-counts${q}`, { credentials: "include", cache: "no-store" });
      if (!r.ok) { setErr(`HTTP ${r.status}`); return; }
      setCounts(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load_failed");
    } finally { setLoading(false); }
  }, [accountId]);

  const sync = useCallback(async () => {
    setSyncing(true); setErr(null);
    try {
      const r = await fetch("/api/agent/meta/sync-status", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accountId ? { account_id: accountId } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.message || j?.error || `HTTP ${r.status}`); return; }
      if (j?.per_account) {
        const failed = j.per_account.filter((p: { errors: number; error?: string }) => p.errors > 0 || p.error);
        if (failed.length && j.upserted === 0) {
          setErr(`Meta rechazó ${failed.length}/${j.accounts_processed} cuentas: ${failed.map((p: { account_name: string; error?: string }) => `${p.account_name}=${p.error}`).slice(0, 2).join(" · ")}`);
          return;
        }
      }
      await load();
    } finally { setSyncing(false); }
  }, [accountId, load]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (counts && counts.stale && !syncing) sync();
  }, [counts, syncing, sync]);

  const syncedLabel = counts?.last_synced_at ? timeAgo(counts.last_synced_at) : "nunca";

  return (
    <section style={{ background: "linear-gradient(135deg, #f9f3ff 0%, #fff 100%)", border: "1px solid rgba(106,23,140,0.18)", borderRadius: 14, padding: "14px 16px", marginBottom: 16, boxShadow: "0 1px 3px rgba(106,23,140,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: PURPLE, textTransform: "uppercase", letterSpacing: 0.7 }}>📡 Estado real de los ads · Meta API</div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
            {loading ? "Cargando…" : syncing ? "Sincronizando con Meta…" : `Última sync: ${syncedLabel}`}
            {counts?.stale && !syncing && <span style={{ color: "#d97706", marginLeft: 6, fontWeight: 700 }}>· datos antiguos</span>}
          </div>
        </div>
        <button onClick={sync} disabled={syncing} style={{ padding: "7px 14px", fontSize: 11.5, fontWeight: 700, background: PURPLE, color: "#fff", border: "none", borderRadius: 7, cursor: syncing ? "default" : "pointer", opacity: syncing ? 0.55 : 1 }}>{syncing ? "Sincronizando…" : accountId ? "🔄 Sincronizar cuenta" : "🔄 Sincronizar todas"}</button>
      </div>

      {err && <div style={{ padding: 8, background: "#fee2e2", color: "#991b1b", borderRadius: 6, fontSize: 11.5, marginBottom: 10 }}>⚠️ {err}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        <Chip label="🟢 Activos" value={counts?.active ?? 0} color="#16a34a" highlight />
        <Chip label="⏸ Pausados" value={counts?.paused ?? 0} color="#d97706" />
        <Chip label="🗑 Eliminados/Archivados" value={counts?.dead ?? 0} color="#94a3b8" />
        {(counts?.other ?? 0) > 0 && <Chip label="❓ Otros" value={counts?.other ?? 0} color="#6b7280" />}
        <Chip label="∑ Total en cuenta" value={counts?.total ?? 0} color={PURPLE} />
      </div>

      {counts && Object.keys(counts.by_status).length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ fontSize: 10.5, color: "#888", cursor: "pointer", fontWeight: 600 }}>Desglose por status crudo de Meta</summary>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
            {Object.entries(counts.by_status).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <span key={k} style={{ fontSize: 10.5, padding: "3px 8px", background: "rgba(106,23,140,0.06)", color: "#333", borderRadius: 6, fontFamily: "monospace" }}>{k}: <strong>{v}</strong></span>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function Chip({ label, value, color, highlight = false }: { label: string; value: number; color: string; highlight?: boolean }) {
  return (
    <div style={{ padding: "9px 10px", background: highlight ? color : "#fff", color: highlight ? "#fff" : "#1a1a2e", border: highlight ? "none" : `1px solid ${color}33`, borderRadius: 9 }}>
      <div style={{ fontSize: 10, fontWeight: 700, opacity: highlight ? 0.9 : 0.6, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 2, color: highlight ? "#fff" : color }}>{value.toLocaleString("es-ES")}</div>
    </div>
  );
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return "ahora";
  if (m < 60) return `hace ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}
