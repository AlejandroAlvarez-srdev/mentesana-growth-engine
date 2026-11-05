import { describe, it, expect, vi } from "vitest";
import {
  OUTBOX_KIND_CAPI_PURCHASE, OUTBOX_MAX_ATTEMPTS, backoffDelayMs, capiFailureOutboxRow, enqueueOutbox, nextAfterFailure,
} from "./event-outbox";
import type { CapiPurchaseInput } from "./meta-capi-server";

const MIN = 60_000;
const H = 60 * MIN;
const NOW = new Date("2026-11-04T10:00:00.000Z");

const input: CapiPurchaseInput = {
  event_id: "purchase_cs_test_1",
  event_source_url: "https://mentesanapsicologia.com/test-diagnostico",
  value: 9.99,
  currency: "EUR",
  content_name: "Diagnóstico psicológico",
  user_data: { email: "a@b.com", country: "ES" },
  custom_data: { stripe_session_id: "cs_test_1" },
};

describe("backoff", () => {
  it("1m, 5m, 30m, 2h, 12h y se queda en 12h", () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(backoffDelayMs)).toEqual([MIN, 5 * MIN, 30 * MIN, 2 * H, 12 * H, 12 * H, 12 * H]);
    expect(backoffDelayMs(-3)).toBe(MIN);
  });

  it("reprograma hasta el 5.º fallo y marca dead al 6.º", () => {
    expect(nextAfterFailure(1, NOW)).toEqual({ status: "pending", next_attempt_at: new Date(NOW.getTime() + 5 * MIN).toISOString() });
    expect(nextAfterFailure(4, NOW)).toEqual({ status: "pending", next_attempt_at: new Date(NOW.getTime() + 12 * H).toISOString() });
    expect(nextAfterFailure(5, NOW).status).toBe("pending");
    expect(OUTBOX_MAX_ATTEMPTS).toBe(6);
    expect(nextAfterFailure(6, NOW)).toEqual({ status: "dead" });
    expect(nextAfterFailure(7, NOW)).toEqual({ status: "dead" });
  });
});

describe("capiFailureOutboxRow", () => {
  it("no encola si Meta respondió ok", () => {
    expect(capiFailureOutboxRow(input, { ok: true }, NOW)).toBeNull();
  });

  it("encola con dedupe_key = event_id y payload = los args exactos si Meta falla", () => {
    const row = capiFailureOutboxRow(input, { ok: false, error: "Invalid OAuth access token" }, NOW);
    expect(row).toEqual({
      kind: OUTBOX_KIND_CAPI_PURCHASE,
      dedupe_key: "purchase_cs_test_1",
      payload: input,
      status: "pending",
      attempts: 0,
      next_attempt_at: new Date(NOW.getTime() + MIN).toISOString(),
      last_error: "Invalid OAuth access token",
    });
    expect(row!.payload).toBe(input);
  });

  it("encola si sendCAPIPurchase lanza", () => {
    expect(capiFailureOutboxRow(input, { thrown: new Error("fetch failed") }, NOW)?.last_error).toBe("fetch failed");
    expect(capiFailureOutboxRow(input, { thrown: "raro" }, NOW)?.last_error).toBe("raro");
  });

  it("error vacío → unknown_error; sin event_id no encola", () => {
    expect(capiFailureOutboxRow(input, { ok: false }, NOW)?.last_error).toBe("unknown_error");
    expect(capiFailureOutboxRow({ ...input, event_id: "" }, { ok: false, error: "x" }, NOW)).toBeNull();
  });
});

describe("enqueueOutbox", () => {
  const row = capiFailureOutboxRow(input, { ok: false, error: "x" }, NOW)!;

  it("upsert ignorando duplicados por dedupe_key", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ upsert }));
    expect(await enqueueOutbox({ from }, row)).toBe(true);
    expect(from).toHaveBeenCalledWith("event_outbox");
    expect(upsert).toHaveBeenCalledWith(row, { onConflict: "dedupe_key", ignoreDuplicates: true });
  });

  it("se traga los errores (tabla que falta o cliente que lanza)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const upsert = vi.fn().mockResolvedValue({ error: { message: "relation does not exist" } });
    expect(await enqueueOutbox({ from: () => ({ upsert }) }, row)).toBe(false);
    expect(await enqueueOutbox({ from: () => { throw new Error("boom"); } }, row)).toBe(false);
  });
});
