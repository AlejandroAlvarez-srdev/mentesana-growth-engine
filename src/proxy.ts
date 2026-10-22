import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const url = request.nextUrl;
  const host = (request.headers.get("host") ?? "").toLowerCase();

  // Pixel + banner AEPD viven en .mentesanapsicologia.com. En el alias *.vercel.app
  // no se cargan → Meta no recibe LPV/IC/Purchase → CAC se infla aunque haya ventas.
  // Redirigimos 301 a landings.mentesanapsicologia.com preservando path + query.
  if (host === "mentesana-psicologia.vercel.app") {
    const dest = new URL(url.pathname + url.search, "https://landings.mentesanapsicologia.com");
    return NextResponse.redirect(dest, 301);
  }

  // ELIMINADO el redirect 307 a /por-que-diagnostico-social-proof — rompía la atribución
  // del Pixel (el fbclid se perdía en el cross-version redirect, LPV no se registraba con
  // el click_id original). Ahora el tráfico paid y orgánico ve la misma /por-que-diagnostico,
  // disparando Pixel directo con fbclid intacto. Si queremos volver a tener la variante
  // social-proof para paid, hay que apuntar las ads directamente a /por-que-diagnostico-social-proof
  // en Meta (no vía proxy).

  // ── A/B TEST: /diagnostico (control) vs /test-diagnostico (funnel directo) ──
  // Split 50/50 sticky por cookie. Variante B se sirve por REWRITE (no redirect)
  // para no perder fbclid/_fbc → el pixel sigue atribuyendo igual. La variante se
  // cuelga en cada evento via la cookie ms_ab_diag (ver src/lib/tracking.ts), así
  // que la conversión (purchase) queda segmentada por variante.
  if (url.pathname === "/diagnostico") {
    const prev = request.cookies.get("ms_ab_diag")?.value;
    const variant = prev === "A" || prev === "B" ? prev : (Math.random() < 0.5 ? "A" : "B");
    const res = variant === "B"
      ? NextResponse.rewrite(new URL("/test-diagnostico" + url.search, url))
      : NextResponse.next();
    if (variant !== prev) {
      res.cookies.set("ms_ab_diag", variant, { path: "/", maxAge: 60 * 60 * 24 * 90, sameSite: "lax" });
    }
    res.headers.set("x-ab-diag", variant);
    // Cuando servimos el funnel directo (variante B de este test) asignamos también
    // la variante del 2º test: "calentamiento" del match (B) vs match clásico (A).
    if (variant === "B") {
      applyWarming(res, request, resolveWarming(url));
      applyPago(res, request, resolvePago(url, request));
    }
    return res;
  }

  // ── A/B TEST #2: match con capa de "calentamiento" (B) vs match clásico (A) ──
  // Solo aplica al funnel /test-diagnostico. Reparto 50/50 sticky por cookie
  // ms_ab_warming; tracking.ts la cuelga como ab_warming en cada evento. Override
  // de QA con ?warming=A|B (también fija la cookie para que la sesión sea coherente).
  if (url.pathname === "/test-diagnostico") {
    const res = NextResponse.next();
    applyWarming(res, request, resolveWarming(url));
    applyPago(res, request, resolvePago(url, request));
    return res;
  }

  // ── A/B TEST #3: landing /por-que-diagnostico — challenger (B) vs control (A) ──
  // Reparto 50/50 sticky por cookie ms_ab_landing; page.tsx lee la cookie en SSR y
  // renderiza A o B → sin flash/CLS. Los BOTS (sin cookie) caen siempre en A (el
  // contenido indexado): A/B testing conforme a Google, no cloaking. tracking.ts la
  // cuelga como ab_landing en cada evento; /api/create-checkout la estampa en Stripe
  // → conversión a pago medible por variante. Override QA con ?landing=A|B.
  if (url.pathname === "/por-que-diagnostico") {
    const override = url.searchParams.get("landing");
    const prev = request.cookies.get("ms_ab_landing")?.value;
    // GANADOR: B se lleva el 100% del tráfico (test cerrado). Solo el override de QA
    // ?landing=A permite ver el antiguo control. Se sigue poniendo cookie/header en B
    // para que tracking cuelgue ab_landing=B y la atribución a pago quede coherente.
    const variant: "A" | "B" = override === "A" || override === "B" ? override : "B";
    // Pasamos la variante por header de REQUEST para que page.tsx la lea en SSR ya en
    // la primera visita (la cookie aún no viaja en esa primera request). Así el HTML
    // inicial ya es el correcto: sin flash, sin CLS.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-ab-landing", variant);

    // ── A/B TEST #4 "directo": el botón de la landing → portada del test (A) vs
    // pregunta 1 directa con ?directo=1 (B). Estudio /interno/subir-el-082 (oct-2026):
    // la entrada directa al test paga 4,4 % por sesión y la portada 0,64 %. Reparto
    // 50/50 sticky por cookie ms_ab_directo (path "/": persiste landing → test →
    // checkout). page.tsx la lee por header de request en SSR y cambia el ctaBase;
    // tracking.ts la cuelga como ab_directo en cada evento; /api/create-checkout la
    // estampa en Stripe → pago por variante. Override QA: ?flujo=A|B.
    const overrideDirecto = url.searchParams.get("flujo");
    const prevDirecto = request.cookies.get("ms_ab_directo")?.value;
    const directo: "A" | "B" = overrideDirecto === "A" || overrideDirecto === "B"
      ? overrideDirecto
      : prevDirecto === "A" || prevDirecto === "B" ? prevDirecto : (Math.random() < 0.5 ? "A" : "B");
    requestHeaders.set("x-ab-directo", directo);

    const res = NextResponse.next({ request: { headers: requestHeaders } });
    if (variant !== prev) {
      res.cookies.set("ms_ab_landing", variant, { path: "/", maxAge: 60 * 60 * 24 * 90, sameSite: "lax" });
    }
    if (directo !== prevDirecto) {
      res.cookies.set("ms_ab_directo", directo, { path: "/", maxAge: 60 * 60 * 24 * 90, sameSite: "lax" });
    }
    res.headers.set("x-ab-landing", variant);
    res.headers.set("x-ab-directo", directo);
    // El 5º test (pago en una pantalla) también se asigna aquí para que la cookie ya
    // exista cuando la persona pase al test y la lectura landing → pago sea una sola.
    applyPago(res, request, resolvePago(url, request));
    return res;
  }

  return NextResponse.next();
}

// GANADOR: el calentamiento (B) se lleva el 100% del tráfico (test cerrado). Solo el
// override de QA ?warming=A permite ver el match clásico. Se sigue fijando la cookie en
// B para que tracking cuelgue ab_warming=B y la atribución quede coherente.
function resolveWarming(url: URL): "A" | "B" {
  const override = url.searchParams.get("warming");
  if (override === "A" || override === "B") return override;
  return "B";
}

// Fija la cookie (si cambió) y el header de debug para la variante de calentamiento.
function applyWarming(res: NextResponse, request: NextRequest, variant: "A" | "B") {
  const prev = request.cookies.get("ms_ab_warming")?.value;
  if (variant !== prev) {
    res.cookies.set("ms_ab_warming", variant, { path: "/", maxAge: 60 * 60 * 24 * 90, sameSite: "lax" });
  }
  res.headers.set("x-ab-warming", variant);
}

// ── A/B TEST #5 "una pantalla": psicóloga + hora + pago en una sola pantalla (B) vs
// las tres pantallas de hoy, match → calendario → pago (A). Acción 2 del estudio
// /interno/subir-el-082 (oct-2026): hoy paga el 22 % de quienes ven a su psicóloga;
// objetivo ≥ 30 %. Reparto 50/50 sticky por cookie ms_ab_pago (path "/", 90 días) que
// se fija en /test-diagnostico, en /diagnostico (cuando sirve el test) y en la landing.
// DiagnosticoMatching la lee en cliente al llegar a la fase de hora (PagoUnaPantalla);
// tracking.ts la cuelga como ab_pago en cada evento; /api/create-checkout la estampa
// en Stripe → pago por variante. Override QA: ?pantalla=A|B.
function resolvePago(url: URL, request: NextRequest): "A" | "B" {
  const override = url.searchParams.get("pantalla");
  if (override === "A" || override === "B") return override;
  const prev = request.cookies.get("ms_ab_pago")?.value;
  if (prev === "A" || prev === "B") return prev;
  return Math.random() < 0.5 ? "A" : "B";
}

function applyPago(res: NextResponse, request: NextRequest, variant: "A" | "B") {
  const prev = request.cookies.get("ms_ab_pago")?.value;
  if (variant !== prev) {
    res.cookies.set("ms_ab_pago", variant, { path: "/", maxAge: 60 * 60 * 24 * 90, sameSite: "lax" });
  }
  res.headers.set("x-ab-pago", variant);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
