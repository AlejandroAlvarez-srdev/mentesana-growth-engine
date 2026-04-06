/**
 * Unified event tracking — fires to Meta Pixel, TikTok Pixel,
 * Microsoft Clarity, and Vercel Analytics in one call.
 *
 * Usage:
 *   import { track } from "@/lib/tracking";
 *   track("test_question_viewed", { question: 3, category: "ansiedad" });
 */

import { track as vercelTrack } from "@vercel/analytics";

type EventProps = Record<string, string | number | boolean>;

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
