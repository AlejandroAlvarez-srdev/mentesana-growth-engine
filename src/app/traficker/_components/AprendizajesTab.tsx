"use client";

// Aprendizajes — memoria institucional del traficker (embudo 9,99€ EUR).
// Reconstruye las "eras" de cada traficker (auto-detectadas por rupturas de CPA,
// SIN nombres → Traficker 1/2/3) y qué hizo cada uno para conseguir conversiones,
// para que el que entra no empiece de cero. + KB editable que sobrevive a la rotación.
import { useEffect, useState, type CSSProperties } from "react";

const PURPLE = "#6A178C";
const GOLD = "#C9922B";

type Bullet = { t: string; metric?: string };
type EraAI = { label: string; titulo?: string; resumen?: string; funciono?: Bullet[]; fallo?: Bullet[]; para_el_siguiente?: string[]; tags?: string[] };
type Ganador = { name: string; gasto: number; conv: number; cpa: number | null; ctr: number | null; thumbstop: number | null; freq: number | null };
type Era = {
  label: string; from: string; to: string; dias: number;
  gasto: number; conversiones: number; cpa_blended: number | null; cpa_efectivo: number | null;
  gasto_a_ciegas: number; pct_ciego: number; tendencia_cpa_pct: number | null;
  n_creativos: number; lal_pct: number; broad_pct: number; naming_ok_pct: number; freq_media: number | null;
  formatos: { video: number; imagen: number; carrusel: number; otro: number };
  angulos: { angulo: string; gasto: number; conv: number }[];
  ganadores: Ganador[]; quemadores: Ganador[];
};
type Manual = { id: string; era_label: string | null; kind: string; category: string | null; title: string; detail: string | null; metric: string | null; impact: string; source: string; created_by: string | null; created_at: string };
type Report = {
  global: { desde: string | null; hasta: string | null; gasto: number; conversiones: number; cpa_blended: number | null; gasto_a_ciegas: number; pct_ciego: number; cpa_efectivo: number | null };
  eras: Era[];
  ai: { eras: EraAI[]; playbook: { gana?: string[]; evita?: string[]; arreglar_ya?: string[] } | null; error?: string | null };
  manual: Manual[];
  cached: boolean;
  generated_at: string;
};

const eur = (n: number) => `€${n.toLocaleString("es-ES")}`;
const fmtDate = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "short" });

export default function AprendizajesTab() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  async function load(refresh = false) {
    refresh ? setRefreshing(true) : setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/traficker/learnings${refresh ? "?refresh=1" : ""}`, { credentials: "include" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.message ?? d.error ?? "Error");
      setData(d);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); setRefreshing(false); }
  }
  useEffect(() => { void load(); }, []);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>Reconstruyendo la historia de la cuenta…</div>;
  if (err) return <div style={{ padding: 16, background: "#fef2f2", color: "#991b1b", borderRadius: 12 }}>⚠️ {err}</div>;
  if (!data) return null;

  const aiByLabel = new Map((data.ai?.eras ?? []).map((e) => [e.label, e]));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Intro */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "space-between", padding: "12px 15px", background: "rgba(106,23,140,0.05)", border: `1px solid ${PURPLE}22`, borderRadius: 12 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <span style={{ fontSize: 20 }}>🧭</span>
          <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5 }}>
            <strong style={{ color: PURPLE }}>Memoria del traficker.</strong> Reconstruye qué hizo cada traficker (eras auto-detectadas por saltos de CPA, <strong>sin nombres</strong>) para lograr conversiones en el <strong>9,99€</strong>. El que entra hereda el conocimiento en vez de empezar de cero.
            <div style={{ fontSize: 10.5, color: "#94a3b8", marginTop: 3 }}>Datos {data.global.desde && fmtDate(data.global.desde)}–{data.global.hasta && fmtDate(data.global.hasta)} · {data.cached ? "cacheado" : "recién calculado"}</div>
          </div>
        </div>
        <button onClick={() => void load(true)} disabled={refreshing} style={{ flexShrink: 0, padding: "7px 12px", fontSize: 11.5, fontWeight: 700, borderRadius: 9, border: `1px solid ${PURPLE}33`, background: "#fff", color: PURPLE, cursor: refreshing ? "default" : "pointer", fontFamily: "inherit" }}>
          {refreshing ? "Recalculando…" : "↻ Recalcular"}
        </button>
      </div>

      {/* KPIs globales + alerta tracking */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
        <Kpi label="Gasto 9,99€ (EUR)" value={eur(data.global.gasto)} />
        <Kpi label="Conversiones (píxel)" value={String(data.global.conversiones)} />
        <Kpi label="CPA medio" value={data.global.cpa_blended != null ? eur(data.global.cpa_blended) : "—"} />
        <Kpi label="CPA con tracking OK" value={data.global.cpa_efectivo != null ? eur(data.global.cpa_efectivo) : "—"} accent={GOLD} />
      </div>

      {data.global.pct_ciego >= 15 && (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 15px", background: "#fff7ed", border: "1px solid #fdba74", borderRadius: 12 }}>
          <span style={{ fontSize: 18 }}>🚨</span>
          <div style={{ fontSize: 12, color: "#9a3412", lineHeight: 1.5 }}>
            <strong>Hueco de tracking estructural.</strong> {eur(data.global.gasto_a_ciegas)} ({data.global.pct_ciego}% del presupuesto) se optimizaron a un evento <em>purchase</em> que el píxel <strong>nunca registró</strong> → Meta optimizó a ciegas y el CPA salió inflado <em>para todos</em> los trafickers. No fue (solo) mala compra de medios: arreglar el evento de compra es la palanca nº1.
          </div>
        </div>
      )}

      {/* Playbook consolidado */}
      {data.ai?.playbook && (
        <div style={{ background: "#fff", border: `1px solid ${PURPLE}22`, borderRadius: 14, padding: 16 }}>
          <h3 style={{ margin: "0 0 12px", color: PURPLE, fontSize: 15, display: "flex", alignItems: "center", gap: 7 }}>📘 Playbook 9,99€ <span style={{ fontSize: 10.5, fontWeight: 600, color: "#94a3b8" }}>lo que la cuenta ya ha demostrado</span></h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 14 }}>
            <PlaybookCol title="✅ Gana" color="#0F7A52" items={data.ai.playbook.gana} />
            <PlaybookCol title="⛔ Evita" color="#dc2626" items={data.ai.playbook.evita} />
            <PlaybookCol title="🔧 Arreglar ya" color={GOLD} items={data.ai.playbook.arreglar_ya} />
          </div>
        </div>
      )}

      {/* Timeline de eras */}
      <div style={{ display: "grid", gap: 14 }}>
        {data.eras.map((era, i) => {
          const ai = aiByLabel.get(era.label);
          const better = era.tendencia_cpa_pct != null && era.tendencia_cpa_pct < 0;
          return (
            <div key={era.label} style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, overflow: "hidden" }}>
              {/* Cabecera era */}
              <div style={{ padding: "14px 16px", background: `linear-gradient(135deg, ${PURPLE}0d, transparent)`, borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ width: 26, height: 26, borderRadius: 8, background: PURPLE, color: "#fff", fontSize: 13, fontWeight: 800, display: "grid", placeItems: "center" }}>{i + 1}</span>
                      <strong style={{ fontSize: 15, color: "#1a1a2e" }}>{era.label}</strong>
                      {ai?.titulo && <span style={{ fontSize: 12.5, color: PURPLE, fontStyle: "italic" }}>· {ai.titulo}</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>{fmtDate(era.from)} → {fmtDate(era.to)} · {era.dias} días activos · {era.n_creativos} creativos</div>
                  </div>
                  <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                    <MiniStat label="Gasto" value={eur(era.gasto)} />
                    <MiniStat label="Conv." value={String(era.conversiones)} />
                    <MiniStat label="CPA" value={era.cpa_blended != null ? eur(era.cpa_blended) : "—"}
                      sub={era.tendencia_cpa_pct != null ? `${better ? "▼" : "▲"} ${Math.abs(era.tendencia_cpa_pct)}%` : undefined}
                      subColor={better ? "#0F7A52" : "#dc2626"} />
                  </div>
                </div>
              </div>

              <div style={{ padding: 16, display: "grid", gap: 13 }}>
                {ai?.resumen && <p style={{ margin: 0, fontSize: 13, color: "#334155", lineHeight: 1.55 }}>{ai.resumen}</p>}

                {(ai?.funciono?.length || ai?.fallo?.length) && (
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 12 }}>
                    <BulletBox title="✅ Qué funcionó" color="#0F7A52" bullets={ai?.funciono} />
                    <BulletBox title="⚠️ Qué le salió mal" color="#dc2626" bullets={ai?.fallo} />
                  </div>
                )}

                {ai?.para_el_siguiente?.length ? (
                  <div style={{ background: `${GOLD}12`, border: `1px solid ${GOLD}44`, borderRadius: 10, padding: "10px 13px" }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: GOLD, marginBottom: 5, textTransform: "uppercase", letterSpacing: 0.4 }}>🎯 Para el siguiente traficker</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "#334155", lineHeight: 1.6 }}>
                      {ai.para_el_siguiente.map((s, k) => <li key={k}>{s}</li>)}
                    </ul>
                  </div>
                ) : null}

                {/* Señales de la era */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <Chip label={`LAL ${era.lal_pct}%`} />
                  <Chip label={`Broad ${era.broad_pct}%`} />
                  {era.freq_media != null && <Chip label={`Frec. media ${era.freq_media}`} warn={era.freq_media >= 2.5} />}
                  <Chip label={`Naming OK ${era.naming_ok_pct}%`} warn={era.naming_ok_pct < 40} />
                  {era.pct_ciego >= 15 && <Chip label={`${era.pct_ciego}% a ciegas`} warn />}
                </div>

                {/* Creativos ganadores */}
                {era.ganadores.length > 0 && (
                  <div>
                    <div style={{ fontSize: 11.5, fontWeight: 800, color: "#475569", marginBottom: 6 }}>🏆 Creativos que convirtieron</div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, minWidth: 460 }}>
                        <thead><tr style={{ color: "#94a3b8", textAlign: "left" }}>
                          <th style={thc}>Creativo</th><th style={thcr}>Gasto</th><th style={thcr}>Conv.</th><th style={thcr}>CPA</th><th style={thcr}>CTR</th><th style={thcr}>Frec.</th>
                        </tr></thead>
                        <tbody>
                          {era.ganadores.map((a, k) => (
                            <tr key={k} style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                              <td style={{ ...tdc, maxWidth: 190, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={a.name}>{a.name}</td>
                              <td style={tdcr}>{eur(a.gasto)}</td><td style={tdcr}>{a.conv}</td>
                              <td style={{ ...tdcr, fontWeight: 800, color: (a.cpa ?? 99) <= 35 ? "#0F7A52" : "#1a1a2e" }}>{a.cpa != null ? eur(a.cpa) : "—"}</td>
                              <td style={tdcr}>{a.ctr ?? "—"}</td><td style={tdcr}>{a.freq ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {era.quemadores.length > 0 && (
                  <details>
                    <summary style={{ fontSize: 11.5, fontWeight: 800, color: "#dc2626", cursor: "pointer" }}>🔥 Creativos que quemaron presupuesto ({era.quemadores.length})</summary>
                    <div style={{ fontSize: 11.5, color: "#64748b", marginTop: 6, lineHeight: 1.7 }}>
                      {era.quemadores.map((a, k) => (
                        <div key={k}>· <span title={a.name}>{a.name.length > 42 ? a.name.slice(0, 42) + "…" : a.name}</span> — {eur(a.gasto)} · {a.conv === 0 ? "0 conv" : `CPA ${eur(a.cpa!)}`}</div>
                      ))}
                    </div>
                  </details>
                )}

                {ai?.tags?.length ? (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {ai.tags.map((t) => <span key={t} style={{ fontSize: 10, color: PURPLE, background: `${PURPLE}12`, padding: "2px 8px", borderRadius: 999, fontWeight: 700 }}>#{t}</span>)}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {data.ai?.error && <div style={{ fontSize: 11, color: "#94a3b8" }}>Nota: la síntesis IA no está disponible ({data.ai.error}); se muestran los datos crudos por era.</div>}

      {/* KB manual */}
      <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0, color: PURPLE, fontSize: 15 }}>📝 Aprendizajes añadidos a mano</h3>
          <button onClick={() => setShowAdd((s) => !s)} style={{ padding: "7px 13px", fontSize: 12, fontWeight: 800, borderRadius: 9, border: "none", background: PURPLE, color: "#fff", cursor: "pointer", fontFamily: "inherit" }}>{showAdd ? "Cerrar" : "+ Añadir"}</button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 11.5, color: "#94a3b8" }}>Todo lo que aprendas y no salga de los números (una landing que funcionó, un ángulo, un truco de puja) déjalo aquí. Sobrevive a la rotación.</p>
        {showAdd && <AddForm eras={data.eras.map((e) => e.label)} onSaved={() => { setShowAdd(false); void load(); }} />}
        <div style={{ display: "grid", gap: 8, marginTop: showAdd ? 12 : 0 }}>
          {(data.manual ?? []).length === 0 && <div style={{ fontSize: 12, color: "#94a3b8" }}>Aún no hay aprendizajes manuales. Sé el primero en dejar constancia.</div>}
          {(data.manual ?? []).map((m) => (
            <div key={m.id} style={{ border: "1px solid rgba(0,0,0,0.07)", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13 }}>{m.kind === "win" ? "✅" : m.kind === "fail" ? "⚠️" : m.kind === "tactic" ? "🎯" : "💡"}</span>
                <strong style={{ fontSize: 13, color: "#1a1a2e" }}>{m.title}</strong>
                {m.era_label && <span style={{ fontSize: 10, color: PURPLE, background: `${PURPLE}12`, padding: "1px 7px", borderRadius: 999, fontWeight: 700 }}>{m.era_label}</span>}
                {m.category && <span style={{ fontSize: 10, color: "#64748b", background: "#f1f5f9", padding: "1px 7px", borderRadius: 999 }}>{m.category}</span>}
                {m.metric && <span style={{ fontSize: 10.5, color: GOLD, fontWeight: 700 }}>{m.metric}</span>}
                <button onClick={async () => { if (confirm("¿Borrar este aprendizaje?")) { await fetch("/api/traficker/learnings", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", id: m.id }) }); void load(); } }} style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#cbd5e1", cursor: "pointer", fontSize: 14 }} title="Borrar">×</button>
              </div>
              {m.detail && <p style={{ margin: "5px 0 0", fontSize: 12, color: "#475569", lineHeight: 1.5 }}>{m.detail}</p>}
              <div style={{ fontSize: 10, color: "#cbd5e1", marginTop: 5 }}>{m.created_by ?? "—"} · {new Date(m.created_at).toLocaleDateString("es-ES")}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AddForm({ eras, onSaved }: { eras: string[]; onSaved: () => void }) {
  const [f, setF] = useState({ title: "", detail: "", kind: "tactic", category: "creativo", era_label: "", metric: "", impact: "medio" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));
  async function save() {
    if (!f.title.trim() || saving) return;
    setSaving(true);
    try {
      await fetch("/api/traficker/learnings", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "add", ...f, era_label: f.era_label || null }) });
      onSaved();
    } finally { setSaving(false); }
  }
  const inp = { padding: "9px 11px", fontSize: 12.5, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 9, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box" as const };
  return (
    <div style={{ display: "grid", gap: 8, background: "#faf7fc", border: `1px solid ${PURPLE}22`, borderRadius: 10, padding: 12 }}>
      <input style={inp} placeholder="Título (ej: 'La landing de ansiedad convierte 2x')" value={f.title} onChange={(e) => set("title", e.target.value)} />
      <textarea style={{ ...inp, minHeight: 60, resize: "vertical" }} placeholder="Detalle: qué hiciste, por qué funcionó / falló, cómo replicarlo…" value={f.detail} onChange={(e) => set("detail", e.target.value)} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 8 }}>
        <select style={inp} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
          <option value="win">✅ Funcionó</option><option value="fail">⚠️ Falló</option><option value="tactic">🎯 Táctica</option><option value="note">💡 Nota</option>
        </select>
        <select style={inp} value={f.category} onChange={(e) => set("category", e.target.value)}>
          {["creativo", "segmentacion", "puja", "embudo", "tracking", "landing", "otro"].map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select style={inp} value={f.era_label} onChange={(e) => set("era_label", e.target.value)}>
          <option value="">Sin era</option>{eras.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <input style={inp} placeholder="Métrica (ej: CPA €23)" value={f.metric} onChange={(e) => set("metric", e.target.value)} />
      </div>
      <button onClick={() => void save()} disabled={saving || !f.title.trim()} style={{ padding: "10px", fontSize: 13, fontWeight: 800, borderRadius: 9, border: "none", background: saving || !f.title.trim() ? "rgba(106,23,140,0.4)" : PURPLE, color: "#fff", cursor: saving || !f.title.trim() ? "default" : "pointer", fontFamily: "inherit" }}>
        {saving ? "Guardando…" : "Guardar aprendizaje"}
      </button>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: "12px 14px" }}>
      <div style={{ fontSize: 10.5, color: "#94a3b8", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ?? "#1a1a2e", marginTop: 3 }}>{value}</div>
    </div>
  );
}
function MiniStat({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div style={{ textAlign: "right" }}>
      <div style={{ fontSize: 9.5, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: "#1a1a2e" }}>{value}{sub && <span style={{ fontSize: 10.5, fontWeight: 700, color: subColor, marginLeft: 4 }}>{sub}</span>}</div>
    </div>
  );
}
function PlaybookCol({ title, color, items }: { title: string; color: string; items?: string[] }) {
  if (!items?.length) return null;
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 800, color, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 17, fontSize: 12, color: "#334155", lineHeight: 1.6 }}>{items.map((s, k) => <li key={k}>{s}</li>)}</ul>
    </div>
  );
}
function BulletBox({ title, color, bullets }: { title: string; color: string; bullets?: Bullet[] }) {
  if (!bullets?.length) return null;
  return (
    <div style={{ border: `1px solid ${color}33`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, color, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: "#334155", lineHeight: 1.55 }}>
        {bullets.map((b, k) => <li key={k}>{b.t}{b.metric && <span style={{ color: "#94a3b8" }}> — {b.metric}</span>}</li>)}
      </ul>
    </div>
  );
}
function Chip({ label, warn }: { label: string; warn?: boolean }) {
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", borderRadius: 999, background: warn ? "#fef2f2" : "#f1f5f9", color: warn ? "#dc2626" : "#64748b" }}>{label}</span>;
}

const thc: CSSProperties = { padding: "5px 6px", fontWeight: 700 };
const thcr: CSSProperties = { ...thc, textAlign: "right" };
const tdc: CSSProperties = { padding: "6px" };
const tdcr: CSSProperties = { padding: "6px", textAlign: "right" };
