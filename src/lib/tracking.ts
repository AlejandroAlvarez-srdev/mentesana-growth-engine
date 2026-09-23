/**
 * Unified event tracking — fires to Meta Pixel, TikTok Pixel,
 * Microsoft Clarity, Vercel Analytics, and our internal Supabase
 * analytics_events table in one call.
 *
 * Usage:
 *   import { track } from "@/lib/tracking";
 *   track("test_question_viewed", { question: 3, category: "ansiedad" });
 */

import { track as vercelTrack } from "@vercel/analytics";
import { hasConsent } from "@/lib/cookie-consent";
import { consentBypassed } from "@/lib/consent-bypass";
import { getUtms } from "@/lib/utm";
import { META_STANDARD } from "@/lib/meta-events";

type EventProps = Record<string, string | number | boolean>;

// Generate or retrieve persistent visitor ID and per-tab session ID
// Se exportan porque el checkout los manda a Stripe: el webhook los devuelve al
// escribir la compra y asi la fila de `purchase` se puede unir con el resto del
// embudo. Sin esto la compra llega huerfana y no se puede medir test -> pago.
export function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem("ms_visitor_id");
    if (!id) {
      id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("ms_visitor_id", id);
    }
    return id;
  } catch { return ""; }
}

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = sessionStorage.getItem("ms_session_id");
    if (!id) {
      id = `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem("ms_session_id", id);
    }
    return id;
  } catch { return ""; }
}

// Internal: send to our Supabase via /api/track using sendBeacon for reliability
function sendInternal(event: string, props: EventProps): void {
  if (typeof window === "undefined") return;
  try {
    // Adjuntamos las UTMs PERSISTIDAS (sessionStorage/localStorage, capturadas al
    // aterrizar por UtmTracker). Antes el endpoint las sacaba del page_url, que pierde
    // el ?utm tras la navegación SPA/redirect → todos los eventos del embudo salían
    // como "directo". Ahora cada evento lleva la atribución de la sesión.
    const utms = getUtms();
    const payload = {
      event,
      props,
      session_id: getSessionId(),
      visitor_id: getVisitorId(),
      page_url: window.location.href,
      page_path: window.location.pathname,
      referrer: document.referrer || null,
      utm_source: utms.utm_source || null,
      utm_medium: utms.utm_medium || null,
      utm_campaign: utms.utm_campaign || null,
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/track", blob);
    } else {
      fetch("/api/track", { method: "POST", body: blob, keepalive: true }).catch(() => {});
    }
  } catch {}
}

// Meta Conversion API (server-side) — fires alongside the pixel for deduplication.
// Reads _fbc and _fbp cookies for cross-device matching.
// Accepts an `eventId` so pixel + CAPI share the same event_id — Meta dedupes by this.
function sendMetaCAPI(event: string, props: EventProps, eventId: string): void {
  if (typeof window === "undefined") return;
  try {
    const cookies = document.cookie.split(";").reduce((acc, c) => {
      const [k, v] = c.trim().split("=");
      if (k && v) acc[k] = v;
      return acc;
    }, {} as Record<string, string>);

    // Collect maximum user data for Meta matching quality
    // Las UTMs viven en el blob `ms_utm` (getUtms), NO en keys sueltas. Antes se leían
    // de sessionStorage.getItem("utm_source") (key inexistente) → CAPI sin atribución.
    const capiUtms = getUtms();
    const utmSource = capiUtms.utm_source || undefined;
    const utmMedium = capiUtms.utm_medium || undefined;
    const utmCampaign = capiUtms.utm_campaign || undefined;
    // Grab any user info stored from checkout/forms
    const storedEmail = localStorage.getItem("ms_user_email") || undefined;
    const storedPhone = localStorage.getItem("ms_user_phone") || undefined;
    const storedName = localStorage.getItem("ms_user_name") || undefined;
    const storedCity = localStorage.getItem("ms_user_city") || undefined;

    const payload = {
      event,
      event_id: eventId,
      props: {
        ...props,
        utm_source: utmSource,
        utm_medium: utmMedium,
        utm_campaign: utmCampaign,
      },
      page_url: window.location.href,
      page_path: window.location.pathname,
      referrer: document.referrer || undefined,
      visitor_id: getVisitorId(),
      session_id: getSessionId(),
      screen_width: window.screen?.width,
      screen_height: window.screen?.height,
      language: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      user_data: {
        fbc: cookies._fbc || undefined,
        fbp: cookies._fbp || undefined,
        email: storedEmail,
        phone: storedPhone,
        fn: storedName?.split(" ")[0],
        ln: storedName?.split(" ").slice(1).join(" ") || undefined,
        city: storedCity,
        country: "ES",
      },
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/meta-capi", blob);
    } else {
      fetch("/api/meta-capi", { method: "POST", body: blob, keepalive: true }).catch(() => {});
    }
  } catch {}
}

// TikTok Events API (server-side) — fires alongside the pixel for dedup via event_id.
function sendTiktokCAPI(event: string, props: EventProps, eventId: string): void {
  if (typeof window === "undefined") return;
  try {
    const cookies = document.cookie.split(";").reduce((acc, c) => {
      const [k, v] = c.trim().split("=");
      if (k && v) acc[k] = v;
      return acc;
    }, {} as Record<string, string>);
    const url = new URL(window.location.href);
    const ttclid = url.searchParams.get("ttclid") || cookies.ttclid || undefined;
    const storedEmail = localStorage.getItem("ms_user_email") || undefined;
    const storedPhone = localStorage.getItem("ms_user_phone") || undefined;
    const payload = {
      event,
      event_id: eventId,
      props,
      page_url: window.location.href,
      page_path: window.location.pathname,
      visitor_id: getVisitorId(),
      ttclid,
      user_data: {
        email: storedEmail,
        phone: storedPhone,
        ttp: cookies._ttp || undefined,
      },
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/tiktok-events", blob);
    else fetch("/api/tiktok-events", { method: "POST", body: blob, keepalive: true }).catch(() => {});
  } catch {}
}

// META_STANDARD vive en @/lib/meta-events (mapa compartido con el servidor /api/meta-capi
// para que la deduplicación de Meta funcione). TikTok mantiene su propio mapa abajo.
const TIKTOK_STANDARD: Record<string, string> = {
  test_started: "ClickButton",
  test_completed: "CompleteRegistration",
  match_viewed: "ViewContent",
  payment_started: "InitiateCheckout",
  payment_completed: "CompletePayment",
  contact_submitted: "Contact",
  newsletter_subscribed: "Subscribe",
  cta_click_buy: "AddToCart",
  // Diagnostic funnel
  view_landing_diagnostico: "ViewContent",
  click_cta_empezar: "ClickButton",
  start_matching: "ViewContent",
  view_email_gate: "SubmitForm",
  view_match_result: "ViewContent",
  select_slot: "ClickButton",
  initiate_checkout: "InitiateCheckout",
  purchase: "CompletePayment",
  upsell_bono_purchased: "CompletePayment",
  // Campaña Eva
  view_landing_eva: "ViewContent",
  click_cta_eva: "ClickButton",
  // Super embudo Llamada Inmediata (registro → app)
  view_landing_llamada_inmediata: "ViewContent",
  view_landing_llamada_gratis: "ViewContent",
  llamada_inmediata_registro: "CompleteRegistration",
};

interface FbqWindow extends Window {
  fbq?: (...args: unknown[]) => void;
  ttq?: { track: (event: string, props?: unknown, opts?: { event_id?: string }) => void; page?: () => void };
  clarity?: (...args: unknown[]) => void;
  dataLayer?: Record<string, unknown>[];
}

// Lee la variante del A/B test diag-vs-test de la cookie (la fija proxy.ts) para
// colgarla en todos los eventos → la conversión queda segmentada por variante.
function abDiagVariant(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(/(?:^|;\s*)ms_ab_diag=([AB])/);
  return m?.[1];
}

// Variante del 2º A/B test (capa de calentamiento del match) — la fija proxy.ts en
// la cookie ms_ab_warming. Se cuelga en cada evento para segmentar la conversión.
function abWarmingVariant(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(/(?:^|;\s*)ms_ab_warming=([AB])/);
  return m?.[1];
}

// Variante del 3er A/B test (challenger de la landing /por-que-diagnostico) — la fija
// proxy.ts en la cookie ms_ab_landing. Persiste landing→test→checkout, así la conversión
// a pago queda segmentada por variante (también se estampa en metadata de Stripe).
function abLandingVariant(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(/(?:^|;\s*)ms_ab_landing=([AB])/);
  return m?.[1];
}

// event_id determinista para un Lead identificado por email: el MISMO que calcula el
// servidor en /api/diagnostico-test (lead_<sha256(email en minúsculas)[:24]>) → Meta
// deduplica pixel + CAPI del navegador + CAPI del servidor en un solo Lead.
async function leadEventIdFromEmail(email: string): Promise<string> {
  const data = new TextEncoder().encode(email.trim().toLowerCase());
  const hash = await crypto.subtle.digest("SHA-256", data);
  const hex = Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `lead_${hex.slice(0, 24)}`;
}
// Datos personales y de SALUD que NUNCA van como parámetros del pixel/CAPI custom_data: Meta
// clasifica este dataset como salud y SUPRIME el evento entero ("restricted event") si lleva un
// parámetro como profile=ansiedad. Se quedan solo en la analítica interna (/api/track).
const PII_PROPS = ["email", "phone", "name", "telefono", "nombre"];
const HEALTH_PROPS = ["profile", "feeling", "perfil", "category", "dominant_category", "urgency", "urgency_level", "scores", "score", "symptom", "sintoma", "diagnostico", "psychologist"];
const stripPii = (p: EventProps): EventProps => Object.fromEntries(Object.entries(p).filter(([k]) => !PII_PROPS.includes(k) && !HEALTH_PROPS.includes(k)));

export function track(event: string, props: EventProps = {}, eventIdOverride?: string): void {
  if (typeof window === "undefined") return;
  // Lead con email y sin id explícito → id determinista (async por SubtleCrypto) y luego disparamos.
  const email = typeof props.email === "string" ? props.email : "";
  if (!eventIdOverride && META_STANDARD[event] === "Lead" && email && typeof crypto !== "undefined" && crypto.subtle) {
    leadEventIdFromEmail(email).then((id) => fire(event, props, id)).catch(() => fire(event, props, undefined));
    return;
  }
  fire(event, props, eventIdOverride);
}

function fire(event: string, props: EventProps, eventIdOverride?: string, opts: { internal?: boolean } = {}): void {
  const w = window as FbqWindow;
  const ab = abDiagVariant();
  if (ab) props = { ...props, ab_diag: ab };
  const abW = abWarmingVariant();
  if (abW) props = { ...props, ab_warming: abW };
  const abL = abLandingVariant();
  if (abL) props = { ...props, ab_landing: abL };

  // Shared event_id — pixel + CAPI send it so Meta dedupes the pair. Se puede
  // pasar un override para deduplicar con un CAPI disparado desde el servidor
  // (p.ej. la ruta de registro de Llamada Inmediata).
  const eventId = eventIdOverride || `${event}_${getVisitorId()}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // 0. Internal — Supabase analytics_events table (analítica propia, interés legítimo)
  if (opts.internal !== false) sendInternal(event, props);
  // A partir de aquí (pixeles, CAPI, dataLayer) los datos personales NO viajan como parámetros.
  props = stripPii(props);

  // Dominios de campaña con bypass del Consent Mode (consent-bypass.ts): CAPI/dataLayer
  // disparan sin esperar el banner. Scoped por hostname → el sitio principal no cambia.
  const bp = consentBypassed();

  // 0b. Meta Conversion API (server-side) — marketing, requiere consentimiento
  if (hasConsent("marketing") || bp) sendMetaCAPI(event, props, eventId);

  // 0c. TikTok Events API (server-side) — mismo eventId que el pixel para dedup
  if (hasConsent("marketing") || bp) sendTiktokCAPI(event, props, eventId);

  // 1. Vercel Analytics — accepts any custom event
  try { vercelTrack(event, props); } catch {}

  // 2. Meta Pixel — eventID param enables deduplication with CAPI
  const metaEvent = META_STANDARD[event] || event; // el MISMO nombre que recibe Meta
  try {
    if (w.fbq) {
      if (META_STANDARD[event]) {
        w.fbq("track", metaEvent, props, { eventID: eventId });
      } else {
        w.fbq("trackCustom", event, props, { eventID: eventId });
      }
    }
  } catch {}

  // 2b. Google Tag Manager — empujamos el MISMO evento al dataLayer para que los tags de
  // GTM (GA4, Google Ads, etc.) puedan dispararse. GTM se CARGA con consentimiento
  // 'analytics' (ver TrackingScripts), así que alimentamos el dataLayer bajo la MISMA
  // condición: antes iba gated por 'marketing' → GTM cargaba pero NO recibía eventos si el
  // usuario no aceptaba también marketing. Los tags de marketing dentro de GTM (Google
  // Ads/Pixel) deben respetar el consentimiento marketing por su lado (Consent Mode/trigger).
  if (hasConsent("analytics") || bp) {
    try {
      w.dataLayer = w.dataLayer || [];
      w.dataLayer.push({
        ...props,
        event: metaEvent,                                   // trigger de GTM = nombre Meta
        meta_event: metaEvent,
        ms_event: event,                                    // nombre interno (granularidad: varios → un mismo estándar)
        meta_event_type: META_STANDARD[event] ? "standard" : "custom",
        event_id: eventId,                                  // dedup con Pixel/CAPI
      });
    } catch {}
  }

  // 3. TikTok Pixel
  try {
    if (w.ttq) {
      const standard = TIKTOK_STANDARD[event];
      w.ttq.track(standard || event, props, { event_id: eventId });
    }
  } catch {}

  // Email dejado en el embudo del 9,99: además del Lead (que Meta suprime en este dataset de salud
  // mientras siga la restricción), emitimos Contact con id determinista → evento estándar que SÍ
  // pasa y sirve para optimizar campañas. Mismo id por email → Meta deduplica pixel + CAPI.
  // Verificado 21 sep 2026: Meta también suprime Contact en este dataset → además mandamos el
  // CUSTOM email_capturado (los custom sí pasan siempre) para tener el momento "dejó el email"
  // visible en Events Manager y poder crear una conversión personalizada sobre él.
  if (event === "start_matching_analysis" && eventId.startsWith("lead_")) {
    const hash = eventId.slice("lead_".length);
    try { fire("email_contacto", props, `contact_${hash}`, { internal: false }); } catch {}
    try { fire("email_capturado", props, `email_${hash}`, { internal: false }); } catch {}
  }

  // 4. Microsoft Clarity — set custom tags so you can filter sessions
  try {
    if (w.clarity) {
      w.clarity("event", event);
      // Also set tags for the most useful props
      Object.entries(props).slice(0, 3).forEach(([k, v]) => {
        w.clarity!("set", k, String(v));
      });
    }
  } catch {}
}

/** Convenience wrapper to track a page view (auto for most cases). */
export function trackPageView(page: string): void {
  track("page_view", { page });
}

/**
 * Store user PII so CAPI sends it with every subsequent event.
 * Call this whenever you capture user data (checkout, forms, confirmación).
 * Data is hashed server-side before sending to Meta — never sent in plain text.
 */
export function identifyUser(data: { email?: string; phone?: string; name?: string; city?: string }): void {
  if (typeof window === "undefined") return;
  try {
    if (data.email) localStorage.setItem("ms_user_email", data.email);
    if (data.phone) localStorage.setItem("ms_user_phone", data.phone);
    if (data.name) localStorage.setItem("ms_user_name", data.name);
    if (data.city) localStorage.setItem("ms_user_city", data.city);
  } catch {}
}
