// Estadística para cerrar pruebas A/B sin engañarnos (nov-2026).
//
// lib/ab-test.ts solo REPARTE variantes. Aquí está lo que faltaba para decidir: en
// oct-2026 declaramos «A gana 8 vs 3» en una prueba que no era significativa (p≈0,23).
// Regla de este módulo: NUNCA hay ganador salvo que, a la vez,
//   1) p < alfa (0,05, bilateral),
//   2) cada brazo haya llegado a la muestra planificada (alfa 0,05, potencia 0,8, MDE),
//   3) el reparto de visitantes sea el esperado (sin SRM, p ≥ 0,01).
//
// TypeScript puro y determinista (sin dependencias, sin Monte Carlo): P(B>A) sale de la
// fórmula cerrada para dos Beta (Evan Miller), no de simulaciones. Lo usa la
// calculadora interna /interno/ab-calculadora.

export type Arm = { visitors: number; conversions: number };

export const DEFAULT_ALPHA = 0.05;
export const DEFAULT_POWER = 0.8;
export const SRM_THRESHOLD = 0.01;

// ─────────────────────────── Funciones especiales ───────────────────────────

/** Densidad de la normal estándar. */
function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

/**
 * CDF de la normal estándar (Marsaglia 2004, serie de Taylor; error ~1e-15 en |x|<8).
 * Para colas extremas devuelve 0/1, suficiente para p-valores.
 */
export function normCdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x < -37) return 0;
  if (x > 37) return 1;
  // Para |x| grande la serie pierde precisión relativa en la cola: usamos fracción continua.
  if (Math.abs(x) > 6) {
    const t = Math.abs(x);
    // Fracción continua de Laplace para la cola Q(t) = phi(t) / (t + 1/(t + 2/(t + 3/(t + ...))))
    let f = t;
    for (let k = 60; k >= 1; k--) f = t + k / f;
    const q = normPdf(t) / f;
    return x > 0 ? 1 - q : q;
  }
  let s = x;
  let t = x;
  const x2 = x * x;
  for (let i = 3; i < 500; i += 2) {
    t = (t * x2) / i;
    const prev = s;
    s += t;
    if (s === prev) break;
  }
  return 0.5 + s * normPdf(x);
}

/** Cuantil de la normal estándar (Acklam + un paso de Halley → ~1e-15). */
export function normInv(p: number): number {
  if (!(p > 0 && p < 1)) {
    if (p === 0) return -Infinity;
    if (p === 1) return Infinity;
    return NaN;
  }
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let x: number;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - pl) {
    const q = p - 0.5;
    const r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  // Refinamiento de Halley
  const e = normCdf(x) - p;
  const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}

/** log Γ(x) (Lanczos, g=7, n=9). */
export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - logGamma(1 - x);
  const g = 7;
  const coef = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const xx = x - 1;
  let a = coef[0];
  const t = xx + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += coef[i] / (xx + i);
  return 0.5 * Math.log(2 * Math.PI) + (xx + 0.5) * Math.log(t) - t + Math.log(a);
}

function logBeta(a: number, b: number): number {
  return logGamma(a) + logGamma(b) - logGamma(a + b);
}

/** Q(a, x) = Γ(a, x)/Γ(a) regularizada superior (Numerical Recipes: serie / fracción continua). */
function gammaQ(a: number, x: number): number {
  if (x < 0 || a <= 0) return NaN;
  if (x === 0) return 1;
  const gln = logGamma(a);
  if (x < a + 1) {
    let ap = a;
    let sum = 1 / a;
    let del = sum;
    for (let n = 0; n < 1000; n++) {
      ap += 1;
      del *= x / ap;
      sum += del;
      if (Math.abs(del) < Math.abs(sum) * 1e-16) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - gln);
  }
  const FPMIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return Math.exp(-x + a * Math.log(x) - gln) * h;
}

/** P(X ≥ chi2) para una chi-cuadrado con `df` grados de libertad. */
export function chiSquareSurvival(chi2: number, df: number): number {
  if (chi2 <= 0) return 1;
  return gammaQ(df / 2, chi2 / 2);
}

// ─────────────────────────── Pruebas e intervalos ───────────────────────────

function rate(a: Arm): number {
  return a.visitors > 0 ? a.conversions / a.visitors : 0;
}

function validArm(a: Arm): boolean {
  return Number.isFinite(a.visitors) && Number.isFinite(a.conversions) && a.visitors >= 0 && a.conversions >= 0 && a.conversions <= a.visitors;
}

export type ZTest = { z: number; pValue: number; pooledRate: number; se: number };

/**
 * Prueba z de dos proporciones con varianza agrupada (pooled), p bilateral.
 * Es la que da `statsmodels.stats.proportion.proportions_ztest` y el χ² 2×2 sin corrección.
 */
export function twoProportionZTest(a: Arm, b: Arm): ZTest {
  const n1 = a.visitors;
  const n2 = b.visitors;
  if (n1 <= 0 || n2 <= 0) return { z: 0, pValue: 1, pooledRate: 0, se: 0 };
  const p = (a.conversions + b.conversions) / (n1 + n2);
  const se = Math.sqrt(p * (1 - p) * (1 / n1 + 1 / n2));
  if (se === 0) return { z: 0, pValue: 1, pooledRate: p, se: 0 };
  const z = (rate(b) - rate(a)) / se;
  const pValue = Math.min(1, 2 * normCdf(-Math.abs(z)));
  return { z, pValue, pooledRate: p, se };
}

export type Interval = { low: number; high: number };

/** Intervalo de Wilson (score) para una proporción. */
export function wilsonInterval(conversions: number, visitors: number, confidence = 0.95): Interval {
  if (visitors <= 0) return { low: 0, high: 1 };
  const z = normInv(1 - (1 - confidence) / 2);
  const p = conversions / visitors;
  const z2 = z * z;
  const den = 1 + z2 / visitors;
  const center = (p + z2 / (2 * visitors)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / visitors + z2 / (4 * visitors * visitors))) / den;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) };
}

export type Lift = {
  /** pB − pA (en tanto por uno). */
  absolute: number;
  /** IC de Wald no agrupado para pB − pA. */
  absoluteCI: Interval;
  /** pB/pA − 1. null si pA = 0. */
  relative: number | null;
  /** IC por el método delta sobre log(pB/pA). null si algún brazo tiene 0 conversiones. */
  relativeCI: Interval | null;
};

export function lift(a: Arm, b: Arm, confidence = 0.95): Lift {
  const z = normInv(1 - (1 - confidence) / 2);
  const pA = rate(a);
  const pB = rate(b);
  const absolute = pB - pA;
  const seAbs = a.visitors > 0 && b.visitors > 0 ? Math.sqrt((pA * (1 - pA)) / a.visitors + (pB * (1 - pB)) / b.visitors) : 0;
  const absoluteCI = { low: absolute - z * seAbs, high: absolute + z * seAbs };
  const relative = pA > 0 ? pB / pA - 1 : null;
  let relativeCI: Interval | null = null;
  if (a.conversions > 0 && b.conversions > 0) {
    const logRatio = Math.log(pB / pA);
    const seLog = Math.sqrt((1 - pA) / a.conversions + (1 - pB) / b.conversions);
    relativeCI = { low: Math.exp(logRatio - z * seLog) - 1, high: Math.exp(logRatio + z * seLog) - 1 };
  }
  return { absolute, absoluteCI, relative, relativeCI };
}

/**
 * P(pB > pA) con priors Beta(1,1) — fórmula cerrada (Evan Miller, «Formulas for Bayesian
 * A/B testing»). Exacta y determinista; suma αB términos (αB = conversiones B + 1).
 * Itera sobre el brazo con menos conversiones (por simetría) para acotar el coste.
 */
export function probBBeatsA(a: Arm, b: Arm): number {
  const aA = a.conversions + 1;
  const bA = a.visitors - a.conversions + 1;
  const aB = b.conversions + 1;
  const bB = b.visitors - b.conversions + 1;
  // P(pB > pA) = 1 − P(pA > pB) (continuas: P(=) = 0). Elegimos la suma más corta.
  if (aB <= aA) return clamp01(sumMiller(aA, bA, aB, bB));
  return clamp01(1 - sumMiller(aB, bB, aA, bA));
}

/** Σ_{i=0}^{αB−1} B(αA+i, βA+βB) / ((βB+i)·B(1+i, βB)·B(αA, βA)) = P(X_B > X_A). */
function sumMiller(aA: number, bA: number, aB: number, bB: number): number {
  let total = 0;
  const lbA = logBeta(aA, bA);
  for (let i = 0; i < aB; i++) {
    total += Math.exp(logBeta(aA + i, bA + bB) - Math.log(bB + i) - logBeta(1 + i, bB) - lbA);
  }
  return total;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

export type Srm = { chi2: number; pValue: number; mismatch: boolean; expectedB: number; observedB: number };

/**
 * Sample Ratio Mismatch: χ² de bondad de ajuste del reparto de visitantes contra el
 * esperado (`expectedSplitB` = fracción que debería ir a B, 0,5 en un 50/50).
 * mismatch si p < 0,01 → el experimento está roto (asignación, bots, redirecciones…).
 */
export function srmCheck(a: Arm, b: Arm, expectedSplitB = 0.5): Srm {
  const n = a.visitors + b.visitors;
  const observedB = n > 0 ? b.visitors / n : 0;
  if (n <= 0 || !(expectedSplitB > 0 && expectedSplitB < 1)) {
    return { chi2: 0, pValue: 1, mismatch: false, expectedB: expectedSplitB, observedB };
  }
  const eA = n * (1 - expectedSplitB);
  const eB = n * expectedSplitB;
  const chi2 = (a.visitors - eA) ** 2 / eA + (b.visitors - eB) ** 2 / eB;
  const pValue = chiSquareSurvival(chi2, 1);
  return { chi2, pValue, mismatch: pValue < SRM_THRESHOLD, expectedB: expectedSplitB, observedB };
}

/**
 * Visitantes POR BRAZO para detectar un cambio relativo `mdeRelative` (0,3 = +30 %) sobre
 * `baselineRate`, prueba bilateral. Fórmula clásica (Fleiss sin corrección de continuidad):
 *   n = ( z_{1−α/2}·√(2·p̄(1−p̄)) + z_{1−β}·√(p1(1−p1) + p2(1−p2)) )² / (p2 − p1)²
 * Es la que usa, p. ej., la calculadora de Evan Miller y G*Power.
 */
export function sampleSizePerArm(baselineRate: number, mdeRelative: number, alpha = DEFAULT_ALPHA, power = DEFAULT_POWER): number {
  const p1 = baselineRate;
  const p2 = baselineRate * (1 + mdeRelative);
  if (!(p1 > 0 && p1 < 1) || !(p2 > 0 && p2 < 1) || p1 === p2) return Infinity;
  const za = normInv(1 - alpha / 2);
  const zb = normInv(power);
  const pbar = (p1 + p2) / 2;
  const num = za * Math.sqrt(2 * pbar * (1 - pbar)) + zb * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2));
  return Math.ceil((num * num) / ((p2 - p1) * (p2 - p1)));
}

/** MDE relativo detectable con `nPerArm` visitantes por brazo (inversa de sampleSizePerArm, bisección). */
export function mdeForSampleSize(baselineRate: number, nPerArm: number, alpha = DEFAULT_ALPHA, power = DEFAULT_POWER): number | null {
  if (!(baselineRate > 0 && baselineRate < 1) || !(nPerArm > 0)) return null;
  let lo = 1e-6;
  let hi = 1 / baselineRate - 1 - 1e-9; // p2 < 1
  if (sampleSizePerArm(baselineRate, hi, alpha, power) > nPerArm) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (sampleSizePerArm(baselineRate, mid, alpha, power) > nPerArm) lo = mid;
    else hi = mid;
  }
  return hi;
}

// ─────────────────────────────── Veredicto ───────────────────────────────

export type VerdictCode = "ganador_B" | "ganador_A" | "sin_evidencia" | "srm_invalido" | "muestra_insuficiente";

export type VerdictInput = {
  a: Arm;
  b: Arm;
  /** Fracción del tráfico que debería ir a B (0,5 = 50/50). */
  expectedSplitB?: number;
  /** Cambio relativo mínimo que el test se planificó para detectar (0,3 = +30 %). */
  mdeRelative: number;
  /** Tasa base planificada (control). Si no se da, se usa la tasa observada de A. */
  baselineRate?: number;
  alpha?: number;
  power?: number;
};

export type VerdictResult = {
  code: VerdictCode;
  explicacion: string;
  zTest: ZTest;
  ciA: Interval;
  ciB: Interval;
  rateA: number;
  rateB: number;
  lift: Lift;
  probBBeatsA: number;
  srm: Srm;
  baselineUsed: number;
  requiredPerArm: number;
  /** Visitantes que le faltan a cada brazo para la muestra planificada. */
  missingA: number;
  missingB: number;
  missingTotal: number;
  sampleReached: boolean;
};

function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits).replace(".", ",")} %`;
}

function fmtP(p: number): string {
  if (p < 0.001) return "p < 0,001";
  return `p = ${p.toFixed(3).replace(".", ",")}`;
}

/**
 * Veredicto conservador. Orden de comprobación:
 *   1) SRM (p < 0,01) → srm_invalido: con el reparto roto, ningún número vale.
 *   2) Muestra planificada no alcanzada en algún brazo → muestra_insuficiente (aunque p < 0,05:
 *      mirar antes de tiempo y parar cuando sale «significativo» infla los falsos positivos).
 *   3) p < α → ganador_B / ganador_A según el signo.
 *   4) Si no → sin_evidencia.
 */
export function verdict(input: VerdictInput): VerdictResult {
  const { a, b } = input;
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const power = input.power ?? DEFAULT_POWER;
  const expectedSplitB = input.expectedSplitB ?? 0.5;
  const valid = validArm(a) && validArm(b);
  const zTest = twoProportionZTest(a, b);
  const rateA = rate(a);
  const rateB = rate(b);
  const srm = srmCheck(a, b, expectedSplitB);
  const baselineUsed = input.baselineRate && input.baselineRate > 0 ? input.baselineRate : rateA;
  // Muestra por brazo de un 50/50. Con reparto desigual se exige a CADA brazo (conservador).
  const requiredPerArm = sampleSizePerArm(baselineUsed, input.mdeRelative, alpha, power);
  const missingA = Number.isFinite(requiredPerArm) ? Math.max(0, requiredPerArm - a.visitors) : Infinity;
  const missingB = Number.isFinite(requiredPerArm) ? Math.max(0, requiredPerArm - b.visitors) : Infinity;
  const sampleReached = valid && Number.isFinite(requiredPerArm) && missingA === 0 && missingB === 0;
  const base = {
    zTest,
    ciA: wilsonInterval(a.conversions, a.visitors),
    ciB: wilsonInterval(b.conversions, b.visitors),
    rateA,
    rateB,
    lift: lift(a, b),
    probBBeatsA: valid ? probBBeatsA(a, b) : 0.5,
    srm,
    baselineUsed,
    requiredPerArm,
    missingA,
    missingB,
    missingTotal: missingA + missingB,
    sampleReached,
  };

  if (!valid) {
    return { ...base, code: "muestra_insuficiente", explicacion: "Datos no válidos: revisa que las conversiones no superen a los visitantes." };
  }
  if (srm.mismatch) {
    return {
      ...base,
      code: "srm_invalido",
      explicacion: `El reparto de visitantes no es el esperado (B recibe ${pct(srm.observedB)} y debería recibir ${pct(expectedSplitB)}; ${fmtP(srm.pValue)}). El experimento está roto: arregla la asignación antes de leer resultados.`,
    };
  }
  if (!Number.isFinite(requiredPerArm)) {
    return {
      ...base,
      code: "muestra_insuficiente",
      explicacion: "Aún no hay tasa base (0 conversiones en A) para calcular la muestra necesaria. Indica la tasa base planificada o espera a tener datos.",
    };
  }
  if (!sampleReached) {
    const aviso = zTest.pValue < alpha ? ` Aunque hoy sale ${fmtP(zTest.pValue)}, parar antes de tiempo dispara los falsos positivos.` : "";
    return {
      ...base,
      code: "muestra_insuficiente",
      explicacion: `Faltan ${base.missingTotal.toLocaleString("es-ES")} visitantes para la muestra planificada (${requiredPerArm.toLocaleString("es-ES")} por brazo).${aviso} No se declara ganador.`,
    };
  }
  if (zTest.pValue < alpha) {
    const winner = rateB > rateA ? "B" : "A";
    return {
      ...base,
      code: winner === "B" ? "ganador_B" : "ganador_A",
      explicacion: `${winner} convierte mejor (${pct(rateA, 2)} → ${pct(rateB, 2)}, ${fmtP(zTest.pValue)}), con la muestra planificada y sin SRM.`,
    };
  }
  return {
    ...base,
    code: "sin_evidencia",
    explicacion: `Con la muestra planificada no hay diferencia significativa (${fmtP(zTest.pValue)}). No se puede decir que una variante gane: quédate con la más simple o la de menor coste.`,
  };
}
