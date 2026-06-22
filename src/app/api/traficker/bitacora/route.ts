import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getTraficker } from "@/lib/traficker-auth";
import { getAgent } from "@/lib/agent-auth";

const sb = createClient(
  process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!,
  process.env.BLOG_SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PLATAFORMAS = ["meta", "google", "tiktok", "linkedin", "x", "otra"] as const;
const ENTITY_TYPES = ["cuenta", "campaign", "adset", "ad", "creativo", "presupuesto", "otra"] as const;

async function authorize(req: NextRequest) {
  const t = await getTraficker(req);
  if (t) return { email: t.email, name: t.name };
  const agent = await getAgent(req);
  if (agent && (agent.role === "admin" || agent.agent_type === "traficker")) {
    return { email: agent.email ?? "admin", name: agent.name ?? "Admin" };
  }
  return null;
}

export async function GET(req: NextRequest) {
  const me = await authorize(req);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id");
  const plataforma = url.searchParams.get("plataforma");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const entityType = url.searchParams.get("entity_type");
  const entityRef = url.searchParams.get("entity_ref");
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10), 1), 500);

  let q = sb.from("traficker_bitacora").select("*").order("created_at", { ascending: false }).limit(limit);
  if (accountId) q = q.eq("ad_account_id", accountId);
  if (plataforma) q = q.eq("plataforma", plataforma);
  if (entityType) q = q.eq("entity_type", entityType);
  if (entityRef) q = q.eq("entity_ref", entityRef);
  if (from) q = q.gte("created_at", from);
  if (to) q = q.lte("created_at", to + "T23:59:59");

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const me = await authorize(req);
  if (!me) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_json" }, { status: 400 }); }

  const plataforma = String(body.plataforma ?? "").trim();
  const entityType = String(body.entity_type ?? "").trim();
  const changeType = String(body.change_type ?? "").trim();
  const motivo = String(body.motivo ?? "").trim();

  if (!PLATAFORMAS.includes(plataforma as typeof PLATAFORMAS[number])) return NextResponse.json({ error: "invalid_plataforma" }, { status: 400 });
  if (!ENTITY_TYPES.includes(entityType as typeof ENTITY_TYPES[number])) return NextResponse.json({ error: "invalid_entity_type" }, { status: 400 });
  if (!changeType) return NextResponse.json({ error: "change_type_required" }, { status: 400 });
  if (!motivo) return NextResponse.json({ error: "motivo_required" }, { status: 400 });

  const row = {
    traficker_email: me.email,
    traficker_name: me.name,
    plataforma,
    ad_account_id: body.ad_account_id || null,
    fb_account_id: body.fb_account_id ? String(body.fb_account_id).slice(0, 64) : null,
    entity_type: entityType,
    entity_ref: body.entity_ref ? String(body.entity_ref).slice(0, 200) : null,
    entity_name: body.entity_name ? String(body.entity_name).slice(0, 300) : null,
    change_type: changeType.slice(0, 100),
    before_value: body.before_value ? String(body.before_value).slice(0, 500) : null,
    after_value: body.after_value ? String(body.after_value).slice(0, 500) : null,
    motivo: motivo.slice(0, 2000),
  };

  const { data, error } = await sb.from("traficker_bitacora").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id });
}
