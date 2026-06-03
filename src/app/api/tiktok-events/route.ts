import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PIXEL_CODE = "D8G65R3C77UEC9ORTSO0";
const ACCESS_TOKEN = process.env.TIKTOK_EVENTS_TOKEN || "";
const API_URL = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

function sha256(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

const TIKTOK_STANDARD: Record<string, string> = {
  test_started: "ClickButton",
  test_completed: "CompleteRegistration",
  match_viewed: "ViewContent",
  payment_started: "InitiateCheckout",
  payment_completed: "CompletePayment",
  contact_submitted: "Contact",
  newsletter_subscribed: "Subscribe",
  cta_click_buy: "AddToCart",
  view_landing_diagnostico: "ViewContent",
  click_cta_empezar: "ClickButton",
  start_matching: "InitiateCheckout",
  view_match_result: "ViewContent",
  select_slot: "ClickButton",
  initiate_checkout: "InitiateCheckout",
  purchase: "CompletePayment",
  upsell_bono_purchased: "CompletePayment",
  view_landing_eva: "ViewContent",
  click_cta_eva: "ClickButton",
  page_view: "Pageview",
};

export async function POST(req: NextRequest) {
  if (!ACCESS_TOKEN) return new NextResponse(null, { status: 204 });

  try {
    const body = await req.json();
    const {
      event,
      event_id,
      props = {},
      page_url,
      page_path,
      visitor_id,
      user_data = {},
      ttclid,
    } = body as {
      event: string;
      event_id?: string;
      props?: Record<string, unknown>;
      page_url?: string;
      page_path?: string;
      visitor_id?: string;
      user_data?: { email?: string; phone?: string; ttp?: string };
      ttclid?: string;
    };

    const eventName = TIKTOK_STANDARD[event] || event;
    const eventId = event_id || `${event}_${visitor_id || ""}_${Date.now()}`;
    const timestamp = Math.floor(Date.now() / 1000);

    const user: Record<string, unknown> = {};
    if (user_data.email) user.email = sha256(user_data.email);
    if (user_data.phone) user.phone = sha256(user_data.phone);
    if (visitor_id) user.external_id = sha256(visitor_id);
    if (ttclid) user.ttclid = ttclid;
    if (user_data.ttp) user.ttp = user_data.ttp;
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "";
    const ua = req.headers.get("user-agent") || "";
    if (ip) user.ip = ip;
    if (ua) user.user_agent = ua;

    const properties: Record<string, unknown> = { ...props };
    if (eventName === "CompletePayment" && props.value) {
      properties.value = props.value;
      properties.currency = props.currency || "EUR";
      properties.content_type = "product";
      properties.content_name = "Primera sesión psicología";
    }
    if (eventName === "InitiateCheckout") {
      properties.value = props.value || 9.99;
      properties.currency = "EUR";
    }

    const payload = {
      event_source: "web",
      event_source_id: PIXEL_CODE,
      data: [
        {
          event: eventName,
          event_time: timestamp,
          event_id: eventId,
          user,
          properties,
          page: {
            url: page_url || `https://mentesanapsicologia.com${page_path || ""}`,
            referrer: req.headers.get("referer") || "",
          },
        },
      ],
    };

    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Access-Token": ACCESS_TOKEN },
      body: JSON.stringify(payload),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok || result.code !== 0) {
      console.error("[tiktok-events] error:", JSON.stringify(result).slice(0, 500));
      return NextResponse.json({ ok: false, error: result.message || res.status }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[tiktok-events]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
