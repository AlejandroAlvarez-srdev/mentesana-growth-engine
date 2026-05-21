import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTraficker } from "@/lib/traficker-auth";
import { listTasksFor, notifyTaskCompleted } from "@/lib/panel-tasks";

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
  const completionMessage = typeof body.completion_message === "string" ? body.completion_message.trim().slice(0, 1000) : "";
  if (body.status === "done") {
    patch.status = "done";
    patch.completed_at = new Date().toISOString();
    if (completionMessage) patch.completion_message = completionMessage;
  }
  const { data } = await sb.from("panel_tasks").update(patch).eq("id", body.id).select("*").single();
  if (body.status === "done") {
    try { await notifyTaskCompleted(body.id, completionMessage || "Tarea completada"); } catch {}
  }
  return NextResponse.json({ task: data });
}
