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

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
