import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTraficker } from "@/lib/traficker-auth";
import { getAgent } from "@/lib/agent-auth";
import { createPanelTask, type AssigneeType } from "@/lib/panel-tasks";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CTO_EMAIL = "cto@example.com";

async function whoami(req: NextRequest): Promise<{ email: string; name: string } | null> {
  const t = await getTraficker(req);
  if (t) return { email: t.email, name: t.name };
  const a = await getAgent(req);
  if (a && (a.role === "admin" || a.agent_type === "traficker")) return { email: a.email ?? "admin", name: a.name ?? "Admin" };
  return null;
}

// GET — lista destinatarios disponibles
export async function GET(req: NextRequest) {
  if (!(await whoami(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: videomakers } = await sb.from("video_makers").select("email,name").eq("active", true).order("name");
  return NextResponse.json({
    targets: [
      { id: "cto", label: "CTO · Alejandro Álvarez", email: CTO_EMAIL, assignee_type: "agent" as AssigneeType },
      ...(videomakers ?? []).map((v) => ({ id: `vm:${v.email}`, label: `Video Maker · ${v.name ?? v.email}`, email: v.email, assignee_type: "videomaker" as AssigneeType })),
    ],
  });
}

// POST — crear tarea
export async function POST(req: NextRequest) {
  const me = await whoami(req);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const target = String(body.target ?? "").trim();
  const title = String(body.title ?? "").trim();
  if (!title) return NextResponse.json({ error: "title_required" }, { status: 400 });

  let assignee_type: AssigneeType = "agent";
  let assignee_ref = "";

  if (target === "cto") {
    assignee_type = "agent";
    assignee_ref = CTO_EMAIL;
  } else if (target.startsWith("vm:")) {
    const email = target.slice(3).trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "invalid_videomaker_email" }, { status: 400 });
    const { data: vm } = await sb.from("video_makers").select("email").eq("active", true).eq("email", email).maybeSingle();
    if (!vm) return NextResponse.json({ error: "videomaker_not_found_or_inactive" }, { status: 400 });
    assignee_type = "videomaker";
    assignee_ref = email;
  } else {
    return NextResponse.json({ error: "invalid_target" }, { status: 400 });
  }

  const priority = ["low", "normal", "high", "urgent"].includes(String(body.priority)) ? (body.priority as "low" | "normal" | "high" | "urgent") : "normal";
  const dueRaw = typeof body.due_at === "string" && body.due_at ? body.due_at : null;
  let due_at: string | null = null;
  if (dueRaw) {
    const d = new Date(dueRaw);
    if (!isNaN(d.getTime())) due_at = d.toISOString();
  }

  try {
    const task = await createPanelTask({
      title: title.slice(0, 200),
      description: body.description ? String(body.description).slice(0, 2000) : undefined,
      assignee_type,
      assignee_ref,
      assigned_by_email: me.email,
      due_at,
      priority,
      related_panel: "traficker",
      related_id: body.related_id ? String(body.related_id).slice(0, 100) : undefined,
      notify: true,
    });
    return NextResponse.json({ ok: true, id: task.id });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "create_failed" }, { status: 500 });
  }
}
