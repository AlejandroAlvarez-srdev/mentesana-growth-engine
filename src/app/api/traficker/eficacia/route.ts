// Eficacia del lead — embudo por día de CAPTACIÓN (cohorte):
//   captadas (9,99€ pagado) → asistidas (fue al diagnóstico) → vendidas (compró terapia)
// Así el traficker ve la CALIDAD real del lead, no solo el volumen/CPA.
//
// Fuentes: captadas y vendidas desde `payments` (BLOG, verificable); asistidas
// desde Amelia en vivo (cb.status='approved' en servicios de diagnóstico), best-effort.
// Cohorte = un lead se atribuye al día que pagó el 9,99; su venta/asistencia cuentan
// en ESE día aunque ocurran después (por eso los días muy recientes están "inmaduros").
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

const DIAG_SERVICE_IDS = [8, 11]; // servicios de diagnóstico en Amelia (ver regla de asistencia)
const madridDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date(iso));
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);

export async function GET(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("days") || "30", 10) || 30, 7), 90);
  const sinceDate = new Date(Date.now() - days * 86400000);
  const since = sinceDate.toISOString().slice(0, 10);

  // 1) Captados (9,99€) y ventas de terapia, desde payments
  const [{ data: capRaw, error: capErr }, { data: venRaw }] = await Promise.all([
    sb.rpc("traf_captados", { p_since: since }),
    sb.rpc("traf_ventas", { p_since: since }),
  ]);
  if (capErr) return NextResponse.json({ error: capErr.message }, { status: 500 });
  const captados: { email: string; cap_at: string }[] = (capRaw ?? []).map((r: Record<string, unknown>) => ({ email: String(r.email), cap_at: String(r.cap_at) }));
  const ventas = new Map<string, string>();
  for (const r of (venRaw ?? []) as Record<string, unknown>[]) ventas.set(String(r.email), String(r.sold_at));

  // 2) Asistidas (Amelia en vivo, best-effort): emails captados que fueron al diagnóstico
  const attended = new Set<string>();
  let ameliaOk = false;
  try {
    const { ameliaQuery, ameliaTable } = await import("@/lib/amelia-db");
    const cb = ameliaTable("customer_bookings"), ab = ameliaTable("appointments"), ub = ameliaTable("users");
    const emails = captados.map((c) => c.email);
    for (let i = 0; i < emails.length; i += 150) {
      const chunk = emails.slice(i, i + 150);
      if (chunk.length === 0) break;
      const ph = chunk.map(() => "?").join(",");
      const rows = await ameliaQuery<{ email: string }>(
        `SELECT DISTINCT LOWER(u.email) AS email
         FROM ${cb} cb
         JOIN ${ab} a ON a.id = cb.appointmentId
         JOIN ${ub} u ON u.id = cb.customerId
         WHERE cb.status = 'approved' AND a.serviceId IN (${DIAG_SERVICE_IDS.join(",")})
           AND LOWER(u.email) IN (${ph})`,
        chunk,
      );
      for (const r of rows) if (r.email) attended.add(String(r.email).toLowerCase());
    }
    ameliaOk = true;
  } catch { ameliaOk = false; }

  // 3) Agregado por día de captación (cohorte)
  type Row = { captadas: number; asistidas: number; vendidas: number };
  const byDay = new Map<string, Row>();
  let tCap = 0, tAsi = 0, tVen = 0;
  const now = Date.now();
  for (const c of captados) {
    const day = madridDay(c.cap_at);
    const row = byDay.get(day) ?? { captadas: 0, asistidas: 0, vendidas: 0 };
    row.captadas++; tCap++;
    if (attended.has(c.email)) { row.asistidas++; tAsi++; }
    const sold = ventas.get(c.email);
    if (sold && sold >= c.cap_at) { row.vendidas++; tVen++; }
    byDay.set(day, row);
  }

  const daily = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, r]) => {
    const ageDays = Math.floor((now - new Date(date + "T12:00:00Z").getTime()) / 86400000);
    return {
      date, ...r,
      pct_asist: ameliaOk ? pct(r.asistidas, r.captadas) : null,
      pct_venta: pct(r.vendidas, r.captadas),
      inmaduro: ageDays < 10, // aún convirtiendo/asistiendo
    };
  });

  return NextResponse.json({
    days, since,
    amelia_ok: ameliaOk,
    totales: {
      captadas: tCap,
      asistidas: ameliaOk ? tAsi : null,
      vendidas: tVen,
      pct_asist: ameliaOk ? pct(tAsi, tCap) : null,
      pct_venta: pct(tVen, tCap),
      pct_venta_sobre_asist: ameliaOk ? pct(tVen, tAsi) : null,
    },
    daily,
  });
}
