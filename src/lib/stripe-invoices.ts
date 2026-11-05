// Cobros de facturas de Stripe (suscripciones = bonos a plazos) → tabla
// stripe_invoice_payments del proyecto BLOG. NO toca `payments`: esa tabla es
// "sesiones de checkout" y de ella dependen el ROAS del traficker y los conteos
// del 9,99. Lo usan el webhook (invoice.paid / invoice.payment_succeeded) y el
// backfill local (scripts/backfill-stripe-invoices.mjs replica invoiceToRow).
//
// Compatibilidad de versiones de API: el payload del webhook llega en la versión
// del endpoint, que puede ser anterior a 2025-03-31 (basil). Por eso se lee tanto
// invoice.parent.subscription_details (nuevo) como invoice.subscription /
// invoice.subscription_details (antiguo), y en las líneas tanto
// pricing.price_details (nuevo) como price (antiguo).

export const INVOICE_PAID_EVENTS = ["invoice.paid", "invoice.payment_succeeded"] as const;

export function isInvoicePaidEvent(type: string): boolean {
  return (INVOICE_PAID_EVENTS as readonly string[]).includes(type);
}

export type StripeInvoicePaymentRow = {
  stripe_invoice_id: string;
  subscription_id: string | null;
  customer_id: string | null;
  customer_email: string | null;
  amount_paid: number;
  currency: string | null;
  billing_reason: string | null;
  period_start: string | null;
  period_end: string | null;
  paid_at: string | null;
  product: { product_ids: string[]; price_ids: string[]; descriptions: string[] };
  metadata: Record<string, string>;
  raw_status: string | null;
};

// Forma mínima (y tolerante a versiones) de un objeto Invoice de Stripe.
type Idish = string | { id?: string | null } | null | undefined;
type InvoiceLike = {
  id: string;
  customer?: Idish;
  customer_email?: string | null;
  amount_paid?: number | null;
  currency?: string | null;
  billing_reason?: string | null;
  period_start?: number | null;
  period_end?: number | null;
  status?: string | null;
  created?: number | null;
  metadata?: Record<string, string> | null;
  status_transitions?: { paid_at?: number | null } | null;
  // >= 2025-03-31
  parent?: {
    subscription_details?: { subscription?: Idish; metadata?: Record<string, string> | null } | null;
  } | null;
  // < 2025-03-31
  subscription?: Idish;
  subscription_details?: { metadata?: Record<string, string> | null } | null;
  lines?: {
    data?: Array<{
      description?: string | null;
      period?: { start?: number | null; end?: number | null } | null;
      pricing?: { price_details?: { price?: Idish; product?: string | null } | null } | null;
      price?: { id?: string | null; product?: Idish } | null;
    }>;
  } | null;
};

function idOf(v: Idish): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  return v.id ?? null;
}

function isoFromUnix(s: number | null | undefined): string | null {
  return typeof s === "number" && s > 0 ? new Date(s * 1000).toISOString() : null;
}

function uniq(xs: Array<string | null | undefined>): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))];
}

export function invoiceToRow(inv: InvoiceLike): StripeInvoicePaymentRow {
  const subDetails = inv.parent?.subscription_details ?? null;
  const subscriptionId = idOf(subDetails?.subscription) ?? idOf(inv.subscription);
  const subMetadata = subDetails?.metadata ?? inv.subscription_details?.metadata ?? {};
  const lines = inv.lines?.data ?? [];

  // El periodo de la factura de suscripción (period_start/end) es el periodo ANTERIOR;
  // el periodo de servicio real es el de la línea. Si no hay líneas, el de la factura.
  const firstPeriod = lines.find((l) => l.period?.start && l.period?.end)?.period;
  const periodStart = firstPeriod?.start ?? inv.period_start ?? null;
  const periodEnd = firstPeriod?.end ?? inv.period_end ?? null;

  return {
    stripe_invoice_id: inv.id,
    subscription_id: subscriptionId,
    customer_id: idOf(inv.customer),
    customer_email: inv.customer_email ? inv.customer_email.trim().toLowerCase() : null,
    amount_paid: inv.amount_paid ?? 0,
    currency: inv.currency ?? null,
    billing_reason: inv.billing_reason ?? null,
    period_start: isoFromUnix(periodStart),
    period_end: isoFromUnix(periodEnd),
    paid_at: isoFromUnix(inv.status_transitions?.paid_at) ?? isoFromUnix(inv.created),
    product: {
      product_ids: uniq(lines.map((l) => l.pricing?.price_details?.product ?? idOf(l.price?.product))),
      price_ids: uniq(lines.map((l) => idOf(l.pricing?.price_details?.price) ?? l.price?.id ?? null)),
      descriptions: uniq(lines.map((l) => l.description)),
    },
    metadata: { ...(subMetadata ?? {}), ...(inv.metadata ?? {}) },
    raw_status: inv.status ?? null,
  };
}

type UpsertCapable = {
  from(table: string): {
    upsert(row: unknown, opts: { onConflict: string }): PromiseLike<{ error: { message: string; code?: string } | null }>;
  };
};

// Guarda (idempotente por stripe_invoice_id) un cobro de factura. NUNCA lanza:
// si la tabla aún no existe (migración sin aplicar) o falla la red, solo loguea.
// Regla del repo: una tabla que falta no puede romper el webhook.
export async function storeInvoicePayment(
  supabase: UpsertCapable,
  inv: InvoiceLike,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const row = invoiceToRow(inv);
    const { error } = await supabase
      .from("stripe_invoice_payments")
      .upsert(row, { onConflict: "stripe_invoice_id" });
    if (error) {
      console.error("[webhook] stripe_invoice_payments upsert fail (¿migración sin aplicar?):", error.code, error.message, "invoice=" + inv.id);
      return { ok: false, error: error.message };
    }
    console.log("[webhook] invoice stored", { id: inv.id, reason: row.billing_reason, amount: row.amount_paid, sub: row.subscription_id });
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[webhook] stripe_invoice_payments store threw:", msg, "invoice=" + inv.id);
    return { ok: false, error: msg };
  }
}
