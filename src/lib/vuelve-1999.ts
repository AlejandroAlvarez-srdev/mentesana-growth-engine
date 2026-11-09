// Campaña WhatsApp "vuelve con tu psicóloga" (6-nov-2026): pacientes que NO renovaron
// (sin bono vigente) pagan 19,99 € por una cita con su misma psicóloga desde el botón
// de la plantilla (payment link de la sesión suelta + client_reference_id=wa_vuelve1999).
// Este job, al ver el pago, le CREA en Amelia un bono de 1 sesión atado a la psicóloga
// de su última sesión asistida (así la puede agendar ella desde la app o la agente con
// schedule-bono) y avisa al equipo para escribirle y cerrar día y hora.
// Idempotente: upsell_paid (email, product='vuelve_1999') + claim atómico.
import Stripe from "stripe";
import { blogClient } from "@/lib/flujos-auto";
import { sendEmail } from "@/lib/emails/send";
import { ameliaQuery, ameliaExec, ameliaTable } from "@/lib/amelia-db";
import { VUELVE_PRODUCT, clonarFila, filaUpsell, fmt, pagosDeCampana } from "@/lib/vuelve-1999-core";

export { VUELVE_PRODUCT, VUELVE_REF } from "@/lib/vuelve-1999-core";

const PAYMENT_LINK = process.env.VUELVE_PAYMENT_LINK_ID || ""; // plink_… de la sesión suelta 19,99
const DESDE = Math.floor(Date.UTC(2026, 10, 6) / 1000);
const PACKAGE_TEMPLATE_ID = Number(process.env.VUELVE_PACKAGE_TEMPLATE_ID || 0); // bono cuya plantilla se clona con 1 sesión
const OPS_EMAIL = process.env.UPSELL_OPS_EMAIL || "ops@example.com";
// Servicios que no cuentan como sesión de terapia (diagnóstico 9,99, bienvenida, otras especialidades).
const SERVICIOS_NO_TERAPIA = (process.env.VUELVE_SERVICIOS_EXCLUIDOS || "").split(",").map(Number).filter(Number.isFinite);
const DIAS_VIGENCIA = 45;

function stripeClient(): Stripe | null {
  const k = (process.env.STRIPE_SECRET_KEY || "").match(/sk_(live|test)_[A-Za-z0-9]+/)?.[0];
  return k ? new Stripe(k, { httpClient: Stripe.createFetchHttpClient() }) : null;
}

const insertSql = (table: string, cols: string[]) =>
  `INSERT INTO ${table} (${cols.map((c) => `\`${c}\``).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`;

export interface VuelveGrant { ok: boolean; detail: string; customerId?: number; providerId?: number; psicologa?: string }

/** Crea 1 sesión con la psicóloga de su última sesión asistida. */
export async function grantVuelveSession(email: string): Promise<VuelveGrant> {
  const ub = ameliaTable("users"), cb = ameliaTable("customer_bookings"), ap = ameliaTable("appointments");
  const pc = ameliaTable("packages_to_customers"), pcs = ameliaTable("packages_customers_to_services");
  const [cust] = await ameliaQuery<{ id: number }>(
    `SELECT id FROM ${ub} WHERE LOWER(TRIM(email))=? AND type='customer' ORDER BY id DESC LIMIT 1`, [email]);
  if (!cust) return { ok: false, detail: "customer_not_found (el email del pago no está en Amelia)" };
  const excl = SERVICIOS_NO_TERAPIA.length ? `AND a.serviceId NOT IN (${SERVICIOS_NO_TERAPIA.map(() => "?").join(",")})` : "";
  // En Amelia, customer_bookings.status='pending' = asistió.
  const [last] = await ameliaQuery<{ providerId: number; firstName: string | null; status: string | null }>(
    `SELECT a.providerId, p.firstName, p.status FROM ${cb} b JOIN ${ap} a ON a.id=b.appointmentId
       LEFT JOIN ${ub} p ON p.id=a.providerId
      WHERE b.customerId=? AND b.status='pending' AND a.bookingStart < NOW() ${excl}
      ORDER BY a.bookingStart DESC LIMIT 1`, [cust.id, ...SERVICIOS_NO_TERAPIA]);
  if (!last?.providerId) return { ok: false, detail: "sin sesión asistida previa", customerId: cust.id };
  const base = { customerId: cust.id, providerId: last.providerId, psicologa: last.firstName ?? "" };
  if (last.status !== "visible") return { ok: false, detail: `la psicóloga ${last.firstName} ya no está activa`, ...base };

  const [tmpl] = await ameliaQuery<Record<string, unknown>>(
    `SELECT * FROM ${pc} WHERE packageId=? AND status='approved' ORDER BY id DESC LIMIT 1`, [PACKAGE_TEMPLATE_ID]);
  if (!tmpl) return { ok: false, detail: "sin plantilla de bono", ...base };
  const now = new Date(), end = new Date(now.getTime() + DIAS_VIGENCIA * 864e5);
  const bono = clonarFila(tmpl, { customerId: cust.id, status: "approved", purchased: fmt(now), start: fmt(now), end: fmt(end), bookingsCount: 1, price: 19.99 });
  const res = await ameliaExec(insertSql(pc, bono.cols), bono.values);
  const newPc = Number(res.insertId);
  const svcs = await ameliaQuery<Record<string, unknown>>(`SELECT * FROM ${pcs} WHERE packageCustomerId=?`, [Number(tmpl.id)]);
  for (const s of svcs) {
    const fila = clonarFila(s, { packageCustomerId: newPc, providerId: last.providerId, bookingsCount: 1, bookingsUsed: 0 });
    await ameliaExec(insertSql(pcs, fila.cols), fila.values);
  }
  return { ok: true, detail: `bono 1 sesión ${newPc} con ${last.firstName} (provider ${last.providerId}), vence ${fmt(end).slice(0, 10)}`, ...base };
}

export async function syncVuelve1999(): Promise<{ pagados: number; nuevos: number; granted: number; failed: number }> {
  const stripe = stripeClient();
  if (!stripe || !PAYMENT_LINK) return { pagados: 0, nuevos: 0, granted: 0, failed: 0 };
  const sb = blogClient();
  const todas: Stripe.Checkout.Session[] = [];
  for await (const s of stripe.checkout.sessions.list({ payment_link: PAYMENT_LINK, created: { gte: DESDE }, limit: 100 })) todas.push(s);
  const pagados = pagosDeCampana(todas);
  let nuevos = 0, granted = 0, failed = 0;
  for (const s of pagados) {
    const row = filaUpsell(s);
    if (!row) continue;
    const { data: ins } = await sb.from("upsell_paid").upsert(row, { onConflict: "email,product", ignoreDuplicates: true }).select("email");
    if (ins?.length) nuevos++;
  }
  const { data: pending } = await sb.from("upsell_paid").select("email, name").eq("product", VUELVE_PRODUCT).eq("session_granted", false);
  for (const row of pending ?? []) {
    const email = String(row.email);
    // Claim atómico: solo una ejecución del cron se queda con cada pago.
    const { data: claimed } = await sb.from("upsell_paid").update({ session_granted: true, granted_at: new Date().toISOString() })
      .eq("email", email).eq("product", VUELVE_PRODUCT).eq("session_granted", false).select("email");
    if (!claimed?.length) continue;
    try {
      const g = await grantVuelveSession(email);
      await sb.from("upsell_paid").update({ granted_detail: g.ok ? g.detail : `FAILED: ${g.detail}` }).eq("email", email).eq("product", VUELVE_PRODUCT);
      if (g.ok) granted++; else failed++;
      await sendEmail({
        to: OPS_EMAIL,
        subject: g.ok
          ? `✅ Vuelve con tu psicóloga (19,99): ${row.name || email} pagó — escribirle para elegir día con ${g.psicologa}`
          : `⚠️ Vuelve con tu psicóloga (19,99): ${row.name || email} pagó pero NO se pudo crear la sesión`,
        html: `<div style="font-family:Inter,sans-serif;color:#1a0a1f;line-height:1.6">
          <p><b>${row.name || "Paciente"}</b> (${email}) pagó <b>19,99 €</b> desde la campaña de WhatsApp “vuelve con tu psicóloga”.</p>
          ${g.ok
            ? `<p>Ya tiene creado en Amelia un <b>bono de 1 sesión con ${g.psicologa}</b>. 👉 Escríbele por WhatsApp para cerrar día y hora y agéndala con ese bono (o que la reserve desde la app).</p>`
            : `<p>Motivo: <b>${g.detail}</b>. 👉 Créale a mano la sesión y escríbele para elegir día y hora.</p>`}
          <p style="font-size:12px;color:#8a85a0">${g.detail}</p></div>`,
      }).catch(() => {});
    } catch (e) {
      failed++;
      // Error a medias (Amelia caída…): se suelta el claim para que el siguiente cron lo reintente.
      await sb.from("upsell_paid").update({ session_granted: false, granted_detail: `RETRY: ${e instanceof Error ? e.message : String(e)}` })
        .eq("email", email).eq("product", VUELVE_PRODUCT);
    }
  }
  return { pagados: pagados.length, nuevos, granted, failed };
}
