"use client";

import { useState } from "react";

const PURPLE = "#6A178C";

export default function TrafickerLoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/traficker/auth/request-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
    setBusy(false);
    if (!r.ok) { setErr("Error enviando código"); return; }
    setStep("code");
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    const r = await fetch("/api/traficker/auth/verify-otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, code }) });
    setBusy(false);
    if (!r.ok) { setErr("Código inválido o caducado"); return; }
    window.location.href = "/traficker";
  }

  return (
    <div style={{ minHeight: "100vh", background: "#FFFAF2", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: "Inter, sans-serif" }}>
      <form onSubmit={step === "email" ? requestCode : verify} style={{ background: "#fff", padding: 32, borderRadius: 18, maxWidth: 400, width: "100%", boxShadow: "0 8px 24px rgba(0,0,0,0.06)" }}>
        <div style={{ textAlign: "center", marginBottom: 22 }}>
          <div style={{ fontSize: 30, marginBottom: 6 }}>📊</div>
          <h1 style={{ margin: 0, fontSize: 22, color: PURPLE, fontWeight: 800 }}>Panel Traficker</h1>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: "#666" }}>Mente Sana · acceso por OTP</p>
        </div>
        {step === "email" ? (
          <input autoFocus type="email" required placeholder="tu@email.com" value={email} onChange={e => setEmail(e.target.value)} style={inp} />
        ) : (
          <>
            <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "#666" }}>Código enviado a <strong>{email}</strong></p>
            <input autoFocus required maxLength={6} pattern="\d{6}" placeholder="123456" value={code} onChange={e => setCode(e.target.value)} style={{ ...inp, letterSpacing: 8, textAlign: "center", fontSize: 24, fontWeight: 800 }} />
          </>
        )}
        {err && <p style={{ color: "#dc2626", fontSize: 12, margin: "8px 0 0" }}>{err}</p>}
        <button type="submit" disabled={busy} style={{ marginTop: 14, width: "100%", padding: "12px", background: `linear-gradient(135deg, ${PURPLE}, #8B2FB5)`, color: "#fff", border: "none", borderRadius: 10, fontSize: 14, fontWeight: 800, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
          {busy ? "..." : step === "email" ? "Enviar código →" : "Entrar →"}
        </button>
        {step === "code" && <button type="button" onClick={() => { setStep("email"); setCode(""); }} style={{ marginTop: 8, width: "100%", padding: 8, background: "transparent", color: "#666", border: "none", fontSize: 12, cursor: "pointer" }}>← cambiar email</button>}
      </form>
    </div>
  );
}
const inp: React.CSSProperties = { width: "100%", padding: "12px 14px", fontSize: 14, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, background: "#fff", fontFamily: "inherit", color: "#1a1a2e", boxSizing: "border-box" };
