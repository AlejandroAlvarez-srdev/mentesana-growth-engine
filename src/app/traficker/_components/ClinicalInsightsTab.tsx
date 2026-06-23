"use client";

// Chat IA consultivo sobre historiales clínicos y sesiones grabadas — SOLO agregado.
// El endpoint nunca devuelve datos de un paciente concreto (k-anonimato + cero identificadores).
import { useEffect, useRef, useState } from "react";

const PURPLE = "#6A178C";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "¿Cómo describen los pacientes su ansiedad, con sus palabras?",
  "¿Qué frases recurrentes dicen sobre dormir mal?",
  "¿Qué temas están en alza los últimos 6 meses?",
  "Dame ángulos de campaña con frases reales de pacientes",
];

export default function ClinicalInsightsTab() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, loading]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    const history = messages.slice(-10);
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch("/api/traficker/clinical-insights", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const d = await r.json();
      const answer = r.ok ? (d.answer || "—") : `⚠️ ${d.message ?? d.error ?? "Error"}`;
      setMessages((m) => [...m, { role: "assistant", content: answer }]);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${String(e?.message ?? e)}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Aviso de anonimato */}
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", background: "rgba(106,23,140,0.05)", border: `1px solid ${PURPLE}22`, borderRadius: 12 }}>
        <span style={{ fontSize: 18 }}>🔒</span>
        <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5 }}>
          <strong style={{ color: PURPLE }}>Insights anónimos de las sesiones.</strong> Te da lo que dicen los pacientes, sus frases y dolores recurrentes, y la evolución de los temas — para orientar campañas y mensajes.
          {" "}<strong>Nunca</strong> revela datos que identifiquen a un paciente: ni nombres, ni email, ni teléfono. Habla siempre en genérico.
        </div>
      </div>

      {/* Conversación */}
      <div ref={scrollRef} style={{ minHeight: 280, maxHeight: 460, overflowY: "auto", display: "grid", gap: 10, padding: 4 }}>
        {messages.length === 0 && (
          <div style={{ display: "grid", gap: 8, alignContent: "start", paddingTop: 8 }}>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 2 }}>Pregúntame, por ejemplo:</div>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => void send(s)} style={{ textAlign: "left", padding: "9px 12px", fontSize: 12.5, fontWeight: 600, color: PURPLE, background: "#fff", border: `1px solid ${PURPLE}33`, borderRadius: 10, cursor: "pointer", fontFamily: "inherit" }}>
                💬 {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ justifySelf: m.role === "user" ? "end" : "start", maxWidth: "85%", padding: "10px 13px", borderRadius: 14, fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", background: m.role === "user" ? PURPLE : "#fff", color: m.role === "user" ? "#fff" : "#1a1a2e", border: m.role === "user" ? "none" : "1px solid rgba(0,0,0,0.07)", borderBottomRightRadius: m.role === "user" ? 4 : 14, borderBottomLeftRadius: m.role === "user" ? 14 : 4 }}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ justifySelf: "start", padding: "10px 13px", borderRadius: 14, background: "#fff", border: "1px solid rgba(0,0,0,0.07)", fontSize: 12.5, color: "#888" }}>
            Consultando los agregados…
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder="Pregunta sobre patrones agregados (ningún dato individual)…"
          disabled={loading}
          style={{ flex: 1, padding: "11px 14px", fontSize: 13, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 12, fontFamily: "inherit", outline: "none" }}
        />
        <button
          onClick={() => void send(input)}
          disabled={loading || !input.trim()}
          style={{ padding: "11px 18px", fontSize: 13, fontWeight: 800, borderRadius: 12, border: "none", background: loading || !input.trim() ? "rgba(106,23,140,0.4)" : "linear-gradient(135deg, #6A178C, #8B2FB5)", color: "#fff", cursor: loading || !input.trim() ? "default" : "pointer", fontFamily: "inherit" }}
        >
          Enviar
        </button>
      </div>
    </div>
  );
}
