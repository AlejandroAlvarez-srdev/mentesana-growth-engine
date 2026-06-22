"use client";

import { useCallback, useEffect, useState } from "react";

const PURPLE = "#6A178C";

type BitacoraRow = {
  id: number;
  traficker_email: string;
  traficker_name: string | null;
  plataforma: string;
  ad_account_id: string | null;
  fb_account_id: string | null;
  entity_type: string;
  entity_ref: string | null;
  entity_name: string | null;
  change_type: string;
  before_value: string | null;
  after_value: string | null;
  motivo: string;
  created_at: string;
};

const PLATAFORMAS = ["meta", "google", "tiktok", "linkedin", "x", "otra"] as const;
const ENTITY_TYPES = ["cuenta", "campaign", "adset", "ad", "creativo", "presupuesto", "otra"] as const;
const CHANGE_SUGGESTIONS = ["pausado", "activado", "presupuesto", "audiencia", "creativo", "copy", "test", "objetivo"];

const PLAT_BADGE: Record<string, { bg: string; color: string }> = {
  meta: { bg: "rgba(24,119,242,0.12)", color: "#1877F2" },
  google: { bg: "rgba(234,67,53,0.12)", color: "#EA4335" },
  tiktok: { bg: "rgba(0,0,0,0.08)", color: "#1a1a2e" },
  linkedin: { bg: "rgba(10,102,194,0.12)", color: "#0A66C2" },
  x: { bg: "rgba(0,0,0,0.08)", color: "#1a1a2e" },
  otra: { bg: "rgba(0,0,0,0.06)", color: "#475569" },
};

export default function BitacoraTab({ accountId, fbAccountId }: { accountId: string | null; fbAccountId?: string | null }) {
  const [items, setItems] = useState<BitacoraRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [filterPlat, setFilterPlat] = useState<string>("");
  const [filterFrom, setFilterFrom] = useState<string>("");
  const [filterTo, setFilterTo] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (accountId) params.set("account_id", accountId);
      if (filterPlat) params.set("plataforma", filterPlat);
      if (filterFrom) params.set("from", filterFrom);
      if (filterTo) params.set("to", filterTo);
      params.set("limit", "200");
      const r = await fetch(`/api/traficker/bitacora?${params.toString()}`, { credentials: "include" });
      const j = await r.json();
      setItems(r.ok ? (j.items ?? []) : []);
    } finally {
      setLoading(false);
    }
  }, [accountId, filterPlat, filterFrom, filterTo]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, color: "#1a1a2e", fontWeight: 800 }}>📓 Bitácora de cambios</h3>
          <p style={{ margin: "2px 0 0", fontSize: 12, color: "#888" }}>Anota cada cambio en la pauta para que el equipo entienda por qué.</p>
        </div>
        <button onClick={() => setShowModal(true)} style={{ padding: "8px 14px", fontSize: 12, fontWeight: 800, color: "#fff", background: PURPLE, border: "none", borderRadius: 999, cursor: "pointer" }}>➕ Anotar cambio</button>
      </div>

      <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.06)", borderRadius: 10, padding: 8, marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={filterPlat} onChange={(e) => setFilterPlat(e.target.value)} style={selStyle}>
          <option value="">Todas las plataformas</option>
          {PLATAFORMAS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} style={selStyle} />
        <span style={{ color: "#888", fontSize: 12 }}>→</span>
        <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} style={selStyle} />
        <button onClick={() => { setFilterPlat(""); setFilterFrom(""); setFilterTo(""); }} style={{ ...selStyle, background: "transparent", color: "#888", cursor: "pointer" }}>Limpiar</button>
        <span style={{ marginLeft: "auto", fontSize: 11, color: "#888" }}>{loading ? "Cargando…" : `${items.length} entradas`}</span>
      </div>

      {items.length === 0 && !loading ? (
        <div style={{ padding: 30, background: "#fff", borderRadius: 12, color: "#666", textAlign: "center", border: "1px solid rgba(0,0,0,0.06)" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📓</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", marginBottom: 4 }}>Sin anotaciones aún</div>
          <div style={{ fontSize: 12 }}>Pulsa <strong>➕ Anotar cambio</strong> cada vez que toques la pauta.</div>
        </div>
      ) : (
        <div style={{ background: "#fff", borderRadius: 10, border: "1px solid rgba(0,0,0,0.06)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "rgba(106,23,140,0.04)" }}>
                <th style={th}>Fecha</th>
                <th style={th}>Plat</th>
                <th style={th}>Entidad</th>
                <th style={th}>Cambio</th>
                <th style={th}>Antes → Después</th>
                <th style={th}>Motivo</th>
                <th style={th}>Traficker</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => {
                const badge = PLAT_BADGE[r.plataforma] ?? PLAT_BADGE.otra;
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                    <td style={td}><div style={{ fontSize: 11, color: "#475569" }}>{new Date(r.created_at).toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</div></td>
                    <td style={td}><span style={{ padding: "2px 8px", borderRadius: 999, fontSize: 10, fontWeight: 700, background: badge.bg, color: badge.color }}>{r.plataforma}</span></td>
                    <td style={td}>
                      <div style={{ fontSize: 10, color: "#888", fontWeight: 700, textTransform: "uppercase" }}>{r.entity_type}</div>
                      {r.entity_name && <div style={{ fontSize: 11.5, color: "#1a1a2e", fontWeight: 600 }}>{r.entity_name}</div>}
                      {r.entity_ref && <div style={{ fontSize: 10, color: "#aaa", fontFamily: "ui-monospace, monospace" }}>{r.entity_ref}</div>}
                    </td>
                    <td style={td}><strong style={{ fontSize: 11.5, color: PURPLE }}>{r.change_type}</strong></td>
                    <td style={td}>
                      {r.before_value || r.after_value ? (
                        <div style={{ fontSize: 11, color: "#475569" }}>
                          {r.before_value && <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{r.before_value}</span>}
                          {r.before_value && r.after_value && <span style={{ margin: "0 4px", color: "#888" }}>→</span>}
                          {r.after_value && <strong>{r.after_value}</strong>}
                        </div>
                      ) : <span style={{ fontSize: 10, color: "#aaa" }}>—</span>}
                    </td>
                    <td style={td}><div style={{ fontSize: 11.5, color: "#1a1a2e", maxWidth: 320, whiteSpace: "pre-wrap" }}>{r.motivo}</div></td>
                    <td style={td}><div style={{ fontSize: 11, color: "#475569" }}>{r.traficker_name || r.traficker_email}</div></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && <AnotarModal accountId={accountId} fbAccountId={fbAccountId ?? null} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); void load(); }} />}
    </section>
  );
}

function AnotarModal({ accountId, fbAccountId, onClose, onSaved }: { accountId: string | null; fbAccountId: string | null; onClose: () => void; onSaved: () => void }) {
  const [plataforma, setPlataforma] = useState<typeof PLATAFORMAS[number]>("meta");
  const [entityType, setEntityType] = useState<typeof ENTITY_TYPES[number]>("ad");
  const [entityRef, setEntityRef] = useState("");
  const [entityName, setEntityName] = useState("");
  const [changeType, setChangeType] = useState("pausado");
  const [beforeVal, setBeforeVal] = useState("");
  const [afterVal, setAfterVal] = useState("");
  const [motivo, setMotivo] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!motivo.trim()) { setErr("Pon un motivo, aunque sea breve."); return; }
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/traficker/bitacora", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plataforma,
          ad_account_id: plataforma === "meta" ? accountId : null,
          fb_account_id: plataforma === "meta" ? fbAccountId : null,
          entity_type: entityType,
          entity_ref: entityRef.trim() || undefined,
          entity_name: entityName.trim() || undefined,
          change_type: changeType.trim(),
          before_value: beforeVal.trim() || undefined,
          after_value: afterVal.trim() || undefined,
          motivo: motivo.trim(),
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || "save_failed"); return; }
      onSaved();
    } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, maxWidth: 560, width: "100%", maxHeight: "92vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 17, color: "#1a1a2e", fontWeight: 800 }}>➕ Anotar cambio</h2>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: "#888", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <Field label="Plataforma">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {PLATAFORMAS.map((p) => (
                <button key={p} onClick={() => setPlataforma(p)} style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, background: plataforma === p ? PURPLE : "rgba(106,23,140,0.06)", color: plataforma === p ? "#fff" : PURPLE, border: "none", borderRadius: 999, cursor: "pointer", textTransform: "capitalize" }}>{p}</button>
              ))}
            </div>
          </Field>
          <Field label="Tipo de entidad">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {ENTITY_TYPES.map((e) => (
                <button key={e} onClick={() => setEntityType(e)} style={{ padding: "5px 10px", fontSize: 11, fontWeight: 700, background: entityType === e ? PURPLE : "rgba(106,23,140,0.06)", color: entityType === e ? "#fff" : PURPLE, border: "none", borderRadius: 999, cursor: "pointer" }}>{e}</button>
              ))}
            </div>
          </Field>
          <Row>
            <Field label="Nombre / referencia"><input value={entityName} onChange={(e) => setEntityName(e.target.value)} placeholder="ej. Ad Carrusel Junio" style={input} /></Field>
            <Field label="ID externo (opcional)"><input value={entityRef} onChange={(e) => setEntityRef(e.target.value)} placeholder="120246971…" style={{ ...input, fontFamily: "ui-monospace, monospace" }} /></Field>
          </Row>
          <Field label="Tipo de cambio">
            <input value={changeType} onChange={(e) => setChangeType(e.target.value)} placeholder="ej. presupuesto" list="changesug" style={input} />
            <datalist id="changesug">{CHANGE_SUGGESTIONS.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Row>
            <Field label="Antes (opcional)"><input value={beforeVal} onChange={(e) => setBeforeVal(e.target.value)} placeholder="ej. 30€/día" style={input} /></Field>
            <Field label="Después (opcional)"><input value={afterVal} onChange={(e) => setAfterVal(e.target.value)} placeholder="ej. 45€/día" style={input} /></Field>
          </Row>
          <Field label="Motivo *">
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="¿Por qué hiciste este cambio?" rows={3} style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
          </Field>

          {err && <div style={{ padding: 10, background: "#fee2e2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={onClose} disabled={saving} style={{ padding: "10px 18px", fontSize: 12, fontWeight: 700, color: "#666", background: "transparent", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, cursor: "pointer" }}>Cancelar</button>
            <button onClick={save} disabled={saving} style={{ flex: 1, padding: "10px 18px", fontSize: 12, fontWeight: 800, color: "#fff", background: PURPLE, border: "none", borderRadius: 8, cursor: saving ? "default" : "pointer", opacity: saving ? 0.6 : 1 }}>{saving ? "Guardando…" : "Guardar anotación"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 10.5, color: "#888", fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase" }}>{label}</span>
      {children}
    </label>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}

const input: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontFamily: "inherit", outline: "none", boxSizing: "border-box" };
const selStyle: React.CSSProperties = { padding: "5px 8px", fontSize: 12, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 6, background: "#fff" };
const th: React.CSSProperties = { textAlign: "left", padding: "10px 12px", fontSize: 10, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 };
const td: React.CSSProperties = { padding: "10px 12px", verticalAlign: "top" };
