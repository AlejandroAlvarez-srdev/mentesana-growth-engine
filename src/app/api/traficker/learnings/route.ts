// Aprendizajes del traficker — memoria institucional del embudo 9,99€ (EUR).
//
// Los trafickers rotaban ("morían todos") y su conocimiento se perdía. Esta ruta
// reconstruye desde los datos reales de Meta (histórico completo backfilleado
// nov-2025 →) las "eras" de cada traficker (auto-detectadas por rupturas de CPA),
// las ATRIBUYE a la persona real que operó la cuenta (actor del activity log del
// Graph API) y sintetiza con IA TODO el conocimiento accionable: qué funcionó,
// qué disparó el CAC, rendimiento por día de la semana / fin de semana, días
// relevantes, cadencia de lanzamiento, hit rate y vida útil de los creativos.
// Se cachea para no llamar a Claude en cada carga. + KB manual que sobrevive.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";
import { anguloDeCampana, validarNombreCampana } from "@/lib/meta-embudos";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 90;

const CACHE_ID = "eur_999";
const r2 = (n: number) => Math.round(n * 100) / 100;
const r0 = (n: number) => Math.round(n);

// Parseo tolerante del JSON de Claude: quita fences y comas colgantes, y si viene
// truncado autocierra los brackets/braces abiertos (fuera de strings) para rescatar
// todo lo posible en vez de perder el informe entero por un carácter.
function safeParseAiJson(text: string): Record<string, unknown> {
  let s = (text ?? "").trim().replace(/^```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const start = s.indexOf("{");
  if (start < 0) return { eras: [], playbook: null, error: "no_json" };
  s = s.slice(start);
  const stripCommas = (x: string) => x.replace(/,(\s*[}\]])/g, "$1");
  const autoClose = (x: string) => {
    const stack: string[] = []; let inStr = false, esc = false;
    for (const ch of x) {
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push(ch);
      else if (ch === "}" || ch === "]") stack.pop();
    }
    let out = x; if (inStr) out += '"';
    for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
    return out;
  };
  for (const cand of [s, stripCommas(s), stripCommas(autoClose(s)), stripCommas(autoClose(s.replace(/,\s*$/, "")))]) {
    try { return JSON.parse(cand); } catch { /* siguiente */ }
  }
  return { eras: [], playbook: null, error: "parse", raw_tail: s.slice(-200) };
}
const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

type Daily = { d: string; spend: number; conv: number; spend_blind: number; conv_trusted: number };
type AdRow = {
  ad_name: string; campaign_name: string | null; adset_name: string | null; creative_type: string | null;
  spend: number; conv: number; impressions: number; clicks: number;
  ctr: number | null; thumbstop: number | null; freq: number | null; preview: string | null;
};
type AdLife = { ad_name: string; campaign_name: string | null; first_day: string; last_day: string; active_days: number; spend: number; conv: number; impressions: number; max_freq: number | null };
type ActorRow = { account_id: string; actor_name: string; month: string; actions: number; traf_actions: number; is_human: boolean };

// ── Detección de eras: parte los meses por las (K-1) mayores rupturas de CPA ──
function detectEras(daily: Daily[]): { from: string; to: string }[] {
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
  if (months.length <= 1) return months[0] ? [{ from: months[0].firstDay, to: months[0].lastDay }] : [];

  const K = Math.min(5, Math.max(2, Math.round(months.length / 2)));
  const MIN_GAP = months.length >= 5 ? 2 : 1;
  const boundaries: { idx: number; mag: number }[] = [];
  for (let i = 0; i < months.length - 1; i++) {
    const a = months[i].cpa, b = months[i + 1].cpa;
    boundaries.push({ idx: i + 1, mag: a != null && b != null && a > 0 ? Math.abs(b - a) / a : 0 });
  }
  const chosen: number[] = [];
  for (const b of boundaries.filter((x) => x.mag > 0).sort((x, y) => y.mag - x.mag)) {
    if (chosen.length >= K - 1) break;
    if (b.idx < MIN_GAP || b.idx > months.length - MIN_GAP) continue;
    if (chosen.some((c) => Math.abs(c - b.idx) < MIN_GAP)) continue;
    chosen.push(b.idx);
  }
  const cuts = chosen.sort((a, b) => a - b);
  const eras: { from: string; to: string }[] = [];
  let start = 0;
  for (const sp of [...cuts, months.length]) {
    const grp = months.slice(start, sp);
    if (grp.length) eras.push({ from: grp[0].firstDay, to: grp[grp.length - 1].lastDay });
    start = sp;
  }
  return eras;
}

// Rendimiento por día de la semana + fin de semana, sobre un subconjunto diario.
function dowStats(rows: Daily[]) {
  const acc = DOW.map(() => ({ spend: 0, conv: 0 }));
  for (const r of rows) { const d = new Date(r.d + "T00:00:00Z").getUTCDay(); acc[d].spend += r.spend; acc[d].conv += r.conv; }
  const table = acc.map((v, i) => ({ dia: DOW[i], gasto: r0(v.spend), conv: v.conv, cpa: v.conv > 0 ? r2(v.spend / v.conv) : null }));
  const conCpa = table.filter((t) => t.cpa != null && t.gasto > 0);
  const best = [...conCpa].sort((a, b) => (a.cpa! - b.cpa!))[0] ?? null;
  const worst = [...conCpa].sort((a, b) => (b.cpa! - a.cpa!))[0] ?? null;
  const we = new Set([0, 6]);
  const wknd = acc.reduce((s, v, i) => we.has(i) ? { spend: s.spend + v.spend, conv: s.conv + v.conv } : s, { spend: 0, conv: 0 });
  const wkdy = acc.reduce((s, v, i) => !we.has(i) ? { spend: s.spend + v.spend, conv: s.conv + v.conv } : s, { spend: 0, conv: 0 });
  return {
    table, best, worst,
    weekend_cpa: wknd.conv > 0 ? r2(wknd.spend / wknd.conv) : null,
    weekday_cpa: wkdy.conv > 0 ? r2(wkdy.spend / wkdy.conv) : null,
    weekend_conv_pct: (wknd.conv + wkdy.conv) > 0 ? r0((wknd.conv / (wknd.conv + wkdy.conv)) * 100) : 0,
  };
}

function isoMonday(dstr: string): string {
  const d = new Date(dstr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7; // lunes=0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

// Cadencia (creativos lanzados/semana), hit rate y vida útil, sobre un subconjunto de ad_life.
function creativeStats(life: AdLife[], winnerCpa: number) {
  const launched = life.filter((a) => a.spend >= 50);
  const winners = launched.filter((a) => a.conv >= 8 && a.spend / a.conv <= winnerCpa);
  const weeks = new Map<string, number>();
  for (const a of life) if (a.spend >= 20) weeks.set(isoMonday(a.first_day), (weeks.get(isoMonday(a.first_day)) ?? 0) + 1);
  const perWeek = [...weeks.values()];
  const runners = life.filter((a) => a.spend >= 100).map((a) => a.active_days).sort((a, b) => a - b);
  const median = runners.length ? runners[Math.floor(runners.length / 2)] : null;
  const longRunners = [...life].filter((a) => a.spend >= 150).sort((a, b) => b.active_days - a.active_days).slice(0, 5)
    .map((a) => ({ name: a.ad_name, dias: a.active_days, gasto: r0(a.spend), conv: a.conv, cpa: a.conv > 0 ? r2(a.spend / a.conv) : null }));
  return {
    lanzados: launched.length,
    ganadores: winners.length,
    hit_rate: launched.length ? r0((winners.length / launched.length) * 100) : 0,
    cadencia_semana: perWeek.length ? r2(perWeek.reduce((s, n) => s + n, 0) / perWeek.length) : 0,
    vida_media_dias: runners.length ? r0(runners.reduce((s, n) => s + n, 0) / runners.length) : null,
    vida_mediana_dias: median,
    longevos: longRunners,
  };
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
  return {
    n_creativos: ads.length,
    lal_pct: total > 0 ? r0((lalSpend / total) * 100) : 0,
    broad_pct: total > 0 ? r0((broadSpend / total) * 100) : 0,
    naming_ok_pct: ads.length > 0 ? r0((namingOk / ads.length) * 100) : 0,
    freq_media: freqs.length ? r2(freqs.reduce((s, f) => s + f, 0) / freqs.length) : null,
    formatos: { video: r0(fmt.video), imagen: r0(fmt.imagen), carrusel: r0(fmt.carrusel), otro: r0(fmt.otro) },
    angulos: [...angles.entries()].map(([ang, v]) => ({ angulo: ang, gasto: r0(v.spend), conv: v.conv }))
      .sort((a, b) => b.gasto - a.gasto).slice(0, 6),
    ganadores: withCpa.filter((a) => a.conv >= 5 && a.gasto >= 150).sort((a, b) => (a.cpa ?? 1e9) - (b.cpa ?? 1e9)).slice(0, 6),
    quemadores: withCpa.filter((a) => a.gasto >= 250 && (a.conv === 0 || (a.cpa ?? 0) >= 90)).sort((a, b) => b.gasto - a.gasto).slice(0, 5),
  };
}

// Actor humano dominante en un rango de meses (suma traf_actions entre cuentas).
function actorsForRange(actorRows: ActorRow[], from: string, to: string) {
  const months = new Set<string>();
  const d = new Date(from + "T00:00:00Z"), end = new Date(to + "T00:00:00Z");
  for (let x = new Date(d); x <= end; x.setUTCMonth(x.getUTCMonth() + 1)) months.add(x.toISOString().slice(0, 7));
  const agg = new Map<string, number>();
  for (const r of actorRows) {
    if (!r.is_human || !months.has(r.month)) continue;
    agg.set(r.actor_name, (agg.get(r.actor_name) ?? 0) + r.traf_actions);
  }
  return [...agg.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, acciones]) => ({ name, acciones }));
}

async function buildReport() {
  const { data: dailyRaw, error } = await sb.rpc("traf999_daily");
  if (error) throw new Error(`daily: ${error.message}`);
  const daily = (dailyRaw ?? []).map((r: Record<string, unknown>) => ({
    d: String(r.d), spend: Number(r.spend) || 0, conv: Number(r.conv) || 0,
    spend_blind: Number(r.spend_blind) || 0, conv_trusted: Number(r.conv_trusted) || 0,
  })) as Daily[];

  const { data: lifeRaw } = await sb.rpc("traf999_ad_life");
  const adLife = (lifeRaw ?? []).map((a: Record<string, unknown>) => ({
    ad_name: String(a.ad_name ?? ""), campaign_name: (a.campaign_name as string) ?? null,
    first_day: String(a.first_day), last_day: String(a.last_day), active_days: Number(a.active_days) || 0,
    spend: Number(a.spend) || 0, conv: Number(a.conv) || 0, impressions: Number(a.impressions) || 0, max_freq: a.max_freq != null ? Number(a.max_freq) : null,
  })) as AdLife[];

  const { data: actorRaw } = await sb.from("traficker_actor_activity").select("account_id, actor_name, month, actions, traf_actions, is_human");
  const actorRows = (actorRaw ?? []) as ActorRow[];

  const totalSpend = daily.reduce((s, r) => s + r.spend, 0);
  const totalConv = daily.reduce((s, r) => s + r.conv, 0);
  const blindSpend = daily.reduce((s, r) => s + r.spend_blind, 0);
  const globalCpa = totalConv > 0 ? totalSpend / totalConv : 0;
  const winnerCpa = Math.max(35, globalCpa);

  const topConvDays = [...daily].sort((a, b) => b.conv - a.conv).slice(0, 6)
    .map((r) => ({ d: r.d, dia: DOW[new Date(r.d + "T00:00:00Z").getUTCDay()], conv: r.conv, gasto: r0(r.spend), cpa: r.conv > 0 ? r2(r.spend / r.conv) : null }));

  const globalMeta = {
    desde: daily[0]?.d ?? null, hasta: daily[daily.length - 1]?.d ?? null,
    gasto: r0(totalSpend), conversiones: totalConv,
    cpa_blended: totalConv > 0 ? r2(globalCpa) : null,
    gasto_a_ciegas: r0(blindSpend), pct_ciego: totalSpend > 0 ? r0((blindSpend / totalSpend) * 100) : 0,
    cpa_efectivo: totalConv > 0 ? r2((totalSpend - blindSpend) / totalConv) : null,
    dow: dowStats(daily),
    dias_relevantes: topConvDays,
    creativos: creativeStats(adLife, winnerCpa),
    nota_calidad: "Las 'conversiones' de Meta son eventos del píxel, NO ventas verificadas. Nov-Dic 2025: sin conversiones registradas. Ene-Mar 2026: fase de test del evento de compra (campañas TYP_TEST) con conteos inflados y CPA irreal (<€15). Abr-2026 en adelante: evento actual (purchase_or_lead). Además, el 63% del gasto se optimizó a un 'purchase' que el píxel nunca registró.",
  };

  const eraRanges = detectEras(daily);
  const eras: Record<string, unknown>[] = [];
  let prevCpa: number | null = null;
  let idx = 0;
  for (const er of eraRanges) {
    idx++;
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
    const lifeInEra = adLife.filter((a) => a.first_day >= er.from && a.first_day <= er.to);
    const dias = new Set(inRange.filter((r) => r.spend > 0).map((r) => r.d)).size;
    const tendencia = prevCpa != null && cpa != null ? r0(((cpa - prevCpa) / prevCpa) * 100) : null;
    const actors = actorsForRange(actorRows, er.from, er.to);
    eras.push({
      label: `Traficker ${idx}`, from: er.from, to: er.to, dias,
      actores: actors,
      gasto: r0(spend), conversiones: conv,
      cpa_blended: cpa != null ? r2(cpa) : null,
      cpa_efectivo: conv > 0 ? r2((spend - blind) / conv) : null,
      gasto_a_ciegas: r0(blind), pct_ciego: spend > 0 ? r0((blind / spend) * 100) : 0,
      tendencia_cpa_pct: tendencia,
      conv_dudosa: conv === 0 || (cpa != null && cpa < 15), // eventos de test/lead, no ventas 9,99 comparables
      dow: dowStats(inRange),
      creativos: creativeStats(lifeInEra, winnerCpa),
      ...detail,
    });
    prevCpa = cpa;
  }

  // Síntesis IA
  const key = (process.env.ANTHROPIC_API_KEY ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  let ai: Record<string, unknown> = { eras: [], playbook: null, error: key ? null : "no_llm" };
  if (key && eras.length > 0) {
    const system = `Eres director de adquisición (paid media) de Mente Sana, psicología online. Producto: diagnóstico 9,99€. Analizas la historia REAL y COMPLETA de la cuenta de Meta (desde nov-2025), ya troceada por "eras" de traficker (auto-detectadas por rupturas de CPA) y ATRIBUIDA a la persona real que operó cada era (campo "actores", del activity log). Tu misión: convertir todo esto en MEMORIA INSTITUCIONAL para que el siguiente traficker no empiece de cero.

Habla en español, directo, con CIFRAS de los datos (no inventes). Aprovecha TODO: rendimiento por día de la semana y fin de semana (campo dow), días relevantes, cadencia de lanzamiento de creativos, hit rate (% de creativos lanzados que ganan) y vida útil de los creativos (campo creativos). Contexto crítico: el ${globalMeta.pct_ciego}% del gasto (€${globalMeta.gasto_a_ciegas}) se optimizó a un evento 'purchase' que el píxel NUNCA registró → Meta optimizó a ciegas e infló el CPA de forma estructural, independiente del traficker.

CALIDAD DE DATO (¡crítico!): ${globalMeta.nota_calidad} Cuando una era tenga conv_dudosa=true (CPA irreal <€15 o 0 conversiones), NO la elogies por su "buen CPA" — ese conteo son eventos de test/leads, no ventas 9,99. En esas eras, el aprendizaje es sobre el tracking/estructura, no sobre eficiencia de compra.

Responde SOLO JSON válido:
{
 "eras": [ { "label": "Traficker 1", "actor": "nombre real dominante o null",
    "titulo": "apodo corto de su estilo", "resumen": "2-3 frases con cifras",
    "funciono": [{"t":"táctica","metric":"cifra"}], "fallo": [{"t":"error","metric":"cifra"}],
    "para_el_siguiente": ["acción concreta"], "tags": ["creativo","segmentacion","puja","embudo","tracking","cadencia","timing"] } ],
 "claves_exito": ["3-5 claves CONCRETAS de lo que hacían los que bajaban el CAC, cada una con su cifra (creativo, ángulo, segmentación, día, cadencia…)"],
 "claves_fracaso": ["3-5 claves CONCRETAS de lo que disparaba el CAC o hundía resultados, cada una con su cifra"],
 "conclusiones": {
    "mejores_dias": ["mejores y peores días de la semana con su CPA (usa el campo dow); di explícitamente qué pasa en SÁBADOS y findes vs entre semana, con cifras"],
    "cadencia_ads": ["cada cuánto se montaban ads y qué ritmo funcionó mejor (usa creativos.cadencia_semana, hit_rate y vida útil): cuántos creativos nuevos/semana, cada cuánto refrescar"],
    "que_mas_hacian": ["otros patrones de lo que MÁS hacían los que cerraban CAC bajo (formatos, LAL vs broad, nº de ángulos, escalado…), con cifras"]
 },
 "playbook": { "gana": ["regla con cifras"], "evita": ["regla con cifras"],
    "timing": ["cuándo lanzar/escalar: mejor día, findes, cadencia — con cifras"],
    "creativos": ["hit rate + vida útil: cada cuánto refrescar, qué dura — con cifras"],
    "arreglar_ya": ["fixes de tracking/infra"] }
}
Un elemento por era con el MISMO label. 2-4 bullets por lista. Las claves y conclusiones deben ser AFIRMACIONES tajantes con números, no genéricas.

CRÍTICO de FORMATO: devuelve JSON 100% válido. Dentro de los valores de texto NO uses comillas dobles (") — si necesitas citar un nombre de anuncio o ángulo usa comillas simples ('VOLVER'). No pongas comas colgantes. No añadas texto fuera del JSON.`;
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-opus-4-7", max_tokens: 8000, system,
          messages: [{ role: "user", content: `DATOS:\n${JSON.stringify({ global: globalMeta, eras })}` }],
        }),
      });
      const j = await res.json();
      const text: string = j?.content?.[0]?.text ?? "";
      ai = safeParseAiJson(text);
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
  // Auth: cookie de traficker/admin O x-insights-secret (para hornear el informe).
  const secret = (req.headers.get("x-insights-secret") ?? "").trim();
  const bySecret = !!secret && secret === (process.env.INSIGHTS_SECRET ?? "REDACTED_SECRET");
  if (!bySecret) {
    const auth = await requireTrafickerOrAdmin(req);
    if (auth instanceof NextResponse) return auth;
  }
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";

  let report: Awaited<ReturnType<typeof buildReport>> | null = null;
  let cached = false;
  // CONGELADO: si hay informe guardado se devuelve SIEMPRE (no se recalcula solo).
  // Solo se regenera con ?refresh=1 (botón ↻ Recalcular) o si no existe cache.
  if (!refresh) {
    const { data } = await sb.from("traficker_playbook_cache").select("*").eq("id", CACHE_ID).maybeSingle();
    if (data?.report) { report = data.report; cached = true; }
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
