// Escribe la compra en `analytics_events` desde el servidor.
//
// Por qué hace falta: el pago ocurre en Stripe y el retorno va a otro dominio,
// así que el evento `purchase` de cliente NUNCA dispara en nuestra web. Meta sí
// recibe el Purchase por CAPI desde el webhook, o sea que la atribución
// publicitaria estaba bien — pero el embudo interno se cortaba en
// `initiate_checkout` y no se podía medir test → pago sin cruzar a mano con
// Stripe (0 filas de `purchase` en 7 días, 25-ago).
//
// La clave para que sirva de algo son `visitor_id` y `session_id`: viajan del
// navegador a Stripe en metadata y vuelven aquí. Sin ellos la fila existe pero
// queda huérfana y no se puede unir con el resto del embudo.
//
// OJO: analytics_events NO vive en el proyecto del blog, vive en el de la app
// (NEXT_PUBLIC_SUPABASE_URL). El webhook usa el del blog para todo lo demás, así
// que aquí se crea un cliente aparte a propósito.
import { createClient } from "@supabase/supabase-js";

export interface CompraAnalytics {
  sessionId: string;
  amountCents: number;
  currency: string;
  metadata: Record<string, string | undefined>;
}

// Logger genérico de eventos server-side a `analytics_events` (mismo proyecto que
// la compra). Se usa para payment_failed y cualquier otro evento que nazca en el
// webhook de Stripe y no en el navegador.
export async function registrarEventoEnAnalytics(
  eventName: string,
  c: CompraAnalytics & { extraProps?: Record<string, unknown> },
): Promise<void> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\n/g, "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").replace(/\n/g, "").trim();
  if (!url || !key) return;
  const md = c.metadata ?? {};
  const db = createClient(url, key, { auth: { persistSession: false } });
  await db.from("analytics_events").insert({
    event_name: eventName,
    props: {
      value: c.amountCents / 100,
      currency: c.currency,
      stripe_session_id: c.sessionId,
      variante_precio: md.variante_precio ?? "estandar",
      source: md.source ?? "",
      origen: "stripe_webhook",
      ...(c.extraProps ?? {}),
    },
    session_id: md.ms_session_id || null,
    visitor_id: md.ms_visitor_id || null,
    page_url: md.landing_url || null,
    page_path: md.landing_page || null,
    utm_source: md.utm_source || null,
    utm_medium: md.utm_medium || null,
    utm_campaign: md.utm_campaign || null,
  });
}

export async function registrarCompraEnAnalytics(c: CompraAnalytics): Promise<void> {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\n/g, "").trim();
  const key = (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  )
    .replace(/\n/g, "")
    .trim();
  if (!url || !key) return;

  const md = c.metadata ?? {};
  const db = createClient(url, key, { auth: { persistSession: false } });

  await db.from("analytics_events").insert({
    event_name: "purchase",
    props: {
      value: c.amountCents / 100,
      currency: c.currency,
      stripe_session_id: c.sessionId,
      variante_precio: md.variante_precio ?? "estandar",
      psychologist: md.psychologist ?? "",
      source: md.source ?? "",
      ab_diag: md.ab_diag ?? "",
      // Marca de dónde viene la fila: no la escribió el navegador.
      origen: "stripe_webhook",
    },
    // Si el checkout no los mandó (landings viejas), la fila entra igual pero
    // sin poder unirse al embudo. Mejor tenerla que perderla.
    session_id: md.ms_session_id || null,
    visitor_id: md.ms_visitor_id || null,
    page_url: md.landing_url || null,
    page_path: md.landing_page || null,
    utm_source: md.utm_source || null,
    utm_medium: md.utm_medium || null,
    utm_campaign: md.utm_campaign || null,
  });
}
