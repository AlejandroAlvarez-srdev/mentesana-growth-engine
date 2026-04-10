import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PIXEL_ID = "REDACTED_ID";
const ACCESS_TOKEN = process.env.META_CAPI_TOKEN || "";
const API_VERSION = "v21.0";

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

// Map internal event names to Meta standard events (same as client-side)
const META_STANDARD: Record<string, string> = {
  test_started: "InitiateCheckout",
  test_completed: "CompleteRegistration",
  match_viewed: "ViewContent",
  payment_started: "InitiateCheckout",
  payment_completed: "Purchase",
  contact_submitted: "Contact",
  newsletter_subscribed: "Subscribe",
  cta_click_buy: "AddToCart",
  page_view: "PageView",
};

// POST { event, props, page_url, user_data }
// Sends server-side event to Meta Conversion API for deduplication + better attribution.
export async function POST(req: NextRequest) {
  if (!ACCESS_TOKEN) return NextResponse.json({ ok: false, error: "no token" }, { status: 500 });

  try {
    const body = await req.json();
    const { event, props = {}, page_url, page_path, referrer, visitor_id, session_id, screen_width, screen_height, language, timezone, user_data = {} } = body as {
      event: string;
      props?: Record<string, unknown>;
      page_url?: string;
      page_path?: string;
      referrer?: string;
      visitor_id?: string;
      session_id?: string;
      screen_width?: number;
      screen_height?: number;
      language?: string;
      timezone?: string;
      user_data?: { email?: string; phone?: string; fn?: string; ln?: string; city?: string; country?: string; fbc?: string; fbp?: string };
    };

    const eventName = META_STANDARD[event] || event;
    const eventId = `${event}_${visitor_id || ""}_${Date.now()}`;
    const timestamp = Math.floor(Date.now() / 1000);

    // Build user_data with hashed PII
    const userData: Record<string, unknown> = {};
    if (user_data.email) userData.em = [sha256(user_data.email)];
    if (user_data.phone) userData.ph = [sha256(user_data.phone)];
    if (user_data.fn) userData.fn = [sha256(user_data.fn)];
    if (user_data.ln) userData.ln = [sha256(user_data.ln)];
    if (user_data.city) userData.ct = [sha256(user_data.city)];
    if (user_data.country) userData.country = [sha256(user_data.country)];
    // Client-side identifiers for deduplication
    if (user_data.fbc) userData.fbc = user_data.fbc;
    if (user_data.fbp) userData.fbp = user_data.fbp;
    // External ID for cross-device matching
    if (visitor_id) userData.external_id = [sha256(visitor_id)];
    // IP + user agent from request headers
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
    const ua = req.headers.get("user-agent") || "";
    if (ip) userData.client_ip_address = ip;
    if (ua) userData.client_user_agent = ua;

    // Build custom_data with maximum info for attribution
    const customData: Record<string, unknown> = { ...props };
    if (eventName === "Purchase" && props.value) {
      customData.value = props.value;
      customData.currency = props.currency || "EUR";
      customData.content_type = "product";
      customData.content_name = "Primera sesión psicología";
    }
    if (eventName === "ViewContent") {
      customData.content_type = "product";
      customData.content_name = props.psychologist || "Psicóloga match";
    }
    if (eventName === "InitiateCheckout") {
      customData.value = props.value || 9.99;
      customData.currency = "EUR";
      customData.num_items = 1;
    }

    const payload = {
      data: [
        {
          event_name: eventName,
          event_time: timestamp,
          event_id: eventId,
          event_source_url: page_url || `https://mentesanapsicologia.com${page_path || ""}`,
          action_source: "website",
          user_data: userData,
          custom_data: Object.keys(customData).length > 0 ? customData : undefined,
        },
      ],
    };

    const url = `https://graph.facebook.com/${API_VERSION}/${PIXEL_ID}/events?access_token=${ACCESS_TOKEN}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const result = await res.json();
    if (!res.ok) {
      console.error("[meta-capi] error:", JSON.stringify(result).slice(0, 500));
      return NextResponse.json({ ok: false, error: result.error?.message || res.status }, { status: 500 });
    }

    return NextResponse.json({ ok: true, events_received: result.events_received });
  } catch (e) {
    console.error("[meta-capi]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
