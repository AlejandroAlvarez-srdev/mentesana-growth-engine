"use client";

// Modal compuesto para crear ads en Meta. 3 modos:
//   B) Solo creativo: subir video → ad nuevo dentro de un adset existente
//   A) Duplicar campaña: clona campaign + adsets + ads (creatives reutilizados)
//   C) Nueva completa: campaign + adset + ad desde 0
//
// TODO: todos los objetos nacen PAUSED. El traficker activa manualmente en Meta.
import { useEffect, useState } from "react";

const PURPLE = "#6A178C";

type Account = { id: string; fb_account_id: string; name: string; currency: string | null };

export default function CreateCampaignModal({ accountId, accounts, onClose }: { accountId: string; accounts: Account[]; onClose: () => void }) {
  const [mode, setMode] = useState<"B" | "A" | "C">("B");
  const [acctId, setAcctId] = useState(accountId);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(26,26,46,0.55)", backdropFilter: "blur(6px)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, width: "min(720px, 100%)", maxHeight: "94vh", overflow: "auto", boxShadow: "0 24px 80px rgba(106,23,140,0.22)" }}>
        <header style={{ padding: "16px 20px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", alignItems: "center", gap: 10, position: "sticky", top: 0, background: "#fff", zIndex: 2 }}>
          <h2 style={{ margin: 0, fontSize: 17, color: "#1a1a2e", fontWeight: 800 }}>📢 Crear en Meta</h2>
          <span style={{ fontSize: 10.5, padding: "3px 8px", background: "#fef3c7", color: "#92400e", borderRadius: 6, fontWeight: 800, letterSpacing: 0.3 }}>TODO NACE PAUSADO</span>
          <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#888" }}>×</button>
        </header>

        <section style={{ padding: "12px 20px", borderBottom: "1px solid rgba(0,0,0,0.04)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ fontSize: 11, color: "#888", fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>Cuenta:</label>
          <select value={acctId} onChange={e => setAcctId(e.target.value)} style={{ ...inp, padding: "7px 10px", minWidth: 240, width: "auto" }}>
            <option value="">— Selecciona —</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}{a.currency ? ` (${a.currency})` : ""}</option>)}
          </select>
        </section>

        <nav style={{ display: "flex", gap: 4, padding: "10px 20px 0", borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
          {([
            ["B", "🎬 Subir creativo", "Bajo riesgo · usa adset existente"],
            ["A", "♻️ Duplicar campaña", "Clona ganadora · medio riesgo"],
            ["C", "🚀 Nueva completa", "Desde 0 · alto riesgo"],
          ] as const).map(([k, l, sub]) => (
            <button key={k} onClick={() => setMode(k as any)} style={{
              padding: "10px 14px",
              fontSize: 12.5,
              fontWeight: 700,
              border: "none",
              borderBottom: mode === k ? `2px solid ${PURPLE}` : "2px solid transparent",
              background: "transparent",
              color: mode === k ? PURPLE : "#475569",
              cursor: "pointer",
              fontFamily: "inherit",
              textAlign: "left",
            }}>
              <div>{l}</div>
              <div style={{ fontSize: 9.5, fontWeight: 500, color: "#888", marginTop: 2 }}>{sub}</div>
            </button>
          ))}
        </nav>

        <div style={{ padding: 20 }}>
          {!acctId ? (
            <EmptyHint emoji="📂" text="Elige una cuenta arriba para empezar." />
          ) : mode === "B" ? (
            <CreateAdFromVideoForm accountId={acctId} onClose={onClose} />
          ) : mode === "A" ? (
            <DuplicateCampaignForm accountId={acctId} onClose={onClose} />
          ) : (
            <FullCreateForm accountId={acctId} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── B: Subir vídeo + crear ad en adset existente ───────────────────────
function CreateAdFromVideoForm({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [adsets, setAdsets] = useState<{ id: string; name: string; campaign_id: string }[]>([]);
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);
  const [igs, setIgs] = useState<{ id: string; username: string }[]>([]);
  const [adsetId, setAdsetId] = useState("");
  const [pageId, setPageId] = useState("");
  const [igActor, setIgActor] = useState("");
  const [adName, setAdName] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [linkUrl, setLinkUrl] = useState("https://mentesanapsicologia.com/diagnostico");
  const [cta, setCta] = useState("LEARN_MORE");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/agent/meta/create-helpers?account_id=${accountId}&kind=adsets`, { credentials: "include" }).then(r => r.json()).then(d => setAdsets(d.adsets ?? []));
    fetch(`/api/agent/meta/create-helpers?account_id=${accountId}&kind=pages`, { credentials: "include" }).then(r => r.json()).then(d => setPages(d.pages ?? []));
    fetch(`/api/agent/meta/create-helpers?account_id=${accountId}&kind=instagram_accounts`, { credentials: "include" }).then(r => r.json()).then(d => setIgs(d.instagram_accounts ?? []));
  }, [accountId]);

  async function submit() {
    if (!adsetId || !pageId || !adName.trim() || !primaryText.trim() || !linkUrl.trim() || !file) {
      setResult({ ok: false, msg: "Rellena todos los campos + sube el vídeo" }); return;
    }
    if (!confirm(`Crear ad "${adName}" PAUSADO en el adset seleccionado. ¿Continuar?`)) return;
    setBusy(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("account_id", accountId);
    fd.append("adset_id", adsetId);
    fd.append("ad_name", adName.trim());
    fd.append("primary_text", primaryText.trim());
    fd.append("headline", headline.trim());
    fd.append("link_url", linkUrl.trim());
    fd.append("cta_type", cta);
    fd.append("page_id", pageId);
    if (igActor) fd.append("instagram_actor_id", igActor);
    const r = await fetch("/api/agent/meta/create-ad-from-video", { method: "POST", credentials: "include", body: fd });
    setBusy(false);
    const j = await r.json();
    if (r.ok) setResult({ ok: true, msg: `✅ Ad creado PAUSADO · ID ${j.ad_id} (acuérdate de activarlo en Meta cuando esté listo)` });
    else setResult({ ok: false, msg: `❌ ${j.detail ?? j.error}` });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <FormRow label="Adset destino">
        <select value={adsetId} onChange={e => setAdsetId(e.target.value)} style={inp}>
          <option value="">— Selecciona adset existente —</option>
          {adsets.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </FormRow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormRow label="Facebook Page">
          <select value={pageId} onChange={e => setPageId(e.target.value)} style={inp}>
            <option value="">— Selecciona —</option>
            {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </FormRow>
        <FormRow label="Instagram account (opcional)">
          <select value={igActor} onChange={e => setIgActor(e.target.value)} style={inp}>
            <option value="">— Solo Facebook —</option>
            {igs.map(i => <option key={i.id} value={i.id}>@{i.username}</option>)}
          </select>
        </FormRow>
      </div>
      <FormRow label="Nombre del ad">
        <input value={adName} onChange={e => setAdName(e.target.value)} placeholder="Ej: V2 - Hook ansiedad - Hombre 30s" style={inp} />
      </FormRow>
      <FormRow label="Texto principal (primary_text)">
        <textarea value={primaryText} onChange={e => setPrimaryText(e.target.value)} rows={3} placeholder="El texto que aparece arriba del vídeo en feed" style={{ ...inp, resize: "vertical" }} />
      </FormRow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FormRow label="Headline (opcional)">
          <input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Frase corta bajo el vídeo" style={inp} />
        </FormRow>
        <FormRow label="CTA">
          <select value={cta} onChange={e => setCta(e.target.value)} style={inp}>
            {["LEARN_MORE","SIGN_UP","SHOP_NOW","SUBSCRIBE","CONTACT_US","BOOK_TRAVEL","DOWNLOAD","GET_OFFER","WATCH_MORE","APPLY_NOW","GET_STARTED"].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </FormRow>
      </div>
      <FormRow label="URL destino">
        <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} style={inp} />
      </FormRow>
      <FormRow label="Vídeo (mp4)">
        <input type="file" accept="video/*" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
        {file && <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>📎 {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</div>}
      </FormRow>
      <Submit label="🎬 Crear ad (PAUSADO)" onClick={submit} busy={busy} />
      <Result result={result} />
    </div>
  );
}

// ─── A: Duplicar campaña ───────────────────────────────────────────────
function DuplicateCampaignForm({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [campaigns, setCampaigns] = useState<{ id: string; name: string; effective_status: string; objective: string }[]>([]);
  const [campaignId, setCampaignId] = useState("");
  const [newName, setNewName] = useState("");
  const [dupAdsets, setDupAdsets] = useState(true);
  const [dupAds, setDupAds] = useState(true);
  const [budgetMult, setBudgetMult] = useState(1);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/agent/meta/create-helpers?account_id=${accountId}&kind=campaigns`, { credentials: "include" }).then(r => r.json()).then(d => setCampaigns(d.campaigns ?? []));
  }, [accountId]);

  async function submit() {
    if (!campaignId || !newName.trim()) { setResult({ ok: false, msg: "Selecciona campaña y nombre nuevo" }); return; }
    if (!confirm(`Duplicar campaña con${dupAdsets ? " sus adsets" : ""}${dupAds ? " y ads" : ""}. Todo nacerá PAUSADO. ¿Continuar?`)) return;
    setBusy(true);
    const r = await fetch("/api/agent/meta/duplicate-campaign", {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ account_id: accountId, campaign_id: campaignId, new_name: newName.trim(), duplicate_adsets: dupAdsets, duplicate_ads: dupAds, budget_multiplier: budgetMult }),
    });
    setBusy(false);
    const j = await r.json();
    if (r.ok) setResult({ ok: true, msg: `✅ Duplicada · ${j.adsets_created} adsets + ${j.ads_created} ads (todo PAUSADO)`, detail: j });
    else setResult({ ok: false, msg: `❌ ${j.detail ?? j.error}` });
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <FormRow label="Campaña a duplicar">
        <select value={campaignId} onChange={e => setCampaignId(e.target.value)} style={inp}>
          <option value="">— Selecciona —</option>
          {campaigns.map(c => <option key={c.id} value={c.id}>{c.name} · {c.objective}{c.effective_status === "ACTIVE" ? " · ● activa" : ""}</option>)}
        </select>
      </FormRow>
      <FormRow label="Nombre de la nueva campaña">
        <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Ej: Test ansiedad hombres - V3" style={inp} />
      </FormRow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={dupAdsets} onChange={e => setDupAdsets(e.target.checked)} /> Duplicar adsets
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer", opacity: dupAdsets ? 1 : 0.4 }}>
          <input type="checkbox" checked={dupAds} onChange={e => setDupAds(e.target.checked)} disabled={!dupAdsets} /> Duplicar ads
        </label>
      </div>
      <FormRow label={`Escalar daily budget × ${budgetMult.toFixed(2)}`}>
        <input type="range" min={0.25} max={3} step={0.25} value={budgetMult} onChange={e => setBudgetMult(Number(e.target.value))} style={{ width: "100%" }} />
        <div style={{ fontSize: 10.5, color: "#888", marginTop: 4 }}>1× = mismo budget · 2× = doble · 0.5× = la mitad</div>
      </FormRow>
      <Submit label="♻️ Duplicar (PAUSADO)" onClick={submit} busy={busy} />
      <Result result={result} />
    </div>
  );
}

// ─── C: Crear campaña completa ─────────────────────────────────────────
function FullCreateForm({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [pages, setPages] = useState<{ id: string; name: string }[]>([]);
  const [igs, setIgs] = useState<{ id: string; username: string }[]>([]);
  const [pixels, setPixels] = useState<{ id: string; name: string }[]>([]);
  const [pageId, setPageId] = useState("");
  const [igActor, setIgActor] = useState("");
  const [file, setFile] = useState<File | null>(null);

  // Campaign
  const [cmpName, setCmpName] = useState("");
  const [objective, setObjective] = useState("OUTCOME_TRAFFIC");

  // Adset
  const [astName, setAstName] = useState("");
  const [dailyBudgetEur, setDailyBudgetEur] = useState(10);
  const [optGoal, setOptGoal] = useState("LINK_CLICKS");
  const [billing, setBilling] = useState("IMPRESSIONS");
  const [pixelId, setPixelId] = useState("");
  const [convEvent, setConvEvent] = useState("PURCHASE");
  const [country, setCountry] = useState("ES");
  const [ageMin, setAgeMin] = useState(25);
  const [ageMax, setAgeMax] = useState(45);
  const [gender, setGender] = useState<"all" | "male" | "female">("all");

  // Ad
  const [adName, setAdName] = useState("");
  const [primaryText, setPrimaryText] = useState("");
  const [headline, setHeadline] = useState("");
  const [linkUrl, setLinkUrl] = useState("https://mentesanapsicologia.com/diagnostico");
  const [cta, setCta] = useState("LEARN_MORE");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/agent/meta/create-helpers?account_id=${accountId}&kind=pages`, { credentials: "include" }).then(r => r.json()).then(d => setPages(d.pages ?? []));
    fetch(`/api/agent/meta/create-helpers?account_id=${accountId}&kind=instagram_accounts`, { credentials: "include" }).then(r => r.json()).then(d => setIgs(d.instagram_accounts ?? []));
    fetch(`/api/agent/meta/create-helpers?account_id=${accountId}&kind=pixels`, { credentials: "include" }).then(r => r.json()).then(d => setPixels(d.pixels ?? []));
  }, [accountId]);

  async function submit() {
    if (!pageId || !cmpName || !astName || !adName || !primaryText || !linkUrl || !file) { setResult({ ok: false, msg: "Rellena todos los campos + sube el vídeo" }); return; }
    if (!confirm(`Crear campaña + adset + ad PAUSADO con presupuesto ${dailyBudgetEur}€/día. ¿Continuar?`)) return;
    setBusy(true);
    const targeting: any = { geo_locations: { countries: [country] }, age_min: ageMin, age_max: ageMax };
    if (gender === "male") targeting.genders = [1];
    if (gender === "female") targeting.genders = [2];
    const payload: any = {
      account_id: accountId,
      page_id: pageId,
      instagram_actor_id: igActor || undefined,
      campaign: { name: cmpName.trim(), objective },
      adset: {
        name: astName.trim(),
        daily_budget_cents: Math.round(dailyBudgetEur * 100),
        optimization_goal: optGoal,
        billing_event: billing,
        targeting,
        ...(optGoal === "OFFSITE_CONVERSIONS" && pixelId ? { promoted_object: { pixel_id: pixelId, custom_event_type: convEvent } } : {}),
      },
      ad: { name: adName.trim(), primary_text: primaryText.trim(), headline: headline.trim() || undefined, link_url: linkUrl.trim(), cta_type: cta },
    };
    const fd = new FormData();
    fd.append("payload", JSON.stringify(payload));
    fd.append("file", file);
    const r = await fetch("/api/agent/meta/create-full-campaign", { method: "POST", credentials: "include", body: fd });
    setBusy(false);
    const j = await r.json();
    if (r.ok) setResult({ ok: true, msg: `✅ Creada PAUSADA · campaign ${j.campaign_id}, adset ${j.adset_id}, ad ${j.ad_id}`, detail: j });
    else setResult({ ok: false, msg: `❌ ${j.detail ?? j.error}`, detail: j });
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Warning>⚠️ Vas a crear una campaña entera. <strong>Nace PAUSADA</strong> — actívala manualmente en Meta cuando todo esté revisado. Cuida bien el budget.</Warning>

      <Section title="📢 Campaña">
        <FormRow label="Nombre"><input value={cmpName} onChange={e => setCmpName(e.target.value)} style={inp} /></FormRow>
        <FormRow label="Objetivo">
          <select value={objective} onChange={e => setObjective(e.target.value)} style={inp}>
            {["OUTCOME_TRAFFIC","OUTCOME_LEADS","OUTCOME_SALES","OUTCOME_ENGAGEMENT","OUTCOME_AWARENESS","OUTCOME_APP_PROMOTION"].map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </FormRow>
      </Section>

      <Section title="🎯 Adset (audiencia + budget)">
        <FormRow label="Nombre"><input value={astName} onChange={e => setAstName(e.target.value)} style={inp} /></FormRow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <FormRow label={`Daily budget · ${dailyBudgetEur}€`}>
            <input type="range" min={5} max={200} step={1} value={dailyBudgetEur} onChange={e => setDailyBudgetEur(Number(e.target.value))} />
          </FormRow>
          <FormRow label="Optimization goal">
            <select value={optGoal} onChange={e => setOptGoal(e.target.value)} style={inp}>
              {["LINK_CLICKS","IMPRESSIONS","OFFSITE_CONVERSIONS","LEAD_GENERATION","REACH","POST_ENGAGEMENT","THRUPLAY"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </FormRow>
          <FormRow label="Billing event">
            <select value={billing} onChange={e => setBilling(e.target.value)} style={inp}>
              {["IMPRESSIONS","LINK_CLICKS","THRUPLAY"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          </FormRow>
        </div>
        {optGoal === "OFFSITE_CONVERSIONS" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <FormRow label="Pixel">
              <select value={pixelId} onChange={e => setPixelId(e.target.value)} style={inp}>
                <option value="">— Selecciona —</option>
                {pixels.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormRow>
            <FormRow label="Evento conversión">
              <select value={convEvent} onChange={e => setConvEvent(e.target.value)} style={inp}>
                {["PURCHASE","COMPLETE_REGISTRATION","LEAD","ADD_TO_CART","INITIATE_CHECKOUT","SUBSCRIBE","CONTACT"].map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </FormRow>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
          <FormRow label="País"><input value={country} onChange={e => setCountry(e.target.value)} maxLength={2} style={inp} /></FormRow>
          <FormRow label={`Edad ${ageMin}`}><input type="range" min={18} max={64} value={ageMin} onChange={e => setAgeMin(Number(e.target.value))} /></FormRow>
          <FormRow label={`hasta ${ageMax}`}><input type="range" min={18} max={65} value={ageMax} onChange={e => setAgeMax(Number(e.target.value))} /></FormRow>
          <FormRow label="Género">
            <select value={gender} onChange={e => setGender(e.target.value as any)} style={inp}>
              <option value="all">Todos</option><option value="male">Hombres</option><option value="female">Mujeres</option>
            </select>
          </FormRow>
        </div>
      </Section>

      <Section title="🎬 Ad (creativo)">
        <FormRow label="Nombre del ad"><input value={adName} onChange={e => setAdName(e.target.value)} style={inp} /></FormRow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <FormRow label="Facebook Page">
            <select value={pageId} onChange={e => setPageId(e.target.value)} style={inp}>
              <option value="">— Selecciona —</option>
              {pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </FormRow>
          <FormRow label="Instagram (opcional)">
            <select value={igActor} onChange={e => setIgActor(e.target.value)} style={inp}>
              <option value="">— Solo Facebook —</option>
              {igs.map(i => <option key={i.id} value={i.id}>@{i.username}</option>)}
            </select>
          </FormRow>
        </div>
        <FormRow label="Texto principal"><textarea value={primaryText} onChange={e => setPrimaryText(e.target.value)} rows={3} style={{ ...inp, resize: "vertical" }} /></FormRow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <FormRow label="Headline"><input value={headline} onChange={e => setHeadline(e.target.value)} style={inp} /></FormRow>
          <FormRow label="URL destino"><input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} style={inp} /></FormRow>
          <FormRow label="CTA">
            <select value={cta} onChange={e => setCta(e.target.value)} style={inp}>
              {["LEARN_MORE","SIGN_UP","SHOP_NOW","SUBSCRIBE","CONTACT_US","DOWNLOAD","GET_OFFER","WATCH_MORE","APPLY_NOW","GET_STARTED"].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FormRow>
        </div>
        <FormRow label="Vídeo (mp4)">
          <input type="file" accept="video/*" onChange={e => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 12 }} />
          {file && <div style={{ fontSize: 11, color: "#666", marginTop: 4 }}>📎 {file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</div>}
        </FormRow>
      </Section>

      <Submit label="🚀 Crear campaña completa (PAUSADO)" onClick={submit} busy={busy} />
      <Result result={result} />
    </div>
  );
}

// ─── helpers UI ─────────────────────────────────────────────────────────
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return <label style={{ display: "block" }}>
    <span style={{ display: "block", fontSize: 10.5, fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 4 }}>{label}</span>
    {children}
  </label>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section style={{ padding: 12, background: "rgba(106,23,140,0.03)", border: `1px solid ${PURPLE}22`, borderRadius: 10, display: "grid", gap: 10 }}>
    <strong style={{ fontSize: 12.5, color: PURPLE }}>{title}</strong>
    {children}
  </section>;
}
function Submit({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }) {
  return <button onClick={onClick} disabled={busy} style={{ padding: "12px 18px", background: busy ? "#ddd" : `linear-gradient(135deg, ${PURPLE}, #8B2FB5)`, color: "#fff", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 800, cursor: busy ? "default" : "pointer", fontFamily: "inherit" }}>
    {busy ? "Enviando a Meta…" : label}
  </button>;
}
function Result({ result }: { result: any }) {
  if (!result) return null;
  return <div style={{ padding: 12, borderRadius: 8, background: result.ok ? "#ecfdf5" : "#fef2f2", color: result.ok ? "#065f46" : "#991b1b", fontSize: 12.5, fontWeight: 600, lineHeight: 1.5 }}>{result.msg}</div>;
}
function Warning({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 12, background: "#fef3c7", borderLeft: "4px solid #d97706", borderRadius: 8, fontSize: 12.5, color: "#78350f", lineHeight: 1.55 }}>{children}</div>;
}
function EmptyHint({ emoji, text }: { emoji: string; text: string }) {
  return <div style={{ padding: 32, textAlign: "center", color: "#666" }}>
    <div style={{ fontSize: 32, marginBottom: 8 }}>{emoji}</div>
    <p style={{ margin: 0, fontSize: 13 }}>{text}</p>
  </div>;
}
const inp: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid rgba(0,0,0,0.12)", borderRadius: 7, fontSize: 13, fontFamily: "inherit", boxSizing: "border-box", background: "#fff", color: "#1a1a2e" };
