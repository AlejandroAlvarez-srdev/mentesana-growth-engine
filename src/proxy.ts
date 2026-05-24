import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Señales de tráfico pagado (Google/Meta/TikTok/LinkedIn/Microsoft/Twitter/etc.)
const PAID_CLICK_IDS = ["gclid", "fbclid", "msclkid", "ttclid", "li_fat_id", "twclid", "yclid", "dclid"];

// Tráfico que DEBE ver la versión social-proof: cualquier UTM o click-id de ads.
// El tráfico sin UTMs (orgánico, directo, desde nuestras propias landings sin tags) ve la versión "sin social-proof".
function isPaidTraffic(url: URL): boolean {
  const p = url.searchParams;
  if (p.get("utm_source") || p.get("utm_medium") || p.get("utm_campaign") || p.get("utm_content") || p.get("utm_term")) return true;
  for (const k of PAID_CLICK_IDS) if (p.get(k)) return true;
  return false;
}

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

  if (url.pathname === "/por-que-diagnostico" && isPaidTraffic(url)) {
    const dest = url.clone();
    dest.pathname = "/por-que-diagnostico-social-proof";
    return NextResponse.redirect(dest, 307);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)"],
};
