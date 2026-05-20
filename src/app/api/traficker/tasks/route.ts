import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTraficker } from "@/lib/traficker-auth";
import { listTasksFor } from "@/lib/panel-tasks";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireTraficker(req);
  if ("status" in auth) return auth;
  const tasks = await listTasksFor("traficker", auth.traficker.email);
  return NextResponse.json({ tasks });
}

export async function PATCH(req: NextRequest) {
  const auth = await requireTraficker(req);
  if ("status" in auth) return auth;
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const { data: t } = await sb.from("panel_tasks").select("assignee_ref, assignee_type").eq("id", body.id).maybeSingle();
  if (!t || t.assignee_type !== "traficker" || t.assignee_ref !== auth.traficker.email) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const patch: any = { updated_at: new Date().toISOString() };
  if (body.status === "done") { patch.status = "done"; patch.completed_at = new Date().toISOString(); }
  const { data } = await sb.from("panel_tasks").update(patch).eq("id", body.id).select("*").single();
  return NextResponse.json({ task: data });
}
