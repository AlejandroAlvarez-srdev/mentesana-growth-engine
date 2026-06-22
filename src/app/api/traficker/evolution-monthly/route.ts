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

async function authorize(req: NextRequest) {
  if (await getTraficker(req)) return true;
  const agent = await getAgent(req);
  return !!(agent && (agent.role === "admin" || agent.agent_type === "traficker"));
}

interface InsightRow {
  date_start: string;
  impressions: number | null;
  reach: number | null;
  clicks: number | null;
  spend: number | null;
  ctr: number | null;
  results: number | null;
  roas: number | null;
  hook_rate: number | null;
  video_avg_watch_sec: number | null;
  video_3s_views: number | null;
}

export async function GET(req: NextRequest) {
  if (!(await authorize(req))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const accountId = url.searchParams.get("account_id");
  if (!accountId) return NextResponse.json({ error: "account_id required" }, { status: 400 });
  const months = Math.min(Math.max(parseInt(url.searchParams.get("months") || "6", 10), 1), 24);

  // Calcular fecha inicio (primer día del mes hace `months-1`)
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const startIso = start.toISOString().slice(0, 10);

  const { data, error } = await sb
    .from("meta_ad_insights")
    .select("date_start,impressions,reach,clicks,spend,ctr,results,roas,hook_rate,video_avg_watch_sec,video_3s_views")
    .eq("ad_account_id", accountId)
    .gte("date_start", startIso)
    .order("date_start", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Agregar por mes (YYYY-MM)
  type Agg = { spend: number; impressions: number; reach: number; clicks: number; results: number; hookWeighted: number; hookImps: number; ctrWeighted: number; ctrSpend: number; roasWeighted: number; roasSpend: number; watchWeighted: number; watchViews: number };
  const buckets = new Map<string, Agg>();

  for (const r of (data ?? []) as InsightRow[]) {
    const month = r.date_start?.slice(0, 7);
    if (!month) continue;
    const cur = buckets.get(month) ?? { spend: 0, impressions: 0, reach: 0, clicks: 0, results: 0, hookWeighted: 0, hookImps: 0, ctrWeighted: 0, ctrSpend: 0, roasWeighted: 0, roasSpend: 0, watchWeighted: 0, watchViews: 0 };
    const imps = Number(r.impressions ?? 0);
    const sp = Number(r.spend ?? 0);
    cur.spend += sp;
    cur.impressions += imps;
    cur.reach += Number(r.reach ?? 0);
    cur.clicks += Number(r.clicks ?? 0);
    cur.results += Number(r.results ?? 0);
    if (r.hook_rate != null && imps > 0) { cur.hookWeighted += Number(r.hook_rate) * imps; cur.hookImps += imps; }
    if (r.ctr != null && sp > 0) { cur.ctrWeighted += Number(r.ctr) * sp; cur.ctrSpend += sp; }
    if (r.roas != null && sp > 0) { cur.roasWeighted += Number(r.roas) * sp; cur.roasSpend += sp; }
    const views = Number(r.video_3s_views ?? 0);
    if (r.video_avg_watch_sec != null && views > 0) { cur.watchWeighted += Number(r.video_avg_watch_sec) * views; cur.watchViews += views; }
    buckets.set(month, cur);
  }

  // Genera mes a mes (incluso vacíos) para evitar huecos en el gráfico
  const out: Array<{ month: string; spend: number; impressions: number; reach: number; clicks: number; results: number; ctr: number; cost_per_result: number | null; roas: number | null; hook_rate: number | null; video_avg_watch_sec: number | null }> = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    const a = buckets.get(key);
    out.push({
      month: key,
      spend: a ? +a.spend.toFixed(2) : 0,
      impressions: a ? a.impressions : 0,
      reach: a ? a.reach : 0,
      clicks: a ? a.clicks : 0,
      results: a ? a.results : 0,
      ctr: a && a.ctrSpend > 0 ? +(a.ctrWeighted / a.ctrSpend).toFixed(2) : 0,
      cost_per_result: a && a.results > 0 ? +(a.spend / a.results).toFixed(2) : null,
      roas: a && a.roasSpend > 0 ? +(a.roasWeighted / a.roasSpend).toFixed(2) : null,
      hook_rate: a && a.hookImps > 0 ? +(a.hookWeighted / a.hookImps).toFixed(2) : null,
      video_avg_watch_sec: a && a.watchViews > 0 ? +(a.watchWeighted / a.watchViews).toFixed(2) : null,
    });
  }

  return NextResponse.json({ months: out });
}
