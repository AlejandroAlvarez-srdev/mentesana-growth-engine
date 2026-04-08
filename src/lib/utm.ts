// UTM capture and retrieval utility.
// Captures on first landing, persists in sessionStorage, and is consumed
// by checkout flows to track attribution in Stripe metadata.

export interface UtmParams {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  referrer?: string;
  landing_page?: string;
}

const KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const STORAGE_KEY = "ms_utm";

export function captureUtms(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const hasAny = KEYS.some((k) => url.searchParams.has(k));

  // Don't overwrite an existing capture unless the URL has new UTMs
  if (!hasAny && sessionStorage.getItem(STORAGE_KEY)) return;

  const data: UtmParams = {
    landing_page: url.pathname + url.search,
    referrer: document.referrer || "direct",
  };
  if (hasAny) {
    KEYS.forEach((k) => {
      const v = url.searchParams.get(k);
      if (v) data[k] = v.slice(0, 120);
    });
  } else if (!sessionStorage.getItem(STORAGE_KEY)) {
    // Organic / direct first touch
    data.utm_source = data.referrer && data.referrer !== "direct" ? new URL(data.referrer).hostname : "direct";
    data.utm_medium = "organic";
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {}
}

export function getUtms(): UtmParams {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Append UTMs to a Stripe Payment Link so they end up on the Checkout Session.
// Stripe exposes `client_reference_id` on Payment Links which we use to encode
// the UTM bundle. Falls back to the original URL if nothing stored.
export function appendUtmsToStripeLink(url: string): string {
  const utms = getUtms();
  if (!utms || Object.keys(utms).length === 0) return url;
  try {
    const ref = btoa(
      unescape(encodeURIComponent(JSON.stringify(utms)))
    ).replace(/=+$/, "");
    const u = new URL(url);
    u.searchParams.set("client_reference_id", ref.slice(0, 200));
    if (utms.utm_source) u.searchParams.set("utm_source", utms.utm_source);
    if (utms.utm_medium) u.searchParams.set("utm_medium", utms.utm_medium);
    if (utms.utm_campaign) u.searchParams.set("utm_campaign", utms.utm_campaign);
    if (utms.utm_content) u.searchParams.set("utm_content", utms.utm_content);
    return u.toString();
  } catch {
    return url;
  }
}
