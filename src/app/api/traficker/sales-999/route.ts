// Ventas del diagnóstico 9,99€ que entran, con su fuente/atribución (UTMs de Stripe).
// Para el panel del traficker. Reusa la lógica de admin/sales-by-utm pero filtrado a 9,99€
// y con el email enmascarado (el traficker no necesita el email completo del paciente).
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { httpClient: Stripe.createFetchHttpClient() });
// Gasto de Meta (insights sincronizados) para el CAC por campaña.
const blog = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

function maskEmail(e: string | null): string | null {
  if (!e) return null;
  const [u, d] = e.split("@");
  if (!d) return "***";
  return `${(u?.[0] ?? "")}***@${d}`;
}

// Decodifica UTMs desde metadata (checkout embebido) o client_reference_id (payment links base64).
function extractUtms(s: Stripe.Checkout.Session): Record<string, string> {
  const meta = (s.metadata || {}) as Record<string, string>;
  if (meta.utm_source || meta.utm_medium || meta.utm_campaign) return meta;
  if (s.client_reference_id) {
    try {
      const ref = s.client_reference_id;
      const padded = ref + "=".repeat((4 - (ref.length % 4)) % 4);
      const decoded = JSON.parse(Buffer.from(padded, "base64").toString("utf-8"));
      if (typeof decoded === "object" && decoded !== null) return { ...meta, ...decoded };
    } catch {}
  }
  return meta;
}

// Rango unix [inicio, fin) de un día concreto en hora de Madrid (maneja DST).
function madridDayRangeUnix(dateStr: string): [number, number] {
  const probe = new Date(`${dateStr}T00:00:00Z`);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", timeZoneName: "shortOffset" })
    .formatToParts(probe).find((p) => p.type === "timeZoneName")?.value || "GMT+1";
  const m = off.match(/GMT([+-]\d+)/);
  const offH = m ? parseInt(m[1], 10) : 1;
  const startMs = Date.parse(`${dateStr}T00:00:00Z`) - offH * 3600_000; // medianoche Madrid en UTC
  const startS = Math.floor(startMs / 1000);
  return [startS, startS + 86400];
}

// Suma 1 día a 'YYYY-MM-DD' (para generar la serie diaria).
function addDayStr(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day + 1, 12)));
}

export async function GET(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  // Día concreto (histórico) tiene prioridad sobre el rango de N días.
  const dateParam = req.nextUrl.searchParams.get("date"); // YYYY-MM-DD (hora Madrid)
  const isDay = !!dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam);
  let since: number, until: number | null = null, days = 0;
  if (isDay) {
    [since, until] = madridDayRangeUnix(dateParam!);
    days = 1;
  } else {
    days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("days") || "30", 10) || 30, 1), 90);
    since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  }

  try {
    const sessions: Stripe.Checkout.Session[] = [];
    let starting_after: string | undefined;
    for (let i = 0; i < 4; i++) {
      const page = await stripe.checkout.sessions.list({ limit: 100, created: until ? { gte: since, lte: until } : { gte: since }, starting_after });
      sessions.push(...page.data);
      if (!page.has_more) break;
      starting_after = page.data[page.data.length - 1]?.id;
    }

    // Solo pagadas Y del diagnóstico 9,99€ (y dentro del día si aplica).
    const paid999 = sessions.filter((s) => {
      const okPaid = s.payment_status === "paid" || s.status === "complete";
      const amount = (s.amount_total || 0) / 100;
      const inWindow = until ? s.created >= since && s.created < until : true;
      return okPaid && inWindow && amount >= 9 && amount <= 10.5;
    });

    type Bucket = { count: number; revenue: number };
    const bySource: Record<string, Bucket> = {};
    const byCampaign: Record<string, Bucket> = {};
    const byLanding: Record<string, Bucket> = {};
    const bump = (map: Record<string, Bucket>, key: string, amount: number) => {
      const k = key || "(sin fuente)";
      if (!map[k]) map[k] = { count: 0, revenue: 0 };
      map[k].count++;
      map[k].revenue += amount;
    };

    const recent: Array<{ id: string; created: number; amount: number; email: string | null; utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string; utm_term: string; landing: string }> = [];
    let totalRevenue = 0;

    for (const s of paid999) {
      const amount = (s.amount_total || 0) / 100;
      totalRevenue += amount;
      const m = extractUtms(s);
      const source = m.utm_source || "directo / SEO";
      const medium = m.utm_medium || "organic";
      bump(bySource, source, amount);
      bump(byCampaign, m.utm_campaign || "", amount);
      bump(byLanding, m.landing_page || "", amount);
      recent.push({
        id: s.id,
        created: s.created,
        amount,
        email: maskEmail(s.customer_details?.email || s.customer_email || null),
        utm_source: source,
        utm_medium: medium,
        utm_campaign: m.utm_campaign || "",
        utm_content: m.utm_content || "",
        utm_term: m.utm_term || "",
        landing: m.landing_page || "",
      });
    }

    const sortBucket = (map: Record<string, Bucket>) =>
      Object.entries(map)
        .map(([k, v]) => ({ key: k, count: v.count, revenue: Math.round(v.revenue * 100) / 100 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

    // Gasto de Meta agregado por nombre de campaña en la MISMA ventana (para CAC = gasto / ventas).
    // Se casa en el cliente con utm_campaign (que el equipo mapea = nombre de campaña de Meta).
    const ymd = (sec: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(sec * 1000));
    const d1 = isDay ? dateParam! : ymd(since);
    const d2 = isDay ? dateParam! : ymd(Math.floor(Date.now() / 1000));
    let spendByCampaign: { campaign: string; spend: number; metaResults: number }[] = [];
    try {
      const { data: sp } = await blog.rpc("meta_spend_by_campaign", { d1, d2 });
      spendByCampaign = (sp ?? []).map((r: { campaign: string; spend: number; meta_results: number }) => ({ campaign: String(r.campaign), spend: Number(r.spend) || 0, metaResults: Number(r.meta_results) || 0 }));
    } catch { /* si falla el gasto, el panel sigue con volumen/atribución sin CAC */ }

    // ─── SERIE DIARIA: inversión · ventas · CAC por día (para el gráfico de barras) ───
    const salesByDay: Record<string, { sales: number; revenue: number }> = {};
    for (const s of paid999) {
      const d = ymd(s.created);
      (salesByDay[d] ??= { sales: 0, revenue: 0 });
      salesByDay[d].sales++;
      salesByDay[d].revenue += (s.amount_total || 0) / 100;
    }
    const spendByDay: Record<string, number> = {};
    try {
      const { data: sd } = await blog.rpc("meta_spend_by_day", { d1, d2 });
      for (const r of (sd ?? []) as { day: string; spend: number }[]) spendByDay[String(r.day)] = Number(r.spend) || 0;
    } catch { /* sin gasto diario → el gráfico muestra ventas sin CAC */ }
    const daily: Array<{ date: string; sales: number; revenue: number; spend: number; cac: number | null }> = [];
    for (let d = d1, guard = 0; d <= d2 && guard < 400; d = addDayStr(d), guard++) {
      const sv = salesByDay[d] ?? { sales: 0, revenue: 0 };
      const spend = spendByDay[d] ?? 0;
      daily.push({
        date: d, sales: sv.sales, revenue: Math.round(sv.revenue * 100) / 100,
        spend: Math.round(spend * 100) / 100,
        cac: sv.sales > 0 && spend > 0 ? Math.round((spend / sv.sales) * 100) / 100 : null,
      });
    }

    // ─── LTV: valor medio del cliente que entra por el 9,99€ (aprox., cruce por email) ───
    const buyerEmails = [...new Set(paid999.map((s) => (s.customer_details?.email || s.customer_email || "").trim().toLowerCase()).filter(Boolean))];
    let ltv: { buyers: number; matched: number; total_value: number; avg_value: number } | null = null;
    if (buyerEmails.length) {
      let totalCents = 0;
      const matchedEmails = new Set<string>();
      for (let i = 0; i < buyerEmails.length; i += 80) {
        const chunk = buyerEmails.slice(i, i + 80);
        const { data: pays } = await blog.from("payments").select("patient_email, amount_cents").in("patient_email", chunk).eq("status", "completed");
        for (const p of (pays ?? []) as { patient_email: string | null; amount_cents: number | null }[]) {
          totalCents += Number(p.amount_cents || 0);
          if (p.patient_email) matchedEmails.add(String(p.patient_email).toLowerCase());
        }
      }
      const matched = matchedEmails.size;
      ltv = { buyers: buyerEmails.length, matched, total_value: Math.round(totalCents / 100), avg_value: matched > 0 ? Math.round((totalCents / 100 / matched) * 100) / 100 : 0 };
    }

    return NextResponse.json({
      days,
      date: isDay ? dateParam : null,
      count: paid999.length,
      revenue: Math.round(totalRevenue * 100) / 100,
      bySource: sortBucket(bySource),
      byCampaign: sortBucket(byCampaign),
      byLanding: sortBucket(byLanding),
      spendByCampaign,
      daily,
      ltv,
      recent: recent.sort((a, b) => b.created - a.created).slice(0, 500),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
