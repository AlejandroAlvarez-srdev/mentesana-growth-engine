// Facturación de bonos por periodo y embudo de origen, para el panel del traficker.
//   Bono = pago completado de terapia (€90–€1200), independiente del campo 'producto'.
//   Embudo = origen del cliente derivado en vivo (RPC): diagnóstico 9,99 · cita gratis · desconocido.
// Periodo: ?from=YYYY-MM-DD&to=YYYY-MM-DD (días de Madrid, calendarios del panel) o, si no vienen,
// ?months=N (N meses naturales hasta hoy). Granularidad automática: por día si el rango es de
// ≤62 días, por mes si es mayor (se puede forzar con ?gran=day|month).
// Es best-effort: el ~40% "desconocido" son clientes sin señal de captación (venta directa, antiguos…).
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Bucket = { diag: number; cita: number; desc: number; rev_diag: number; rev_cita: number; rev_desc: number };
const emptyBucket = (): Bucket => ({ diag: 0, cita: 0, desc: 0, rev_diag: 0, rev_cita: 0, rev_desc: 0 });
const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const madridToday = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const validDay = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) ? s : null);

export async function GET(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const sp = req.nextUrl.searchParams;
  const today = madridToday();
  let from = validDay(sp.get("from"));
  let to = validDay(sp.get("to"));
  let months: number | null = null;
  if (!from || !to) {
    months = Math.min(Math.max(parseInt(sp.get("months") || "6", 10) || 6, 1), 24);
    const [y, m] = today.split("-").map(Number);
    from = isoDay(new Date(Date.UTC(y, m - 1 - (months - 1), 1)));
    to = today;
  }
  if (from > to) [from, to] = [to, from];
  const spanDays = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / DAY) + 1;
  if (spanDays > 400) from = isoDay(new Date(Date.parse(to + "T00:00:00Z") - 399 * DAY));
  const granParam = sp.get("gran");
  const gran: "day" | "month" = granParam === "day" || granParam === "month" ? granParam : spanDays <= 62 ? "day" : "month";

  const { data, error } = await sb.rpc("traf_bonos_by_embudo_rango", { p_since: from, p_until: to, p_gran: gran });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byPeriod = new Map<string, Bucket>();
  for (const r of (data ?? []) as { periodo: string; embudo: string; bonos: number; revenue: number }[]) {
    const m = byPeriod.get(r.periodo) ?? emptyBucket();
    const n = Number(r.bonos) || 0, rev = Number(r.revenue) || 0;
    if (r.embudo === "diagnostico_9_99") { m.diag += n; m.rev_diag += rev; }
    else if (r.embudo === "cita_gratis") { m.cita += n; m.rev_cita += rev; }
    else { m.desc += n; m.rev_desc += rev; }
    byPeriod.set(r.periodo, m);
  }

  // Claves de periodo completas (incluye días/meses sin ventas para que el gráfico no tenga huecos).
  const keys: string[] = [];
  if (gran === "day") {
    for (let t = Date.parse(from + "T00:00:00Z"); t <= Date.parse(to + "T00:00:00Z"); t += DAY) keys.push(isoDay(new Date(t)));
  } else {
    const [fy, fm] = from.split("-").map(Number), [ty, tm] = to.split("-").map(Number);
    for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) keys.push(`${y}-${String(m).padStart(2, "0")}`);
  }

  const monthly = keys.map((mes) => {
    const m = byPeriod.get(mes) ?? emptyBucket();
    return { mes, ...m, total_bonos: m.diag + m.cita + m.desc, total_rev: Math.round((m.rev_diag + m.rev_cita + m.rev_desc) * 100) / 100 };
  });

  const totals = monthly.reduce((a, r) => ({
    diag: a.diag + r.diag, cita: a.cita + r.cita, desc: a.desc + r.desc,
    rev_diag: a.rev_diag + r.rev_diag, rev_cita: a.rev_cita + r.rev_cita, rev_desc: a.rev_desc + r.rev_desc,
  }), emptyBucket());
  const rev_total = Math.round((totals.rev_diag + totals.rev_cita + totals.rev_desc) * 100) / 100;

  return NextResponse.json(
    { months, from, to, gran, days: spanDays, since: from, monthly, totals: { ...totals, rev_total }, pct_diag: rev_total > 0 ? Math.round((totals.rev_diag / rev_total) * 1000) / 10 : null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
