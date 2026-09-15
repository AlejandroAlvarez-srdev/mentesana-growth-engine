"use client";

// Chat IA de CAMPAÑAS: pregunta sobre tus anuncios (CAC, CTR, fatiga, qué escalar).
// Contexto real de los últimos 30d precargado en el servidor (/api/traficker/campaign-ai).
import { useEffect, useRef, useState } from "react";

const PURPLE = "#6A178C";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Analízame los últimos 7 días: ¿por qué ha subido el CAC y cómo lo bajo?",
  "¿Qué anuncios debería pausar y cuáles escalar ahora mismo?",
  "¿Hay fatiga creativa? Dime cuáles y qué hacer.",
  "Compara esta semana con la anterior y dame 3 acciones concretas.",
];

export default function CampaignAITab({ accountId }: { accountId?: string }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, loading]);

  async function send(q: string) {
    const question = q.trim();
    if (!question || loading) return;
    const history = messages.slice(-8);
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch("/api/traficker/campaign-ai", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history, account_id: accountId || null }),
      });
      const d = await r.json();
      const answer = r.ok ? (d.answer || "—") : `⚠️ ${d.message ?? d.error ?? "Error"}`;
      setMessages((m) => [...m, { role: "assistant", content: answer }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${e instanceof Error ? e.message : String(e)}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 14px", background: "rgba(106,23,140,0.05)", border: `1px solid ${PURPLE}22`, borderRadius: 12 }}>
        <span style={{ fontSize: 18 }}>🤖</span>
        <div style={{ fontSize: 11.5, color: "#475569", lineHeight: 1.5 }}>
          <strong style={{ color: PURPLE }}>IA de campañas.</strong> Analiza tus anuncios de los <strong>últimos 30 días</strong> (gasto, CTR, CPA/CAC, frecuencia, ganadores) con serie diaria y comparativa semana vs semana. Pregúntale por causas y acciones.
          {accountId ? "" : " Selecciona una cuenta arriba para acotar el análisis (si no, usa todas)."}
        </div>
      </div>

      <div ref={scrollRef} style={{ minHeight: 300, maxHeight: 480, overflowY: "auto", display: "grid", gap: 10, padding: 4 }}>
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
          <div key={i} style={{ justifySelf: m.role === "user" ? "end" : "start", maxWidth: "88%", padding: "10px 13px", borderRadius: 14, fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", background: m.role === "user" ? PURPLE : "#fff", color: m.role === "user" ? "#fff" : "#1a1a2e", border: m.role === "user" ? "none" : "1px solid rgba(0,0,0,0.07)", borderBottomRightRadius: m.role === "user" ? 4 : 14, borderBottomLeftRadius: m.role === "user" ? 14 : 4 }}>
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ justifySelf: "start", padding: "10px 13px", borderRadius: 14, background: "#fff", border: "1px solid rgba(0,0,0,0.07)", fontSize: 12.5, color: "#888" }}>
            Analizando tus campañas…
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }}
          placeholder="Pregunta sobre tus campañas (CAC, qué pausar, fatiga…)…"
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
