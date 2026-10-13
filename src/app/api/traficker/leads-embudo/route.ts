// Leads captados por día y por embudo para el panel del traficker.
//   Diagnóstico 9,99€ → envíos del test (diagnostico_tests) con email real.
//   Cita gratis       → tokens de cita de bienvenida (diagnostico_gratis_tokens).
// Son LEADS (entran al embudo), no ventas. La serie se devuelve día a día en
// hora de Madrid, rellenando los días sin leads con 0 para el gráfico.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const madridDayStr = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(d);
const addDayStr = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day + 1, 12)));
};

export async function GET(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const days = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("days") || "30", 10) || 30, 7), 90);
  const since = madridDayStr(new Date(Date.now() - (days - 1) * 86400000));
  const today = madridDayStr(new Date());

  const { data, error } = await sb.rpc("traf_leads_by_day", { p_since: since });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byDay = new Map<string, { diag: number; cita: number }>();
  for (const r of (data ?? []) as { embudo: string; dia: string; leads: number }[]) {
    const row = byDay.get(r.dia) ?? { diag: 0, cita: 0 };
    if (r.embudo === "diagnostico_9_99") row.diag += Number(r.leads) || 0;
    else if (r.embudo === "cita_gratis") row.cita += Number(r.leads) || 0;
    byDay.set(r.dia, row);
  }

  const daily: Array<{ date: string; diag: number; cita: number }> = [];
  for (let d = since, guard = 0; d <= today && guard < 400; d = addDayStr(d), guard++) {
    const r = byDay.get(d) ?? { diag: 0, cita: 0 };
    daily.push({ date: d, diag: r.diag, cita: r.cita });
  }
  const totals = daily.reduce((a, r) => ({ diag: a.diag + r.diag, cita: a.cita + r.cita }), { diag: 0, cita: 0 });

  return NextResponse.json(
    { days, since, today, totals, daily },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
