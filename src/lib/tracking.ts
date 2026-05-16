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

type EventProps = Record<string, string | number | boolean>;

// Generate or retrieve persistent visitor ID and per-tab session ID
function getVisitorId(): string {
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

function getSessionId(): string {
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
    const payload = {
      event,
      props,
      session_id: getSessionId(),
      visitor_id: getVisitorId(),
      page_url: window.location.href,
      page_path: window.location.pathname,
      referrer: document.referrer || null,
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
    const utmSource = sessionStorage.getItem("utm_source") || undefined;
    const utmMedium = sessionStorage.getItem("utm_medium") || undefined;
    const utmCampaign = sessionStorage.getItem("utm_campaign") || undefined;
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

// Map our internal event names to standard Meta/TikTok event names
// where applicable. Custom events use the original name.
const META_STANDARD: Record<string, string> = {
  test_started: "InitiateCheckout",
  test_completed: "CompleteRegistration",
  match_viewed: "ViewContent",
  payment_started: "InitiateCheckout",
  payment_completed: "Purchase",
  contact_submitted: "Contact",
  newsletter_subscribed: "Subscribe",
  cta_click_buy: "AddToCart",
  // Diagnostic funnel
  view_landing_diagnostico: "ViewContent",
  click_cta_empezar: "AddToCart",
  start_matching: "InitiateCheckout",
  view_match_result: "ViewContent",
  select_slot: "Schedule",
  initiate_checkout: "InitiateCheckout",
  purchase: "Purchase",
  upsell_bono_purchased: "Purchase",
  // Campaña Eva (influencer → diagnóstico)
  view_landing_eva: "ViewContent",
  click_cta_eva: "AddToCart",
};

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
  start_matching: "InitiateCheckout",
  view_match_result: "ViewContent",
  select_slot: "ClickButton",
  initiate_checkout: "InitiateCheckout",
  purchase: "CompletePayment",
  upsell_bono_purchased: "CompletePayment",
  // Campaña Eva
  view_landing_eva: "ViewContent",
  click_cta_eva: "ClickButton",
};

interface FbqWindow extends Window {
  fbq?: (...args: unknown[]) => void;
  ttq?: { track: (event: string, props?: unknown) => void; page?: () => void };
  clarity?: (...args: unknown[]) => void;
}

export function track(event: string, props: EventProps = {}): void {
  if (typeof window === "undefined") return;
  const w = window as FbqWindow;

  // Shared event_id — pixel + CAPI send it so Meta dedupes the pair.
  const eventId = `${event}_${getVisitorId()}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  // 0. Internal — Supabase analytics_events table (analítica propia, interés legítimo)
  sendInternal(event, props);

  // 0b. Meta Conversion API (server-side) — marketing, requiere consentimiento
  if (hasConsent("marketing")) sendMetaCAPI(event, props, eventId);

  // 1. Vercel Analytics — accepts any custom event
  try { vercelTrack(event, props); } catch {}

  // 2. Meta Pixel — eventID param enables deduplication with CAPI
  try {
    if (w.fbq) {
      const standard = META_STANDARD[event];
      if (standard) {
        w.fbq("track", standard, props, { eventID: eventId });
      } else {
        w.fbq("trackCustom", event, props, { eventID: eventId });
      }
    }
  } catch {}

  // 3. TikTok Pixel
  try {
    if (w.ttq) {
      const standard = TIKTOK_STANDARD[event];
      w.ttq.track(standard || event, props);
    }
  } catch {}

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
