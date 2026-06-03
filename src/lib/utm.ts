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
  // First-touch (sobrevive entre sesiones, se setea la primera vez que el usuario aterriza)
  first_utm_source?: string;
  first_utm_medium?: string;
  first_utm_campaign?: string;
  first_utm_content?: string;
  first_touch_at?: string;
  // Extras del contexto del pago (p.ej. slot seleccionado en diagnostico)
  scheduled_date?: string;
  scheduled_time?: string;
  captured_at?: string;
}

const KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const STORAGE_KEY = "ms_utm"; // sessionStorage — last-touch (sesión actual)
const FIRST_TOUCH_KEY = "ms_utm_first"; // localStorage — first-touch, persiste entre sesiones

export function captureUtms(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const hasAny = KEYS.some((k) => url.searchParams.has(k));

  // No sobrescribir si ya capturamos esta sesión (last-touch)
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
    // Orgánico / directo primera visita — usamos el referrer como best-effort
    data.utm_source = data.referrer && data.referrer !== "direct" ? new URL(data.referrer).hostname : "direct";
    data.utm_medium = "organic";
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // First-touch: solo guarda la PRIMERA vez que el usuario aterriza.
    // No sobrescribir nunca para preservar atribución original de la pauta.
    if (!localStorage.getItem(FIRST_TOUCH_KEY)) {
      localStorage.setItem(FIRST_TOUCH_KEY, JSON.stringify({ ...data, captured_at: new Date().toISOString() }));
      // Compat: algunas landings/checkouts antiguos leen claves separadas
      // ms_first_utm_source, ms_first_utm_medium, ... Las escribimos en
      // paralelo para no romper a esos consumidores.
      KEYS.forEach((k) => {
        const v = data[k];
        if (v) try { localStorage.setItem(`ms_first_${k}`, v); } catch {}
      });
    }
  } catch {}
}

/**
 * Devuelve UTMs merge-ados: first-touch como base + last-touch como override.
 * Esto permite que:
 *   - Si el usuario vino de Meta ads y vuelve días después desde Google, se lleva ambos.
 *   - El checkout recibe la atribución de la pauta original (first) Y la última visita (last).
 * En Stripe metadata, las keys sin prefijo son last-touch; las "first_*" son first-touch.
 */
export function getUtms(): UtmParams {
  if (typeof window === "undefined") return {};
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const rawFirst = localStorage.getItem(FIRST_TOUCH_KEY);
    const last = raw ? JSON.parse(raw) : {};
    const first = rawFirst ? JSON.parse(rawFirst) : null;
    if (!first) return last;
    // Expone first-touch como fields "first_*" para que el webhook pueda guardarlos
    return {
      ...last,
      ...(first.utm_source ? { first_utm_source: first.utm_source } : {}),
      ...(first.utm_medium ? { first_utm_medium: first.utm_medium } : {}),
      ...(first.utm_campaign ? { first_utm_campaign: first.utm_campaign } : {}),
      ...(first.utm_content ? { first_utm_content: first.utm_content } : {}),
      ...(first.captured_at ? { first_touch_at: first.captured_at } : {}),
    } as UtmParams;
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
