import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

interface TrackEvent {
  event: string;
  props?: Record<string, unknown>;
  session_id?: string;
  visitor_id?: string;
  page_url?: string;
  page_path?: string;
  referrer?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    // Accept either single event or batch
    const events: TrackEvent[] = Array.isArray(body) ? body : [body];

    if (events.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const userAgent = req.headers.get("user-agent") || "";
    const ipCountry = req.headers.get("x-vercel-ip-country") || null;

    const rows = events.map((e) => {
      const url = e.page_url || "";
      // Parse UTM params
      let utm_source: string | null = null, utm_medium: string | null = null, utm_campaign: string | null = null;
      try {
        const u = new URL(url);
        utm_source = u.searchParams.get("utm_source");
        utm_medium = u.searchParams.get("utm_medium");
        utm_campaign = u.searchParams.get("utm_campaign");
      } catch {}

      return {
        event_name: e.event,
        props: e.props || {},
        session_id: e.session_id || null,
        visitor_id: e.visitor_id || null,
        page_url: e.page_url || null,
        page_path: e.page_path || null,
        referrer: e.referrer || null,
        user_agent: userAgent.slice(0, 500),
        ip_country: ipCountry,
        utm_source,
        utm_medium,
        utm_campaign,
      };
    });

    const { error } = await supabase.from("analytics_events").insert(rows);
    if (error) {
      console.error("Track insert error:", error.message);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, inserted: rows.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
