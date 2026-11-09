// Lógica pura de la campaña "vuelve con tu psicóloga" (sin Stripe, Supabase ni Amelia) — ver vuelve-1999.ts.
import type Stripe from "stripe";

export const VUELVE_PRODUCT = "vuelve_1999";
export const VUELVE_REF = "wa_vuelve1999";

export const fmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

export type SesionCheckout = Pick<Stripe.Checkout.Session, "id" | "client_reference_id" | "payment_status" | "customer_details" | "customer_email" | "amount_total" | "created">;

/** Solo las sesiones pagadas que vienen del botón de esta campaña. */
export function pagosDeCampana<T extends SesionCheckout>(sesiones: readonly T[], ref = VUELVE_REF): T[] {
  return sesiones.filter((s) => s.client_reference_id === ref && s.payment_status === "paid");
}

/** Fila para upsell_paid, o null si Stripe no trae email (no hay a quién dar la sesión). */
export function filaUpsell(s: SesionCheckout): Record<string, unknown> | null {
  const email = (s.customer_details?.email || s.customer_email || "").toLowerCase().trim();
  if (!email) return null;
  return {
    email, product: VUELVE_PRODUCT, stripe_session_id: s.id, amount_cents: s.amount_total ?? 1999,
    name: s.customer_details?.name ?? null, paid_at: new Date(s.created * 1000).toISOString(), session_granted: false,
  };
}

/**
 * Clona una fila de Amelia para un INSERT: mismas columnas que la plantilla (menos `id`),
 * con los valores de `over` encima. Así no hay que conocer todas las columnas de la tabla.
 */
export function clonarFila(tmpl: Record<string, unknown>, over: Record<string, unknown>): { cols: string[]; values: unknown[] } {
  const cols = Object.keys(tmpl).filter((k) => k !== "id");
  return { cols, values: cols.map((k) => (k in over ? over[k] : tmpl[k])) };
}
