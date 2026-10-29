// Métricas de la app móvil para el panel del traficker (bloque "📱 App" del resumen).
// Tres fuentes, cada una degradable por separado:
//  - datos propios de la app (proyecto Supabase APP: users / sessions / push_tokens / tienda_events)
//  - compras del 9,99 hechas desde la app (BLOG payments, source = test-diagnostico-app)
//  - eventos del SDK de Meta atribuidos a la pauta (Graph insights de Aux, actions mobile_app_install /
//    app_custom_event.fb_mobile_*) + gasto de la campaña APP (meta_ad_insights sincronizado)
// Los totales del SDK (instalaciones/aperturas de TODA la app) no están disponibles por API con el token
// de ads: solo en Events Manager. Aquí se muestra lo atribuido a anuncios.
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";
import { sbAppData } from "@/lib/rlhf/extractors/supabase-clients";

const blog = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const AUX_FB_ACCOUNT = "REDACTED_ID"; // cuenta "Mente Sana Aux" (donde corre la campaña APP)
const APP_PAYMENT_SOURCE = "test-diagnostico-app"; // cómo marca el checkout los 9,99 pagados desde la app
const GRAPH = "https://graph.facebook.com/v22.0";

type Counts = { installs: number; registros: number; aperturas: number; compras: number; spend: number };
// Builder de PostgREST tras .select(): lo que reciben/devuelven los "apply" de filtros.
type Q = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// PostgREST corta en 1.000 filas: pagina por Range hasta agotar (tope de seguridad 20 páginas).
async function pagedColumn(sb: SupabaseClient, table: string, column: string, apply: (q: Q) => Q): Promise<string[]> {
  const out: string[] = [];
  const page = 1000;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await apply(sb.from(table).select(column)).range(i * page, (i + 1) * page - 1);
    if (error || !data) break;
    for (const r of data as Record<string, unknown>[]) if (r?.[column]) out.push(String(r[column]));
    if (data.length < page) break;
  }
  return out;
}

async function appMetrics(fromIso: string) {
  const sb = sbAppData();
  if (!sb) return { available: false as const, reason: "Faltan APP_SUPABASE_URL / APP_SUPABASE_SERVICE_KEY" };
  try {
    const count = async (table: string, apply: (q: Q) => Q) => {
      const { count } = await apply(sb.from(table).select("id", { count: "exact", head: true }));
      return count ?? 0;
    };
    const [cuentas_total, cuentas_nuevas, diagnosticos, checkouts_tienda, activosIds, pushTotalIds, pushNuevosIds] = await Promise.all([
      count("users", (q) => q),
      count("users", (q) => q.gte("created_at", fromIso)),
      count("users", (q) => q.not("diagnostico_completed_at", "is", null).gte("diagnostico_completed_at", fromIso)),
      count("tienda_events", (q) => q.eq("action", "open_checkout").gte("created_at", fromIso)),
      pagedColumn(sb, "sessions", "user_id", (q) => q.gte("created_at", fromIso)),
      pagedColumn(sb, "push_tokens", "user_id", (q) => q),
      pagedColumn(sb, "push_tokens", "user_id", (q) => q.gte("created_at", fromIso)),
    ]);
    return {
      available: true as const,
      cuentas_total,
      cuentas_nuevas,
      diagnosticos,
      checkouts_tienda,
      activos: new Set(activosIds).size,
      push_total: new Set(pushTotalIds).size,
      push_nuevos: new Set(pushNuevosIds).size,
    };
  } catch (e) {
    return { available: false as const, reason: errMsg(e) };
  }
}

async function comprasApp(fromIso: string) {
  const { data } = await blog
    .from("payments")
    .select("amount_cents, created_at")
    .eq("source", APP_PAYMENT_SOURCE)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(5000);
  const rows = data ?? [];
  const inRange = rows.filter((r) => r.created_at >= fromIso);
  const sum = (xs: { amount_cents: number | null }[]) => xs.reduce((a, r) => a + Number(r.amount_cents ?? 0), 0) / 100;
  return {
    n: inRange.length,
    eur: sum(inRange),
    n_total: rows.length,
    eur_total: sum(rows),
    primera: rows.length ? rows[rows.length - 1].created_at : null,
    ultima: rows[0]?.created_at ?? null,
    fuente: `payments · source=${APP_PAYMENT_SOURCE} · status=completed`,
  };
}

function parseActions(actions: { action_type: string; value: string }[] | undefined): Omit<Counts, "spend"> {
  const get = (...types: string[]) => {
    for (const t of types) {
      const hit = (actions ?? []).find((a) => a.action_type === t);
      if (hit) return Number(hit.value ?? 0);
    }
    return 0;
  };
  return {
    installs: get("mobile_app_install", "omni_app_install"),
    registros: get("app_custom_event.fb_mobile_complete_registration", "omni_complete_registration"),
    aperturas: get("app_custom_event.fb_mobile_activate_app", "omni_activate_app"),
    compras: get("app_custom_event.fb_mobile_purchase", "omni_purchase"),
  };
}

async function pautaApp(fromDate: string, toDate: string) {
  // Gasto de la campaña APP desde los insights sincronizados (misma fuente que el resto del panel).
  const { data: spendRows } = await blog
    .from("meta_ad_insights")
    .select("spend")
    .eq("fb_account_id", AUX_FB_ACCOUNT)
    .ilike("campaign_name", "%APP%")
    .gte("date_start", fromDate)
    .limit(5000);
  const spend_app_db = (spendRows ?? []).reduce((a, r) => a + Number(r.spend ?? 0), 0);

  // Eventos del SDK atribuidos: Graph en vivo con el token de la cuenta Aux.
  const { data: acc } = await blog
    .from("meta_ad_accounts")
    .select("id, meta_oauth_tokens(access_token)")
    .eq("fb_account_id", AUX_FB_ACCOUNT)
    .maybeSingle();
  const rel = (acc as { meta_oauth_tokens?: { access_token?: string } | { access_token?: string }[] | null } | null)?.meta_oauth_tokens;
  const token: string | undefined = Array.isArray(rel) ? rel[0]?.access_token : rel?.access_token ?? undefined;
  if (!token) return { available: false as const, reason: "Sin token Meta para Aux", spend_app: spend_app_db };

  const timeRange = encodeURIComponent(JSON.stringify({ since: fromDate, until: toDate }));
  const fetchJson = async (url: string) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), cache: "no-store" });
    return r.json();
  };
  try {
    const [cuenta, campanas] = await Promise.all([
      fetchJson(`${GRAPH}/act_${AUX_FB_ACCOUNT}/insights?fields=spend,actions&level=account&time_range=${timeRange}&access_token=${encodeURIComponent(token)}`),
      fetchJson(`${GRAPH}/act_${AUX_FB_ACCOUNT}/insights?fields=campaign_name,spend,actions&level=campaign&time_range=${timeRange}&limit=100&access_token=${encodeURIComponent(token)}`),
    ]);
    if (cuenta?.error) throw new Error(cuenta.error.message);
    const rowCuenta = cuenta?.data?.[0];
    const total: Counts = { ...parseActions(rowCuenta?.actions), spend: Number(rowCuenta?.spend ?? 0) };
    const app: Counts = { installs: 0, registros: 0, aperturas: 0, compras: 0, spend: 0 };
    for (const c of campanas?.data ?? []) {
      if (!/APP/i.test(String(c.campaign_name ?? ""))) continue;
      const p = parseActions(c.actions);
      app.installs += p.installs; app.registros += p.registros; app.aperturas += p.aperturas; app.compras += p.compras;
      app.spend += Number(c.spend ?? 0);
    }
    const spend_app = app.spend || spend_app_db;
    return {
      available: true as const,
      spend_app,
      campana_app: app,
      cuenta: total,
      coste_install: app.installs ? spend_app / app.installs : null,
      coste_registro: app.registros ? spend_app / app.registros : null,
    };
  } catch (e) {
    return { available: false as const, reason: errMsg(e), spend_app: spend_app_db };
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if ("status" in auth) return auth;
  const { searchParams } = new URL(req.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") || "30", 10) || 30, 1), 90);
  const from = new Date(Date.now() - days * 86400000);
  const fromIso = from.toISOString();
  const fromDate = fromIso.slice(0, 10);
  const toDate = new Date().toISOString().slice(0, 10);

  const [app, compras, pauta] = await Promise.all([appMetrics(fromIso), comprasApp(fromIso), pautaApp(fromDate, toDate)]);
  return NextResponse.json({ days, from: fromIso, app, compras, pauta });
}
