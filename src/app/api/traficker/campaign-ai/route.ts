// Chat IA de CAMPAÑAS para el traficker. Precarga contexto real de anuncios
// (últimos 30d: totales, serie diaria, semana vs semana, ganadores/perdedores)
// y responde análisis accionables (CAC, CTR, fatiga, qué pausar/escalar).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";
import { scoreCreative } from "@/lib/meta-ads";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const question = String(body.question ?? "").trim();
  const history = Array.isArray(body.history) ? (body.history as { role: string; content: string }[]).slice(-8) : [];
  const accountId = body.account_id ? String(body.account_id) : null;
  if (!question) return NextResponse.json({ error: "missing_question" }, { status: 400 });

  // ── Contexto de anuncios (últimos 30d) ──
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const w1Start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const w2Start = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
  let q = sb.from("meta_ad_insights").select("*").gte("date_start", since).limit(5000);
  if (accountId) q = q.eq("ad_account_id", accountId);
  const { data: rows } = await q;
  const insights = (rows ?? []) as Record<string, unknown>[];

  const num = (v: unknown) => Number(v ?? 0) || 0;
  const daily: Record<string, { spend: number; results: number; pv: number }> = {};
  const byAd = new Map<string, { ad_name: string; campaign_name: string; spend: number; impressions: number; clicks: number; results: number; purchase_value: number; frequency: number; thumbstop_rate: number; days: number }>();
  let tSpend = 0, tResults = 0, tPV = 0, w1Spend = 0, w1Results = 0, w2Spend = 0, w2Results = 0;
  for (const r of insights) {
    const d = String(r.date_start);
    const spend = num(r.spend), results = num(r.results), pv = num(r.purchase_value);
    (daily[d] ??= { spend: 0, results: 0, pv: 0 });
    daily[d].spend += spend; daily[d].results += results; daily[d].pv += pv;
    tSpend += spend; tResults += results; tPV += pv;
    if (d >= w1Start) { w1Spend += spend; w1Results += results; }
    else if (d >= w2Start) { w2Spend += spend; w2Results += results; }
    const k = String(r.fb_ad_id);
    if (!k) continue;
    const a = byAd.get(k) ?? { ad_name: String(r.ad_name ?? ""), campaign_name: String(r.campaign_name ?? ""), spend: 0, impressions: 0, clicks: 0, results: 0, purchase_value: 0, frequency: 0, thumbstop_rate: 0, days: 0 };
    a.spend += spend; a.impressions += num(r.impressions); a.clicks += num(r.clicks); a.results += results; a.purchase_value += pv;
    a.frequency = Math.max(a.frequency, num(r.frequency)); a.thumbstop_rate = Math.max(a.thumbstop_rate, num(r.thumbstop_rate)); a.days += 1;
    byAd.set(k, a);
  }
  const ads = [...byAd.values()].map((a) => ({
    ad_name: a.ad_name, campaign: a.campaign_name, spend: r2(a.spend), results: a.results, days: a.days,
    impressions: a.impressions, // necesario para el gate de scoreCreative
    ctr: a.impressions > 0 ? r2((a.clicks / a.impressions) * 100) : 0,
    cost_per_result: a.results > 0 ? r2(a.spend / a.results) : null,
    roas: a.spend > 0 ? r2(a.purchase_value / a.spend) : null,
    frequency: r2(a.frequency), thumbstop_rate: r2(a.thumbstop_rate),
  }));
  const winners = ads.map((a) => { const s = scoreCreative(a); return { ...a, score: s.score }; }).filter((a) => a.score >= 30).sort((a, b) => b.score - a.score).slice(0, 8);
  const topSpend = [...ads].sort((a, b) => b.spend - a.spend).slice(0, 12);
  const zeroResult = ads.filter((a) => a.results === 0 && a.spend >= 20).sort((a, b) => b.spend - a.spend).slice(0, 8);
  const fatiga = ads.filter((a) => a.frequency >= 3 && a.spend >= 30).sort((a, b) => b.frequency - a.frequency).slice(0, 8);

  const context = {
    periodo: "últimos 30 días",
    totales_30d: { gasto: r2(tSpend), conversiones_pixel: tResults, cpa: tResults > 0 ? r2(tSpend / tResults) : null, revenue: r2(tPV), roas: tSpend > 0 ? r2(tPV / tSpend) : null },
    semana_actual_7d: { gasto: r2(w1Spend), conversiones: w1Results, cpa: w1Results > 0 ? r2(w1Spend / w1Results) : null },
    semana_anterior_7d: { gasto: r2(w2Spend), conversiones: w2Results, cpa: w2Results > 0 ? r2(w2Spend / w2Results) : null },
    serie_diaria: Object.entries(daily).sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, gasto: r2(v.spend), conversiones: v.results, cpa: v.results > 0 ? r2(v.spend / v.results) : null })),
    ganadores: winners,
    top_gasto: topSpend,
    sin_conversiones: zeroResult,
    fatiga_alta: fatiga,
    nota: "conversiones = eventos del píxel de Meta, no ventas verificadas.",
  };

  const key = (process.env.ANTHROPIC_API_KEY ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!key) return NextResponse.json({ error: "no_llm" }, { status: 500 });
  const system = `Eres analista senior de Meta Ads para Mente Sana (psicología online; producto de entrada: diagnóstico 9,99€). Respondes al equipo de tráfico en español, directo y con CIFRAS. Analiza EXCLUSIVAMENTE con los datos que te doy (últimos 30 días). Detecta causas (CAC/CPA subiendo, CTR cayendo, frecuencia/fatiga, ganadores vs perdedores) usando la serie diaria y la comparativa semana vs semana. Da SIEMPRE recomendaciones accionables y concretas (qué pausar, qué escalar, qué refrescar, con nombres de anuncio/campaña). No inventes datos que no estén. Si faltan datos, dilo.\n\nDATOS:\n${JSON.stringify(context)}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 1600,
        system,
        messages: [...history.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content) })), { role: "user", content: question }],
      }),
    });
    const j = await res.json();
    if (!res.ok) return NextResponse.json({ error: "llm_error", message: j?.error?.message ?? `HTTP ${res.status}` }, { status: 500 });
    return NextResponse.json({ answer: j?.content?.[0]?.text ?? "—" });
  } catch (e) {
    return NextResponse.json({ error: "server_error", message: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
