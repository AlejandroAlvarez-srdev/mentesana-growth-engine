// Valores de referencia calculados con scipy 1.17 (stats.norm, stats.chisquare, integración
// numérica de Beta para P(B>A)) y la fórmula de Fleiss para el tamaño de muestra.
import { describe, expect, it } from "vitest";
import {
  chiSquareSurvival,
  lift,
  mdeForSampleSize,
  normCdf,
  normInv,
  probBBeatsA,
  sampleSizePerArm,
  srmCheck,
  twoProportionZTest,
  verdict,
  wilsonInterval,
} from "./ab-stats";

describe("funciones especiales", () => {
  it("normCdf / normInv como scipy", () => {
    expect(normCdf(-1.96)).toBeCloseTo(0.024997895, 8);
    expect(normCdf(0.5)).toBeCloseTo(0.691462461, 8);
    expect(normCdf(3)).toBeCloseTo(0.998650102, 8);
    expect(normCdf(-7) / 1.27981254e-12).toBeCloseTo(1, 6);
    expect(normInv(0.975)).toBeCloseTo(1.95996398, 7);
    expect(normInv(0.8)).toBeCloseTo(0.84162123, 7);
    expect(normInv(0.001)).toBeCloseTo(-3.09023231, 7);
    expect(normInv(1e-10)).toBeCloseTo(-6.3613409, 6);
  });

  it("chi-cuadrado (cola superior)", () => {
    expect(chiSquareSurvival(3.84, 1)).toBeCloseTo(0.0500435212, 8);
    expect(chiSquareSurvival(10, 3)).toBeCloseTo(0.0185661355, 8);
    expect(chiSquareSurvival(0.5, 1)).toBeCloseTo(0.4795001222, 8);
  });
});

describe("prueba z de dos proporciones", () => {
  it("8/1000 vs 3/1000 → no significativo (p≈0,13)", () => {
    const r = twoProportionZTest({ visitors: 1000, conversions: 8 }, { visitors: 1000, conversions: 3 });
    expect(r.z).toBeCloseTo(-1.5117196840, 8);
    expect(r.pValue).toBeCloseTo(0.1306051889, 8);
  });

  it("8/400 vs 3/350 → p≈0,19", () => {
    const r = twoProportionZTest({ visitors: 400, conversions: 8 }, { visitors: 350, conversions: 3 });
    expect(r.z).toBeCloseTo(-1.2988770245, 8);
    expect(r.pValue).toBeCloseTo(0.1939861356, 8);
  });

  it("ejemplo de manual: 200/1000 vs 250/1000 → p≈0,0074", () => {
    const r = twoProportionZTest({ visitors: 1000, conversions: 200 }, { visitors: 1000, conversions: 250 });
    expect(r.z).toBeCloseTo(2.6773977630, 8);
    expect(r.pValue).toBeCloseTo(0.0074196493, 8);
  });

  it("120/10000 vs 150/10000 → p≈0,066", () => {
    const r = twoProportionZTest({ visitors: 10000, conversions: 120 }, { visitors: 10000, conversions: 150 });
    expect(r.pValue).toBeCloseTo(0.0660341455, 8);
  });

  it("sin datos → p=1", () => {
    expect(twoProportionZTest({ visitors: 0, conversions: 0 }, { visitors: 10, conversions: 1 }).pValue).toBe(1);
    expect(twoProportionZTest({ visitors: 10, conversions: 0 }, { visitors: 10, conversions: 0 }).pValue).toBe(1);
  });
});

describe("intervalos", () => {
  it("Wilson 95 %", () => {
    const a = wilsonInterval(8, 1000);
    expect(a.low).toBeCloseTo(0.0040591958, 8);
    expect(a.high).toBeCloseTo(0.0157063345, 8);
    const b = wilsonInterval(250, 1000);
    expect(b.low).toBeCloseTo(0.2241530990, 8);
    expect(b.high).toBeCloseTo(0.2777602803, 8);
    const zero = wilsonInterval(0, 50);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeGreaterThan(0);
  });

  it("lift absoluto y relativo con IC", () => {
    const l = lift({ visitors: 1000, conversions: 200 }, { visitors: 1000, conversions: 250 });
    expect(l.absolute).toBeCloseTo(0.05, 12);
    expect(l.absoluteCI.low).toBeCloseTo(0.0134636217, 8);
    expect(l.absoluteCI.high).toBeCloseTo(0.0865363783, 8);
    expect(l.relative).toBeCloseTo(0.25, 12);
    expect(l.relativeCI!.low).toBeCloseTo(0.0609462508, 8);
    expect(l.relativeCI!.high).toBeCloseTo(0.4727419026, 8);
  });

  it("lift relativo sin conversiones en A → null", () => {
    const l = lift({ visitors: 100, conversions: 0 }, { visitors: 100, conversions: 2 });
    expect(l.relative).toBeNull();
    expect(l.relativeCI).toBeNull();
  });
});

describe("P(B>A) bayesiana, Beta(1,1)", () => {
  it.each([
    [8, 1000, 3, 1000, 0.0723936497],
    [3, 1000, 8, 1000, 0.9276063503],
    [200, 1000, 250, 1000, 0.9962833291],
    [8, 400, 3, 350, 0.1089202786],
    [120, 10000, 150, 10000, 0.9668319227],
    [30, 1000, 45, 1000, 0.9606228977],
  ])("%i/%i vs %i/%i", (xa, na, xb, nb, expected) => {
    expect(probBBeatsA({ visitors: na, conversions: xa }, { visitors: nb, conversions: xb })).toBeCloseTo(expected, 7);
  });

  it("brazos idénticos → 0,5; determinista", () => {
    const a = { visitors: 500, conversions: 20 };
    expect(probBBeatsA(a, a)).toBeCloseTo(0.5, 10);
    expect(probBBeatsA(a, { visitors: 500, conversions: 25 })).toBe(probBBeatsA(a, { visitors: 500, conversions: 25 }));
  });
});

describe("SRM", () => {
  it("5100/4900 en un 50/50 → p≈0,0455, NO es SRM (umbral 0,01)", () => {
    const s = srmCheck({ visitors: 5100, conversions: 0 }, { visitors: 4900, conversions: 0 });
    expect(s.chi2).toBeCloseTo(4, 10);
    expect(s.pValue).toBeCloseTo(0.0455002639, 8);
    expect(s.mismatch).toBe(false);
  });

  it("5300/4700 en un 50/50 → SRM", () => {
    const s = srmCheck({ visitors: 5300, conversions: 0 }, { visitors: 4700, conversions: 0 });
    expect(s.chi2).toBeCloseTo(36, 10);
    expect(s.pValue / 1.9731752900753933e-9).toBeCloseTo(1, 6);
    expect(s.mismatch).toBe(true);
  });

  it("reparto esperado 70/30 (B=0,3): 600/400 → SRM", () => {
    const s = srmCheck({ visitors: 600, conversions: 0 }, { visitors: 400, conversions: 0 }, 0.3);
    expect(s.chi2).toBeCloseTo(47.619047619, 8);
    expect(s.mismatch).toBe(true);
  });
});

describe("tamaño de muestra y MDE", () => {
  it("1 % → 1,3 % (MDE +30 %) pide 19.827 por brazo", () => {
    expect(sampleSizePerArm(0.01, 0.3)).toBe(19827);
  });
  it("otros casos", () => {
    expect(sampleSizePerArm(0.05, 0.2)).toBe(8158);
    expect(sampleSizePerArm(0.1, 0.1)).toBe(14751);
    expect(sampleSizePerArm(0.2, 0.25)).toBe(1094);
  });
  it("entradas imposibles → Infinity", () => {
    expect(sampleSizePerArm(0, 0.3)).toBe(Infinity);
    expect(sampleSizePerArm(0.01, 0)).toBe(Infinity);
  });
  it("MDE es la inversa del tamaño", () => {
    const mde = mdeForSampleSize(0.01, 19827)!;
    expect(mde).toBeGreaterThan(0.29);
    expect(mde).toBeLessThanOrEqual(0.3);
    expect(sampleSizePerArm(0.01, mde)).toBeLessThanOrEqual(19827);
  });
});

describe("verdict", () => {
  it("el caso del 8 vs 3 NO declara ganador", () => {
    const v = verdict({ a: { visitors: 1000, conversions: 8 }, b: { visitors: 1000, conversions: 3 }, mdeRelative: 0.3 });
    expect(v.code).toBe("muestra_insuficiente");
    expect(v.missingA).toBeGreaterThan(0);
  });

  it("p<0,05 pero sin la muestra planificada → muestra_insuficiente (no parar antes)", () => {
    const v = verdict({ a: { visitors: 1000, conversions: 200 }, b: { visitors: 1000, conversions: 250 }, mdeRelative: 0.1 });
    expect(v.zTest.pValue).toBeLessThan(0.05);
    expect(v.code).toBe("muestra_insuficiente");
    expect(v.requiredPerArm).toBe(sampleSizePerArm(0.2, 0.1));
    expect(v.missingTotal).toBe(2 * (v.requiredPerArm - 1000));
    expect(v.explicacion).toMatch(/parar antes/);
  });

  it("p<0,05 + muestra alcanzada + sin SRM → ganador_B", () => {
    const v = verdict({ a: { visitors: 1000, conversions: 200 }, b: { visitors: 1000, conversions: 250 }, mdeRelative: 0.25 });
    expect(v.requiredPerArm).toBe(1094);
    // 1000 < 1094 → aún insuficiente
    expect(v.code).toBe("muestra_insuficiente");
    const v2 = verdict({ a: { visitors: 1100, conversions: 220 }, b: { visitors: 1100, conversions: 275 }, mdeRelative: 0.25 });
    expect(v2.code).toBe("ganador_B");
    expect(v2.missingTotal).toBe(0);
  });

  it("ganador_A si A es mejor", () => {
    const v = verdict({ a: { visitors: 1100, conversions: 275 }, b: { visitors: 1100, conversions: 220 }, mdeRelative: 0.25, baselineRate: 0.2 });
    expect(v.code).toBe("ganador_A");
  });

  it("muestra alcanzada sin significación → sin_evidencia", () => {
    const v = verdict({ a: { visitors: 20000, conversions: 200 }, b: { visitors: 20000, conversions: 215 }, mdeRelative: 0.3 });
    expect(v.sampleReached).toBe(true);
    expect(v.code).toBe("sin_evidencia");
  });

  it("SRM tiene prioridad aunque haya p<0,05", () => {
    const v = verdict({ a: { visitors: 5300, conversions: 1060 }, b: { visitors: 4700, conversions: 1200 }, mdeRelative: 0.1 });
    expect(v.zTest.pValue).toBeLessThan(0.05);
    expect(v.code).toBe("srm_invalido");
  });

  it("datos imposibles → muestra_insuficiente", () => {
    const v = verdict({ a: { visitors: 10, conversions: 20 }, b: { visitors: 10, conversions: 1 }, mdeRelative: 0.3 });
    expect(v.code).toBe("muestra_insuficiente");
  });

  it("sin conversiones en A ni tasa base → muestra_insuficiente", () => {
    const v = verdict({ a: { visitors: 100, conversions: 0 }, b: { visitors: 100, conversions: 0 }, mdeRelative: 0.3 });
    expect(v.code).toBe("muestra_insuficiente");
  });
});
