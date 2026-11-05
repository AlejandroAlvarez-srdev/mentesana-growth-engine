import { describe, it, expect, vi } from "vitest";
import { invoiceToRow, isInvoicePaidEvent, storeInvoicePayment } from "./stripe-invoices";

const T0 = 1_761_955_200; // 2025-11-01T00:00:00Z
const T1 = T0 + 30 * 86_400;

describe("isInvoicePaidEvent", () => {
  it("acepta invoice.paid e invoice.payment_succeeded y nada más", () => {
    expect(isInvoicePaidEvent("invoice.paid")).toBe(true);
    expect(isInvoicePaidEvent("invoice.payment_succeeded")).toBe(true);
    expect(isInvoicePaidEvent("invoice.payment_failed")).toBe(false);
    expect(isInvoicePaidEvent("checkout.session.completed")).toBe(false);
  });
});

describe("invoiceToRow", () => {
  it("mapea una factura de ciclo con la API nueva (parent.subscription_details, pricing)", () => {
    const row = invoiceToRow({
      id: "in_1",
      customer: "cus_1",
      customer_email: "  Ana@Example.COM ",
      amount_paid: 7499,
      currency: "eur",
      billing_reason: "subscription_cycle",
      status: "paid",
      period_start: T0 - 30 * 86_400,
      period_end: T0,
      created: T0,
      status_transitions: { paid_at: T0 + 60 },
      metadata: { inv: "x" },
      parent: { subscription_details: { subscription: "sub_1", metadata: { bono: "felicidad", inv: "sub" } } },
      lines: { data: [
        { description: "Bono Felicidad (2 plazos)", period: { start: T0, end: T1 }, pricing: { price_details: { price: "price_1", product: "prod_1" } } },
      ] },
    });
    expect(row).toEqual({
      stripe_invoice_id: "in_1",
      subscription_id: "sub_1",
      customer_id: "cus_1",
      customer_email: "ana@example.com",
      amount_paid: 7499,
      currency: "eur",
      billing_reason: "subscription_cycle",
      period_start: new Date(T0 * 1000).toISOString(),
      period_end: new Date(T1 * 1000).toISOString(),
      paid_at: new Date((T0 + 60) * 1000).toISOString(),
      product: { product_ids: ["prod_1"], price_ids: ["price_1"], descriptions: ["Bono Felicidad (2 plazos)"] },
      metadata: { bono: "felicidad", inv: "x" }, // la metadata de la factura gana
      raw_status: "paid",
    });
  });

  it("entiende el payload antiguo (subscription, subscription_details, line.price) y objetos expandidos", () => {
    const row = invoiceToRow({
      id: "in_2",
      customer: { id: "cus_2" },
      customer_email: null,
      amount_paid: 12000,
      currency: "eur",
      billing_reason: "subscription_create",
      status: "paid",
      period_start: T0,
      period_end: T0,
      created: T0,
      subscription: { id: "sub_2" },
      subscription_details: { metadata: { source: "bono" } },
      lines: { data: [
        { description: "A", price: { id: "price_a", product: { id: "prod_a" } } },
        { description: "A", price: { id: "price_a", product: "prod_a" } },
      ] },
    });
    expect(row.subscription_id).toBe("sub_2");
    expect(row.customer_id).toBe("cus_2");
    expect(row.customer_email).toBeNull();
    expect(row.metadata).toEqual({ source: "bono" });
    expect(row.product).toEqual({ product_ids: ["prod_a"], price_ids: ["price_a"], descriptions: ["A"] });
    // sin periodo en líneas → periodo de la factura; sin paid_at → created
    expect(row.period_start).toBe(new Date(T0 * 1000).toISOString());
    expect(row.paid_at).toBe(new Date(T0 * 1000).toISOString());
  });

  it("factura mínima sin suscripción ni líneas", () => {
    const row = invoiceToRow({ id: "in_3" });
    expect(row.subscription_id).toBeNull();
    expect(row.amount_paid).toBe(0);
    expect(row.paid_at).toBeNull();
    expect(row.product).toEqual({ product_ids: [], price_ids: [], descriptions: [] });
    expect(row.metadata).toEqual({});
  });
});

describe("storeInvoicePayment", () => {
  it("hace upsert por stripe_invoice_id", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ upsert }));
    const r = await storeInvoicePayment({ from }, { id: "in_9", amount_paid: 100 });
    expect(r.ok).toBe(true);
    expect(from).toHaveBeenCalledWith("stripe_invoice_payments");
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: "stripe_invoice_id" });
    expect(upsert.mock.calls[0][0].stripe_invoice_id).toBe("in_9");
  });

  it("no lanza si la tabla no existe (migración sin aplicar)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const upsert = vi.fn().mockResolvedValue({ error: { code: "42P01", message: 'relation "stripe_invoice_payments" does not exist' } });
    const r = await storeInvoicePayment({ from: () => ({ upsert }) }, { id: "in_9" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("does not exist");
  });

  it("no lanza si el cliente lanza", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await storeInvoicePayment({ from: () => { throw new Error("boom"); } }, { id: "in_9" });
    expect(r).toEqual({ ok: false, error: "boom" });
  });
});
