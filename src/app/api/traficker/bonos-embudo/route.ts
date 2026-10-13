// Facturación de bonos por mes y embudo de origen, para el panel del traficker.
//   Bono = pago completado de terapia (€90–€1200), independiente del campo 'producto'.
//   Embudo = origen del cliente (tabla customer_origin, backfilleada por primer toque):
//            diagnóstico 9,99 · cita gratis · desconocido (sin rastro de ningún embudo).
// Es best-effort: el ~40% "desconocido" son clientes sin señal de captación (venta
// directa, antiguos, etc.). La atribución exacta mejora según se llena customer_origin.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Bucket = { diag: number; cita: number; desc: number; rev_diag: number; rev_cita: number; rev_desc: number };
const emptyBucket = (): Bucket => ({ diag: 0, cita: 0, desc: 0, rev_diag: 0, rev_cita: 0, rev_desc: 0 });

export async function GET(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const months = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("months") || "6", 10) || 6, 1), 18);
  const now = new Date();
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)).toISOString().slice(0, 10);

  const { data, error } = await sb.rpc("traf_bonos_by_embudo", { p_since: since });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byMonth = new Map<string, Bucket>();
  for (const r of (data ?? []) as { mes: string; embudo: string; bonos: number; revenue: number }[]) {
    const m = byMonth.get(r.mes) ?? emptyBucket();
    const n = Number(r.bonos) || 0, rev = Number(r.revenue) || 0;
    if (r.embudo === "diagnostico_9_99") { m.diag += n; m.rev_diag += rev; }
    else if (r.embudo === "cita_gratis") { m.cita += n; m.rev_cita += rev; }
    else { m.desc += n; m.rev_desc += rev; }
    byMonth.set(r.mes, m);
  }

  const monthKeys: string[] = [];
  for (let i = months - 1; i >= 0; i--) monthKeys.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));

  const monthly = monthKeys.map((mes) => {
    const m = byMonth.get(mes) ?? emptyBucket();
    return {
      mes, ...m,
      total_bonos: m.diag + m.cita + m.desc,
      total_rev: Math.round((m.rev_diag + m.rev_cita + m.rev_desc) * 100) / 100,
    };
  });

  const totals = monthly.reduce((a, r) => ({
    diag: a.diag + r.diag, cita: a.cita + r.cita, desc: a.desc + r.desc,
    rev_diag: a.rev_diag + r.rev_diag, rev_cita: a.rev_cita + r.rev_cita, rev_desc: a.rev_desc + r.rev_desc,
  }), emptyBucket());
  const rev_total = Math.round((totals.rev_diag + totals.rev_cita + totals.rev_desc) * 100) / 100;

  return NextResponse.json(
    { months, since, monthly, totals: { ...totals, rev_total }, pct_diag: rev_total > 0 ? Math.round((totals.rev_diag / rev_total) * 1000) / 10 : null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
