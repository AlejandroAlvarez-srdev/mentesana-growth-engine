// Outbox de eventos salientes (tabla event_outbox del proyecto BLOG).
// Hoy: Purchase de Meta CAPI que falló en el webhook de Stripe. El cron
// /api/cron/outbox-relay los reintenta con backoff. Reenviar es seguro: se usa
// el MISMO event_id, así que Meta deduplica y nunca cuenta dos compras.

import type { CapiPurchaseInput } from "@/lib/meta-capi-server";

export const OUTBOX_KIND_CAPI_PURCHASE = "meta_capi_purchase";

// Esperas antes de cada intento del relay: el 1.º a 1 min de la inserción, luego
// 5 min, 30 min, 2 h y 12 h. Tras el 6.º intento fallido la fila pasa a 'dead'.
// Total ~27 h, muy por debajo de los 7 días que Meta acepta de antigüedad.
export const OUTBOX_BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000] as const;
export const OUTBOX_MAX_ATTEMPTS = 6;

// Espera tras `attempts` intentos del relay ya hechos (0 = recién encolada).
export function backoffDelayMs(attempts: number): number {
  const i = Math.max(0, Math.min(Math.floor(attempts), OUTBOX_BACKOFF_MS.length - 1));
  return OUTBOX_BACKOFF_MS[i];
}

// Qué hacer con una fila cuyo intento n.º `attempts` (ya incrementado por outbox_claim) falló.
export function nextAfterFailure(
  attempts: number,
  now: Date = new Date(),
): { status: "dead" } | { status: "pending"; next_attempt_at: string } {
  if (attempts >= OUTBOX_MAX_ATTEMPTS) return { status: "dead" };
  return { status: "pending", next_attempt_at: new Date(now.getTime() + backoffDelayMs(attempts)).toISOString() };
}

export type CapiOutcome = { ok: boolean; error?: string } | { thrown: unknown };

export type OutboxInsertRow = {
  kind: string;
  dedupe_key: string;
  payload: CapiPurchaseInput;
  status: "pending";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
};

// Decide si un envío de CAPI Purchase hay que encolarlo para reintento.
// null = salió bien, no hay nada que encolar.
export function capiFailureOutboxRow(
  input: CapiPurchaseInput,
  outcome: CapiOutcome,
  now: Date = new Date(),
): OutboxInsertRow | null {
  let lastError: string;
  if ("thrown" in outcome) {
    const t = outcome.thrown;
    lastError = t instanceof Error ? t.message : String(t);
  } else {
    if (outcome.ok) return null;
    lastError = outcome.error || "unknown_error";
  }
  if (!input.event_id) return null; // sin event_id no hay dedupe en Meta: no reintentar
  return {
    kind: OUTBOX_KIND_CAPI_PURCHASE,
    dedupe_key: input.event_id,
    payload: input,
    status: "pending",
    attempts: 0,
    next_attempt_at: new Date(now.getTime() + backoffDelayMs(0)).toISOString(),
    last_error: lastError.slice(0, 1000),
  };
}

type OutboxUpsertCapable = {
  from(table: string): {
    upsert(row: unknown, opts: { onConflict: string; ignoreDuplicates: boolean }): PromiseLike<{ error: { message: string } | null }>;
  };
};

// Best effort: encola la fila. NUNCA lanza (no puede romper el webhook).
export async function enqueueOutbox(supabase: OutboxUpsertCapable, row: OutboxInsertRow): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("event_outbox")
      .upsert(row, { onConflict: "dedupe_key", ignoreDuplicates: true });
    if (error) {
      console.error("[outbox] enqueue fail (¿migración sin aplicar?):", error.message, "key=" + row.dedupe_key);
      return false;
    }
    console.log("[outbox] enqueued", row.kind, "key=" + row.dedupe_key);
    return true;
  } catch (e) {
    console.error("[outbox] enqueue threw:", e instanceof Error ? e.message : String(e), "key=" + row.dedupe_key);
    return false;
  }
}
