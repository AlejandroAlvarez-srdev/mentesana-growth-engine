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
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
