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
};

interface FbqWindow extends Window {
  fbq?: (...args: unknown[]) => void;
  ttq?: { track: (event: string, props?: unknown) => void; page?: () => void };
  clarity?: (...args: unknown[]) => void;
}

export function track(event: string, props: EventProps = {}): void {
  if (typeof window === "undefined") return;
  const w = window as FbqWindow;

  // 0. Internal — Supabase analytics_events table
  sendInternal(event, props);

  // 1. Vercel Analytics — accepts any custom event
  try { vercelTrack(event, props); } catch {}

  // 2. Meta Pixel
  try {
    if (w.fbq) {
      const standard = META_STANDARD[event];
      if (standard) {
        w.fbq("track", standard, props);
      } else {
        w.fbq("trackCustom", event, props);
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
