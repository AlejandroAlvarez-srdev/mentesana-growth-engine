import { describe, expect, it } from "vitest";
import { VUELVE_PRODUCT, VUELVE_REF, clonarFila, filaUpsell, fmt, pagosDeCampana } from "./vuelve-1999-core";

type S = Parameters<typeof filaUpsell>[0];
const ses = (o: Partial<S> = {}): S => ({
  id: "cs_1", client_reference_id: VUELVE_REF, payment_status: "paid",
  customer_details: { email: "Ana@Mail.com ", name: "Ana" } as S["customer_details"],
  customer_email: null, amount_total: 1999, created: Date.UTC(2026, 10, 6, 18) / 1000, ...o,
});

describe("pagosDeCampana", () => {
  it("solo pagadas y con la referencia de la campaña", () => {
    const out = pagosDeCampana([
      ses({ id: "a" }),
      ses({ id: "b", payment_status: "unpaid" }),
      ses({ id: "c", client_reference_id: null }),
      ses({ id: "d", client_reference_id: "otra_campana" }),
    ]);
    expect(out.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("filaUpsell", () => {
  it("normaliza el email y marca la sesión como pendiente de crear", () => {
    expect(filaUpsell(ses())).toEqual({
      email: "ana@mail.com", product: VUELVE_PRODUCT, stripe_session_id: "cs_1", amount_cents: 1999,
      name: "Ana", paid_at: "2026-11-06T18:00:00.000Z", session_granted: false,
    });
  });
  it("usa customer_email si Stripe no trae customer_details", () => {
    expect(filaUpsell(ses({ customer_details: null, customer_email: "luis@mail.com" }))?.email).toBe("luis@mail.com");
  });
  it("sin email no hay fila", () => {
    expect(filaUpsell(ses({ customer_details: null, customer_email: null }))).toBeNull();
  });
});

describe("clonarFila", () => {
  it("copia todas las columnas menos id y aplica los valores nuevos encima", () => {
    const r = clonarFila({ id: 7, packageId: 3, customerId: 1, price: 280, bookingsCount: 4, extra: "x" }, { customerId: 99, price: 19.99, bookingsCount: 1 });
    expect(r.cols).toEqual(["packageId", "customerId", "price", "bookingsCount", "extra"]);
    expect(r.values).toEqual([3, 99, 19.99, 1, "x"]);
  });
  it("ignora valores nuevos de columnas que la tabla no tiene", () => {
    expect(clonarFila({ id: 1, a: 1 }, { b: 2 })).toEqual({ cols: ["a"], values: [1] });
  });
});

describe("fmt", () => {
  it("formato DATETIME de MySQL en UTC", () => {
    expect(fmt(new Date("2026-11-06T18:05:09.123Z"))).toBe("2026-11-06 18:05:09");
  });
});
