// Ventas del diagnóstico 9,99€ que entran, con su fuente/atribución (UTMs de Stripe).
// Para el panel del traficker. Reusa la lógica de admin/sales-by-utm pero filtrado a 9,99€
// y con el email enmascarado (el traficker no necesita el email completo del paciente).
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { httpClient: Stripe.createFetchHttpClient() });

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

export async function GET(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("days") || "30", 10) || 30, 1), 90);
  const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;

  try {
    const sessions: Stripe.Checkout.Session[] = [];
    let starting_after: string | undefined;
    for (let i = 0; i < 3; i++) {
      const page = await stripe.checkout.sessions.list({ limit: 100, created: { gte: since }, starting_after });
      sessions.push(...page.data);
      if (!page.has_more) break;
      starting_after = page.data[page.data.length - 1]?.id;
    }

    // Solo pagadas Y del diagnóstico 9,99€
    const paid999 = sessions.filter((s) => {
      const okPaid = s.payment_status === "paid" || s.status === "complete";
      const amount = (s.amount_total || 0) / 100;
      return okPaid && amount >= 9 && amount <= 10.5;
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

    const recent: Array<{ id: string; created: number; amount: number; email: string | null; utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string; landing: string }> = [];
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
        landing: m.landing_page || "",
      });
    }

    const sortBucket = (map: Record<string, Bucket>) =>
      Object.entries(map)
        .map(([k, v]) => ({ key: k, count: v.count, revenue: Math.round(v.revenue * 100) / 100 }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);

    return NextResponse.json({
      days,
      count: paid999.length,
      revenue: Math.round(totalRevenue * 100) / 100,
      bySource: sortBucket(bySource),
      byCampaign: sortBucket(byCampaign),
      byLanding: sortBucket(byLanding),
      recent: recent.sort((a, b) => b.created - a.created).slice(0, 60),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
