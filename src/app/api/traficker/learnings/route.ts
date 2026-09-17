// Aprendizajes del traficker — memoria institucional del embudo 9,99€ (EUR).
//
// El problema: los trafickers rotaban ("morían todos") y su conocimiento se
// perdía. Esta ruta reconstruye, desde los datos reales de Meta, las "eras"
// de cada traficker (auto-detectadas por rupturas de CPA mes a mes, SIN nombres
// → Traficker 1/2/3…) y sintetiza con IA qué hizo cada uno: qué funcionó, qué
// disparó el CAC y qué debe copiar/evitar el siguiente. Todo se cachea para no
// llamar a Claude en cada carga. Además hay una KB editable (traficker_learnings)
// que sobrevive a la rotación.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";
import { anguloDeCampana, validarNombreCampana } from "@/lib/meta-embudos";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const CACHE_ID = "eur_999";
const r2 = (n: number) => Math.round(n * 100) / 100;
const r0 = (n: number) => Math.round(n);

type Daily = { d: string; spend: number; conv: number; spend_blind: number; conv_trusted: number };
type AdRow = {
  ad_name: string; campaign_name: string | null; adset_name: string | null; creative_type: string | null;
  spend: number; conv: number; impressions: number; clicks: number;
  ctr: number | null; thumbstop: number | null; freq: number | null; preview: string | null;
};

// ── Detección de eras: parte los meses por las (K-1) mayores rupturas de CPA ──
function detectEras(daily: Daily[]): { from: string; to: string; label: string }[] {
  if (daily.length === 0) return [];
  const byMonth = new Map<string, { firstDay: string; lastDay: string; spend: number; conv: number }>();
  for (const r of daily) {
    const m = r.d.slice(0, 7);
    const cur = byMonth.get(m) ?? { firstDay: r.d, lastDay: r.d, spend: 0, conv: 0 };
    cur.spend += r.spend; cur.conv += r.conv;
    if (r.d < cur.firstDay) cur.firstDay = r.d;
    if (r.d > cur.lastDay) cur.lastDay = r.d;
    byMonth.set(m, cur);
  }
  let months = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, ...v, cpa: v.conv > 0 ? v.spend / v.conv : null as number | null }));

  // Fusiona meses de gasto residual (arranque/pausa) con el mes vecino.
  const spends = months.map((m) => m.spend).sort((a, b) => a - b);
  const medianSpend = spends[Math.floor(spends.length / 2)] || 0;
  const merged: typeof months = [];
  for (const mo of months) {
    if (merged.length > 0 && mo.spend < medianSpend * 0.15) {
      const prev = merged[merged.length - 1];
      prev.spend += mo.spend; prev.conv += mo.conv; prev.lastDay = mo.lastDay;
      prev.cpa = prev.conv > 0 ? prev.spend / prev.conv : null;
    } else merged.push({ ...mo });
  }
  months = merged;
  if (months.length <= 1) {
    const only = months[0];
    return only ? [{ from: only.firstDay, to: only.lastDay, label: "Traficker 1" }] : [];
  }

  const K = Math.min(4, Math.max(2, Math.round(months.length / 2)));
  // Separación mínima entre cortes: evita que dos rupturas adyacentes (típico en
  // una recuperación de CPA mes a mes) generen eras de un solo mes mientras el
  // resto queda en un bloque enorme. Con ≥5 meses exigimos ≥2 meses por era.
  const MIN_GAP = months.length >= 5 ? 2 : 1;
  // Candidatos de corte = magnitud del cambio de CPA entre meses consecutivos.
  const boundaries: { idx: number; mag: number }[] = [];
  for (let i = 0; i < months.length - 1; i++) {
    const a = months[i].cpa, b = months[i + 1].cpa;
    const mag = a != null && b != null && a > 0 ? Math.abs(b - a) / a : 0;
    boundaries.push({ idx: i + 1, mag });
  }
  // Selección greedy por magnitud respetando MIN_GAP contra el inicio, el fin y
  // los cortes ya elegidos → eras equilibradas.
  const chosen: number[] = [];
  for (const b of boundaries.filter((x) => x.mag > 0).sort((x, y) => y.mag - x.mag)) {
    if (chosen.length >= K - 1) break;
    if (b.idx < MIN_GAP || b.idx > months.length - MIN_GAP) continue;
    if (chosen.some((c) => Math.abs(c - b.idx) < MIN_GAP)) continue;
    chosen.push(b.idx);
  }
  const cuts = chosen.sort((a, b) => a - b);

  const eras: { from: string; to: string; label: string }[] = [];
  let start = 0;
  const splitPoints = [...cuts, months.length];
  for (const sp of splitPoints) {
    const grp = months.slice(start, sp);
    if (grp.length === 0) continue;
    eras.push({ from: grp[0].firstDay, to: grp[grp.length - 1].lastDay, label: `Traficker ${eras.length + 1}` });
    start = sp;
  }
  return eras;
}

function analyzeAds(ads: AdRow[]) {
  const total = ads.reduce((s, a) => s + a.spend, 0);
  const isLAL = (a: AdRow) => /lal|lookalike|similar/i.test(`${a.adset_name} ${a.campaign_name}`);
  const isBroad = (a: AdRow) => /broad|abierto|a\+a|open/i.test(`${a.adset_name} ${a.campaign_name}`);
  const lalSpend = ads.filter(isLAL).reduce((s, a) => s + a.spend, 0);
  const broadSpend = ads.filter(isBroad).reduce((s, a) => s + a.spend, 0);
  const namingOk = ads.filter((a) => validarNombreCampana(a.campaign_name ?? "").ok).length;
  const freqs = ads.map((a) => a.freq ?? 0).filter((f) => f > 0);
  const fmt = { video: 0, imagen: 0, carrusel: 0, otro: 0 };
  for (const a of ads) {
    const t = (a.creative_type ?? "").toLowerCase();
    if (/video/.test(t)) fmt.video += a.spend;
    else if (/carousel|carrusel/.test(t)) fmt.carrusel += a.spend;
    else if (/image|foto|single/.test(t)) fmt.imagen += a.spend;
    else fmt.otro += a.spend;
  }
  const angles = new Map<string, { spend: number; conv: number }>();
  for (const a of ads) {
    const ang = anguloDeCampana(a.campaign_name) ?? "sin-clasificar";
    const cur = angles.get(ang) ?? { spend: 0, conv: 0 };
    cur.spend += a.spend; cur.conv += a.conv; angles.set(ang, cur);
  }
  const withCpa = ads.map((a) => ({
    name: a.ad_name, gasto: r0(a.spend), conv: a.conv,
    cpa: a.conv > 0 ? r2(a.spend / a.conv) : null,
    ctr: a.ctr ? r2(a.ctr) : null, thumbstop: a.thumbstop ? r2(a.thumbstop) : null, freq: a.freq ? r2(a.freq) : null,
  }));
  const ganadores = withCpa.filter((a) => a.conv >= 5 && a.gasto >= 150).sort((a, b) => (a.cpa ?? 1e9) - (b.cpa ?? 1e9)).slice(0, 6);
  const quemadores = withCpa.filter((a) => a.gasto >= 250 && (a.conv === 0 || (a.cpa ?? 0) >= 90)).sort((a, b) => b.gasto - a.gasto).slice(0, 5);
  return {
    n_creativos: ads.length,
    lal_pct: total > 0 ? r0((lalSpend / total) * 100) : 0,
    broad_pct: total > 0 ? r0((broadSpend / total) * 100) : 0,
    naming_ok_pct: ads.length > 0 ? r0((namingOk / ads.length) * 100) : 0,
    freq_media: freqs.length ? r2(freqs.reduce((s, f) => s + f, 0) / freqs.length) : null,
    formatos: { video: r0(fmt.video), imagen: r0(fmt.imagen), carrusel: r0(fmt.carrusel), otro: r0(fmt.otro) },
    angulos: [...angles.entries()].map(([ang, v]) => ({ angulo: ang, gasto: r0(v.spend), conv: v.conv }))
      .sort((a, b) => b.gasto - a.gasto).slice(0, 6),
    ganadores, quemadores,
  };
}

async function buildReport() {
  const { data: dailyRaw, error } = await sb.rpc("traf999_daily");
  if (error) throw new Error(`daily: ${error.message}`);
  const daily = (dailyRaw ?? []).map((r: Record<string, unknown>) => ({
    d: String(r.d), spend: Number(r.spend) || 0, conv: Number(r.conv) || 0,
    spend_blind: Number(r.spend_blind) || 0, conv_trusted: Number(r.conv_trusted) || 0,
  })) as Daily[];

  const totalSpend = daily.reduce((s, r) => s + r.spend, 0);
  const totalConv = daily.reduce((s, r) => s + r.conv, 0);
  const blindSpend = daily.reduce((s, r) => s + r.spend_blind, 0);
  const globalMeta = {
    desde: daily[0]?.d ?? null, hasta: daily[daily.length - 1]?.d ?? null,
    gasto: r0(totalSpend), conversiones: totalConv,
    cpa_blended: totalConv > 0 ? r2(totalSpend / totalConv) : null,
    gasto_a_ciegas: r0(blindSpend), pct_ciego: totalSpend > 0 ? r0((blindSpend / totalSpend) * 100) : 0,
    cpa_efectivo: totalConv > 0 ? r2((totalSpend - blindSpend) / totalConv) : null,
  };

  const eraRanges = detectEras(daily);
  const eras: Record<string, unknown>[] = [];
  let prevCpa: number | null = null;
  for (const er of eraRanges) {
    const inRange = daily.filter((r) => r.d >= er.from && r.d <= er.to);
    const spend = inRange.reduce((s, r) => s + r.spend, 0);
    const conv = inRange.reduce((s, r) => s + r.conv, 0);
    const blind = inRange.reduce((s, r) => s + r.spend_blind, 0);
    const cpa = conv > 0 ? spend / conv : null;
    const { data: adsRaw } = await sb.rpc("traf999_ads", { p_from: er.from, p_to: er.to });
    const ads = (adsRaw ?? []).map((a: Record<string, unknown>) => ({
      ad_name: String(a.ad_name ?? ""), campaign_name: (a.campaign_name as string) ?? null,
      adset_name: (a.adset_name as string) ?? null, creative_type: (a.creative_type as string) ?? null,
      spend: Number(a.spend) || 0, conv: Number(a.conv) || 0, impressions: Number(a.impressions) || 0,
      clicks: Number(a.clicks) || 0, ctr: a.ctr != null ? Number(a.ctr) : null,
      thumbstop: a.thumbstop != null ? Number(a.thumbstop) : null, freq: a.freq != null ? Number(a.freq) : null,
      preview: (a.preview as string) ?? null,
    })) as AdRow[];
    const detail = analyzeAds(ads);
    const dias = new Set(inRange.filter((r) => r.spend > 0).map((r) => r.d)).size;
    const tendencia = prevCpa != null && cpa != null ? r0(((cpa - prevCpa) / prevCpa) * 100) : null;
    eras.push({
      label: er.label, from: er.from, to: er.to, dias,
      gasto: r0(spend), conversiones: conv,
      cpa_blended: cpa != null ? r2(cpa) : null,
      cpa_efectivo: conv > 0 ? r2((spend - blind) / conv) : null,
      gasto_a_ciegas: r0(blind), pct_ciego: spend > 0 ? r0((blind / spend) * 100) : 0,
      tendencia_cpa_pct: tendencia,
      ...detail,
    });
    prevCpa = cpa;
  }

  // Síntesis IA por era + playbook consolidado
  const key = (process.env.ANTHROPIC_API_KEY ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  let ai: Record<string, unknown> = { eras: [], playbook: null, error: key ? null : "no_llm" };
  if (key && eras.length > 0) {
    const system = `Eres director de adquisición (paid media) de Mente Sana, psicología online. Producto: diagnóstico 9,99€. Analizas la historia REAL de la cuenta de Meta, ya troceada por "eras" de traficker (auto-detectadas por rupturas de CPA; SIN nombres → Traficker 1/2/3). Tu misión: convertir esos datos en MEMORIA INSTITUCIONAL para que el siguiente traficker no empiece de cero.

Habla en español, directo, con CIFRAS de los datos que te doy (no inventes). Contexto crítico del negocio: el ${globalMeta.pct_ciego}% del gasto (€${globalMeta.gasto_a_ciegas}) se optimizó a un evento 'purchase' que el píxel NUNCA registró → Meta optimizó a ciegas y eso infló el CPA de forma estructural, independientemente del traficker. Tenlo en cuenta al juzgar a cada era.

Responde SOLO JSON válido con esta forma:
{
 "eras": [
   { "label": "Traficker 1",
     "titulo": "apodo corto y memorable de su estilo (ej: 'El ordenado que probó ángulos')",
     "resumen": "2-3 frases de qué hizo y con qué resultado",
     "funciono": [{ "t": "táctica concreta", "metric": "cifra que lo respalda" }],
     "fallo": [{ "t": "error concreto", "metric": "cifra" }],
     "para_el_siguiente": ["acción concreta a copiar o evitar"],
     "tags": ["creativo","segmentacion","puja","embudo","tracking","landing"] } ],
 "playbook": {
   "gana": ["lo que consistentemente funciona en esta cuenta, con cifras"],
   "evita": ["lo que consistentemente falla, con cifras"],
   "arreglar_ya": ["fixes de infra/tracking prioritarios"] }
}
Un elemento por era en "eras", con el MISMO label que te paso. 2-4 bullets por lista.`;
    const payload = { global: globalMeta, eras };
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-7", max_tokens: 3000, system,
          messages: [{ role: "user", content: `DATOS:\n${JSON.stringify(payload)}` }],
        }),
      });
      const j = await res.json();
      const text: string = j?.content?.[0]?.text ?? "";
      const match = text.match(/\{[\s\S]*\}/);
      ai = match ? JSON.parse(match[0]) : { eras: [], playbook: null, error: "parse" };
    } catch (e) {
      ai = { eras: [], playbook: null, error: e instanceof Error ? e.message : "llm_error" };
    }
  }

  return { global: globalMeta, eras, ai, generated_at: new Date().toISOString() };
}

function fingerprintOf(report: { eras: Record<string, unknown>[]; global: Record<string, unknown> }): string {
  const basis = JSON.stringify({
    r: report.eras.map((e) => [e.label, e.from, e.to, e.gasto, e.conversiones]),
    g: [report.global.gasto, report.global.conversiones],
  });
  return crypto.createHash("sha256").update(basis).digest("hex").slice(0, 16);
}

export async function GET(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  let report: Awaited<ReturnType<typeof buildReport>> | null = null;
  let cached = false;

  if (!refresh) {
    const { data } = await sb.from("traficker_playbook_cache").select("*").eq("id", CACHE_ID).maybeSingle();
    if (data?.report) {
      const ageMs = Date.now() - new Date(data.generated_at).getTime();
      if (ageMs < 24 * 3600 * 1000) { report = data.report; cached = true; }
    }
  }

  if (!report) {
    report = await buildReport();
    const fp = fingerprintOf(report);
    await sb.from("traficker_playbook_cache").upsert({ id: CACHE_ID, report, fingerprint: fp, generated_at: new Date().toISOString() });
  }

  const { data: manual } = await sb.from("traficker_learnings").select("*").order("created_at", { ascending: false }).limit(200);

  return NextResponse.json({ ...report, manual: manual ?? [], cached });
}

export async function POST(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const action = String(body.action ?? "add");

  if (action === "delete") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
    const { error } = await sb.from("traficker_learnings").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // add
  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "missing_title" }, { status: 400 });
  const row = {
    era_label: body.era_label ? String(body.era_label) : null,
    kind: ["win", "fail", "tactic", "note"].includes(String(body.kind)) ? String(body.kind) : "note",
    category: body.category ? String(body.category) : null,
    title: title.slice(0, 300),
    detail: body.detail ? String(body.detail).slice(0, 2000) : null,
    metric: body.metric ? String(body.metric).slice(0, 120) : null,
    impact: ["alto", "medio", "bajo"].includes(String(body.impact)) ? String(body.impact) : "medio",
    source: "manual",
    created_by: auth.name || auth.email || "traficker",
  };
  const { data, error } = await sb.from("traficker_learnings").insert(row).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}
