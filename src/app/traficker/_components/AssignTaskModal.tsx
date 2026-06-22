"use client";

import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type Target = { id: string; label: string; email: string; assignee_type: string };
type Priority = "low" | "normal" | "high" | "urgent";

export default function AssignTaskModal({ onClose, onAssigned }: { onClose: () => void; onAssigned?: (id: string) => void }) {
  const [targets, setTargets] = useState<Target[]>([]);
  const [loadingTargets, setLoadingTargets] = useState(true);
  const [target, setTarget] = useState<string>("cto");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [dueAt, setDueAt] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/traficker/tasks/assign", { credentials: "include" })
      .then(r => r.ok ? r.json() : { targets: [] })
      .then(d => setTargets(d.targets ?? []))
      .finally(() => setLoadingTargets(false));
  }, []);

  async function submit() {
    if (!title.trim()) { setErr("Pon un título"); return; }
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/traficker/tasks/assign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          due_at: dueAt || undefined,
          related_id: typeof window !== "undefined" ? window.location.pathname : undefined,
        }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setErr(j.error || "save_failed"); return; }
      const j = await r.json();
      onAssigned?.(j.id);
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, maxWidth: 520, width: "100%", maxHeight: "92vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, color: "#1a1a2e", fontWeight: 800 }}>➕ Asignar tarea</h2>
            <p style={{ margin: "2px 0 0", fontSize: 11.5, color: "#888" }}>Llega como notificación al panel + email del destinatario.</p>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: "#888", cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          <Field label="Asignar a *">
            {loadingTargets ? (
              <div style={{ padding: 10, color: "#888", fontSize: 12 }}>Cargando destinatarios…</div>
            ) : (
              <select value={target} onChange={(e) => setTarget(e.target.value)} style={input}>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
          </Field>

          <Field label="Título *">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="ej. Generar 3 hooks nuevos para Angulo 1" maxLength={200} style={input} autoFocus />
          </Field>

          <Field label="Descripción">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Contexto, links, briefs…" rows={4} style={{ ...input, resize: "vertical", fontFamily: "inherit" }} />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <Field label="Prioridad">
              <div style={{ display: "flex", gap: 4 }}>
                {(["low", "normal", "high", "urgent"] as Priority[]).map((p) => (
                  <button key={p} onClick={() => setPriority(p)} style={{ flex: 1, padding: "7px 0", fontSize: 11, fontWeight: 700, background: priority === p ? PURPLE : "rgba(106,23,140,0.05)", color: priority === p ? "#fff" : PURPLE, border: "none", borderRadius: 6, cursor: "pointer", textTransform: "capitalize" }}>{p}</button>
                ))}
              </div>
            </Field>
            <Field label="Plazo (opcional)">
              <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} style={input} />
            </Field>
          </div>

          {err && <div style={{ padding: 10, background: "#fee2e2", color: "#991b1b", borderRadius: 8, fontSize: 12 }}>{err}</div>}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button onClick={onClose} disabled={saving} style={{ padding: "10px 18px", fontSize: 12, fontWeight: 700, color: "#666", background: "transparent", border: "1px solid rgba(0,0,0,0.1)", borderRadius: 8, cursor: "pointer" }}>Cancelar</button>
            <button onClick={submit} disabled={saving || !title.trim()} style={{ flex: 1, padding: "10px 18px", fontSize: 12, fontWeight: 800, color: "#fff", background: PURPLE, border: "none", borderRadius: 8, cursor: saving || !title.trim() ? "default" : "pointer", opacity: saving || !title.trim() ? 0.55 : 1 }}>{saving ? "Asignando…" : "Asignar tarea"}</button>
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

const input: React.CSSProperties = { width: "100%", padding: "8px 10px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 8, fontFamily: "inherit", outline: "none", boxSizing: "border-box", background: "#fff" };
