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
  if (url.pathname === "/por-que-diagnostico" && isPaidTraffic(url)) {
    const dest = url.clone();
    dest.pathname = "/por-que-diagnostico-social-proof";
    // Preserva el query string entero (UTMs, gclid, etc.)
    return NextResponse.redirect(dest, 307);
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/por-que-diagnostico",
};
