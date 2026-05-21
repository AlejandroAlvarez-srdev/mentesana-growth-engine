import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTraficker } from "@/lib/traficker-auth";
import { getAgent } from "@/lib/agent-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";

async function whoEmail(req: NextRequest): Promise<{ email: string; isTraficker: boolean } | null> {
  const t = await getTraficker(req);
  if (t) return { email: t.email, isTraficker: true };
  const a = await getAgent(req);
  if (a && (a.role === "admin" || a.agent_type === "traficker")) return { email: a.email ?? "", isTraficker: false };
  return null;
}

export async function GET(req: NextRequest) {
  const me = await whoEmail(req);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!me.isTraficker) return NextResponse.json({ notifications: [] });
  const { data } = await sb.from("panel_notifications").select("*").eq("recipient_type", "traficker").eq("recipient_ref", me.email).order("created_at", { ascending: false }).limit(30);
  return NextResponse.json({ notifications: data ?? [] });
}

export async function POST(req: NextRequest) {
  const me = await whoEmail(req);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.id) await sb.from("panel_notifications").update({ read_at: new Date().toISOString() }).eq("id", body.id).eq("recipient_ref", me.email);
  else await sb.from("panel_notifications").update({ read_at: new Date().toISOString() }).eq("recipient_type", "traficker").eq("recipient_ref", me.email).is("read_at", null);
  return NextResponse.json({ ok: true });
}
