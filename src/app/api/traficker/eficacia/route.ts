// Eficacia del lead — embudo por día de CAPTACIÓN (cohorte):
//   captadas (9,99€ pagado) → asistidas (fue al diagnóstico) → vendidas (compró terapia)
// Así el traficker ve la CALIDAD real del lead, no solo el volumen/CPA.
//
// Fuentes: captadas y vendidas desde `payments` (BLOG, verificable); asistidas =
// lo que MARCA el equipo de soporte (/api/agent/appointments/[id]/attendance):
// escribe cb.status='pending' (asistió) / 'no-show' en Amelia y attended=true en
// psychologist_clinical_notes. 'approved' es "agendada, esperando" — NO asistió.
// Cohorte = un lead se atribuye al día que pagó el 9,99; su venta/asistencia cuentan
// en ESE día aunque ocurran después (por eso los días muy recientes están "inmaduros").
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 45;

// Margen para comparar la sesión asistida con el momento del pago: la cita se
// agenda en hora Madrid y cap_at es UTC; sin holgura una sesión del mismo día
// que el pago podría quedar fuera. Una sesión asistida ANTERIOR al pago es de
// un paciente que ya venía (renovación), no la asistencia del lead captado.
const HOLGURA_MS = 24 * 3600_000;
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

  // 2) Asistidas = marcadas por soporte. Dos fuentes que el endpoint de marcado
  //    escribe a la vez; se unen por si alguna vez falló el sync a Amelia:
  //    A) Amelia: cb.status='pending' (cualquier servicio — las citas 9,99 no
  //       siempre caen en serviceId 8/11, ver /api/admin/leads-cierre).
  //    B) BLOG: psychologist_clinical_notes.attended=true → customer_id → email.
  //    Por email guardamos la ÚLTIMA sesión asistida y en (3) exigimos que sea
  //    posterior al pago del 9,99 para no contar sesiones previas del mismo email.
  const attendedAt = new Map<string, number>(); // email → ms de la última sesión asistida
  const noteAt = (email: string, ms: number) => { if (Number.isFinite(ms) && ms > (attendedAt.get(email) ?? 0)) attendedAt.set(email, ms); };
  const mysqlUtcMs = (v: string) => Date.parse(String(v).replace(" ", "T") + (String(v).endsWith("Z") ? "" : "Z"));
  let ameliaOk = false;
  try {
    const { ameliaQuery, ameliaTable } = await import("@/lib/amelia-db");
    const cb = ameliaTable("customer_bookings"), ab = ameliaTable("appointments"), ub = ameliaTable("users");
    const emails = [...new Set(captados.map((c) => c.email))];
    for (let i = 0; i < emails.length; i += 150) {
      const chunk = emails.slice(i, i + 150);
      if (chunk.length === 0) break;
      const ph = chunk.map(() => "?").join(",");
      const rows = await ameliaQuery<{ email: string; last_att: string }>(
        `SELECT LOWER(u.email) AS email, MAX(a.bookingStart) AS last_att
         FROM ${cb} cb
         JOIN ${ab} a ON a.id = cb.appointmentId
         JOIN ${ub} u ON u.id = cb.customerId
         WHERE cb.status = 'pending' AND LOWER(u.email) IN (${ph})
         GROUP BY LOWER(u.email)`,
        chunk,
      );
      for (const r of rows) if (r.email && r.last_att) noteAt(String(r.email).toLowerCase(), mysqlUtcMs(r.last_att));
    }
    // B) Red de seguridad: asistencias marcadas cuyo sync a Amelia fallara.
    const { data: notes } = await sb
      .from("psychologist_clinical_notes")
      .select("customer_id, session_date")
      .eq("attended", true)
      .gte("session_date", `${since}T00:00:00Z`)
      .not("customer_id", "is", null)
      .limit(5000);
    const byCustomer = new Map<number, number>();
    for (const n of (notes ?? []) as { customer_id: number; session_date: string }[]) {
      const ms = Date.parse(n.session_date);
      if (Number.isFinite(ms) && ms > (byCustomer.get(n.customer_id) ?? 0)) byCustomer.set(n.customer_id, ms);
    }
    const ids = [...byCustomer.keys()];
    for (let i = 0; i < ids.length; i += 150) {
      const chunk = ids.slice(i, i + 150);
      if (chunk.length === 0) break;
      const rows = await ameliaQuery<{ id: number; email: string }>(
        `SELECT id, LOWER(email) AS email FROM ${ub} WHERE id IN (${chunk.map(() => "?").join(",")})`,
        chunk,
      );
      for (const r of rows) if (r.email) noteAt(String(r.email).toLowerCase(), byCustomer.get(Number(r.id)) ?? 0);
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
    const lastAtt = attendedAt.get(c.email);
    if (lastAtt !== undefined && lastAtt >= Date.parse(c.cap_at) - HOLGURA_MS) { row.asistidas++; tAsi++; }
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
