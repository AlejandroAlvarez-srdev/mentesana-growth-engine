import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTraficker } from "@/lib/traficker-auth";
import { getAgent } from "@/lib/agent-auth";
import { listTasksFor, notifyTaskCompleted } from "@/lib/panel-tasks";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";

// Resuelve email del usuario actual: traficker o admin agent.
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
  if (!me.isTraficker) return NextResponse.json({ tasks: [] }); // admin viendo el panel: tareas suyas viven en /agent/my-tasks
  const tasks = await listTasksFor("traficker", me.email);
  return NextResponse.json({ tasks });
}

export async function PATCH(req: NextRequest) {
  const me = await whoEmail(req);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const { data: t } = await sb.from("panel_tasks").select("assignee_ref, assignee_type").eq("id", body.id).maybeSingle();
  if (!t) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // Si es traficker, solo puede tocar las suyas. Si es admin, cualquiera.
  if (me.isTraficker && (t.assignee_type !== "traficker" || t.assignee_ref !== me.email)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
