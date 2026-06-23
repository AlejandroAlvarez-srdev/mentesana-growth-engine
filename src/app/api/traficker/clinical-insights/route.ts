// Panel consultivo (chat IA) para el traficker sobre historiales clínicos y sesiones grabadas.
//
// REGLA DURA: NUNCA información de ningún paciente concreto. Garantizado por arquitectura:
// la IA NO recibe SQL libre ni filas ni texto crudo de pacientes. Solo puede llamar a
// herramientas que devuelven RECUENTOS AGREGADOS por tema, con k-anonimato (se suprime
// cualquier grupo con menos de MIN_GROUP registros). No hay nombres, IDs, teléfonos,
// alias, appointment_id ni citas textuales en ninguna respuesta.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireTrafickerOrAdmin } from "@/lib/traficker-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// Tamaño mínimo de grupo para mostrar un recuento (k-anonimato). Por debajo se suprime.
const MIN_GROUP = 10;

// Columnas de texto sobre las que se cuenta (NUNCA se seleccionan ni se devuelven, solo COUNT).
const CLIN_COLS = ["highlights", "how_went", "patient_state", "intervention"];
const SESS_COLS = ["summary_md", "raw_excerpt"];

// Taxonomía de temas clínicos (stems sin acento donde es seguro, para que ILIKE casa con o sin tilde).
const TAXONOMY: { topic: string; label: string; syn: string[] }[] = [
  { topic: "ansiedad", label: "Ansiedad", syn: ["ansied", "ansios", "angustia", "nervios"] },
  { topic: "panico", label: "Ataques de pánico", syn: ["pánico", "panico", "palpitacion"] },
  { topic: "depresion", label: "Depresión / tristeza", syn: ["depresi", "tristeza", "desánimo", "desanimo", "anhedonia"] },
  { topic: "autoestima", label: "Autoestima", syn: ["autoestima", "insegur", "autocrític", "autocritic", "autoexigen", "impostor"] },
  { topic: "pareja", label: "Pareja / ruptura", syn: ["pareja", "ruptura", "divorcio", "celos", "infidelidad"] },
  { topic: "duelo", label: "Duelo / pérdida", syn: ["duelo", "pérdida", "perdida", "fallecim", "luto"] },
  { topic: "laboral", label: "Estrés laboral / burnout", syn: ["burnout", "laboral", "agotam", "quemad"] },
  { topic: "insomnio", label: "Insomnio / sueño", syn: ["insomnio", "dormir", "sueño", "sueno"] },
  { topic: "trauma", label: "Trauma / abuso", syn: ["trauma", "abuso", "maltrato", "postraum"] },
  { topic: "toc", label: "Obsesiones / TOC", syn: ["obsesi", "compulsi", "ritual"] },
  { topic: "alimentacion", label: "Conducta alimentaria", syn: ["alimentar", "atracón", "atracon", "anorexia", "bulimia"] },
  { topic: "tdah", label: "Atención / TDAH", syn: ["tdah", "concentrac", "impulsiv"] },
  { topic: "familia", label: "Familia / crianza", syn: ["familia", "crianza", "hijos", "madre", "padre"] },
  { topic: "dependencia", label: "Dependencia emocional / apego", syn: ["dependencia emocional", "apego", "abandono"] },
  { topic: "regulacion", label: "Gestión emocional", syn: ["regulación emocional", "regulacion emocional", "gestión emocional", "gestion emocional"] },
  { topic: "soledad", label: "Soledad / aislamiento", syn: ["soledad", "aislam"] },
  { topic: "social", label: "Fobia social / timidez", syn: ["fobia social", "timidez", "vergüenza", "verguenza"] },
  { topic: "maternidad", label: "Maternidad / postparto", syn: ["postparto", "posparto", "maternidad", "embarazo"] },
];
const TOPIC_BY_KEY = new Map(TAXONOMY.map((t) => [t.topic, t]));

const guard = (n: number) => (n >= MIN_GROUP ? n : null);

// Construye un filtro PostgREST .or() con ILIKE sobre cada (columna × sinónimo).
function buildOr(cols: string[], syn: string[]): string {
  const terms: string[] = [];
  for (const c of cols) for (const s of syn) terms.push(`${c}.ilike."*${s}*"`);
  return terms.join(",");
}

async function countCorpus(kind: "clinical" | "sessions", orStr: string | null, from?: string, to?: string): Promise<number> {
  const table = kind === "clinical" ? "psychologist_clinical_notes" : "session_notes";
  const dateCol = kind === "clinical" ? "session_date" : "meet_started_at";
  let q: any = sb.from(table).select("id", { count: "exact", head: true });
  if (kind === "sessions") q = q.neq("status", "discarded");
  if (orStr) q = q.or(orStr);
  if (from) q = q.gte(dateCol, from);
  if (to) q = q.lt(dateCol, to);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

type Corpus = "clinical" | "sessions" | "both";
function corporaOf(c: Corpus): ("clinical" | "sessions")[] {
  return c === "both" ? ["clinical", "sessions"] : [c];
}

// ── Herramientas (solo agregación) ──────────────────────────────────────────

async function toolTopicFrequencies(corpus: Corpus) {
  const kinds = corporaOf(corpus);
  const total = (await Promise.all(kinds.map((k) => countCorpus(k, null)))).reduce((a, b) => a + b, 0);
  if (total < MIN_GROUP) return { suppressed: true, reason: "corpus_too_small", note: "No hay suficientes registros para reportar nada de forma anónima." };

  const rows = await Promise.all(
    TAXONOMY.map(async (t) => {
      const counts = await Promise.all(kinds.map((k) => countCorpus(k, buildOr(k === "clinical" ? CLIN_COLS : SESS_COLS, t.syn))));
      const c = counts.reduce((a, b) => a + b, 0);
      return { topic: t.topic, label: t.label, mentions: guard(c), pct: guard(c) != null ? Math.round((c / total) * 1000) / 10 : null };
    }),
  );
  const visible = rows.filter((r) => r.mentions != null).sort((a, b) => (b.mentions ?? 0) - (a.mentions ?? 0));
  const suppressed = rows.length - visible.length;
  return {
    corpus, k_anonymity: MIN_GROUP, total_records: total,
    unit: "menciones del tema en los registros (no es nº de pacientes)",
    topics: visible,
    suppressed_topics: suppressed,
    note: `Se ocultan los temas con menos de ${MIN_GROUP} menciones por anonimato.`,
  };
}

async function toolCorpusOverview(corpus: Corpus) {
  const out: any = { k_anonymity: MIN_GROUP };
  const kinds = corporaOf(corpus);
  if (kinds.includes("clinical")) {
    const total = await countCorpus("clinical", null);
    const withFlags = await countCorpus("clinical", `red_flags.not.is.null,red_flags.neq.""`);
    const { count: attendedCount } = await sb.from("psychologist_clinical_notes").select("id", { count: "exact", head: true }).is("attended", true);
    out.historiales_clinicos = total < MIN_GROUP ? { suppressed: true } : {
      total_notas: total,
      con_red_flags: guard(withFlags),
      asistencia_confirmada: guard(attendedCount ?? 0),
    };
  }
  if (kinds.includes("sessions")) {
    const total = await countCorpus("sessions", null);
    out.sesiones_grabadas = total < MIN_GROUP ? { suppressed: true } : { total_sesiones: total };
  }
  out.note = "Solo agregados. Ningún dato identifica a un paciente concreto.";
  return out;
}

async function toolTopicTrend(topicKey: string, corpus: Corpus, months: number) {
  const t = TOPIC_BY_KEY.get(topicKey);
  if (!t) return { error: "topic_desconocido", valid_topics: TAXONOMY.map((x) => x.topic) };
  const n = Math.min(Math.max(Number(months) || 6, 2), 12);
  const kinds = corporaOf(corpus);
  // Construye ventanas mensuales (UTC) hacia atrás desde el mes actual.
  const now = new Date();
  const buckets: { month: string; from: string; to: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
    buckets.push({ month: from.toISOString().slice(0, 7), from: from.toISOString(), to: to.toISOString() });
  }
  const series = await Promise.all(
    buckets.map(async (b) => {
      const counts = await Promise.all(kinds.map((k) => countCorpus(k, buildOr(k === "clinical" ? CLIN_COLS : SESS_COLS, t.syn), b.from, b.to)));
      const c = counts.reduce((a, x) => a + x, 0);
      return { month: b.month, mentions: guard(c) };
    }),
  );
  return { topic: t.topic, label: t.label, corpus, k_anonymity: MIN_GROUP, unit: "menciones/mes", series, note: `Meses con menos de ${MIN_GROUP} menciones se muestran como null por anonimato.` };
}

const TOOLS = [
  {
    name: "topic_frequencies",
    description: "Devuelve cuántas veces aparece cada tema clínico (ansiedad, pareja, duelo, autoestima, etc.) en los historiales y/o sesiones. Solo recuentos agregados, nunca pacientes. Úsalo para saber qué dolores son más comunes.",
    input_schema: { type: "object", properties: { corpus: { type: "string", enum: ["clinical", "sessions", "both"], description: "clinical=historiales, sessions=sesiones grabadas, both=ambos (default)." } } },
  },
  {
    name: "corpus_overview",
    description: "Resumen agregado del volumen disponible: nº de historiales/sesiones, % con red flags, asistencia. Sin datos de ningún paciente.",
    input_schema: { type: "object", properties: { corpus: { type: "string", enum: ["clinical", "sessions", "both"] } } },
  },
  {
    name: "topic_trend",
    description: "Evolución mensual de las menciones de UN tema concreto (para ver dolores en alza). Recuentos agregados por mes con k-anonimato.",
    input_schema: { type: "object", properties: { topic: { type: "string", description: "Clave del tema (ansiedad, pareja, duelo, autoestima, laboral, insomnio, trauma, toc, alimentacion, tdah, familia, dependencia, regulacion, soledad, social, maternidad, panico)." }, corpus: { type: "string", enum: ["clinical", "sessions", "both"] }, months: { type: "number", description: "Nº de meses hacia atrás (2-12, default 6)." } }, required: ["topic"] },
  },
];

const SYSTEM = `Eres el Consultor de Insights Clínicos (anonimizado) de Mente Sana Psicología, para el equipo de marketing/tráfico.

Tu trabajo: ayudar al traficker a entender QUÉ TEMAS Y DOLORES son más frecuentes en la terapia real (historiales clínicos y sesiones grabadas) para orientar campañas, ángulos de anuncios y mensajes — SIEMPRE en agregado.

REGLA ABSOLUTA E INNEGOCIABLE: jamás des información de ningún paciente concreto. No tienes acceso a nombres, IDs, teléfonos, alias, fechas de citas individuales ni a citas textuales de sesiones. Solo manejas RECUENTOS AGREGADOS por tema. Si te piden identificar a alguien, "el caso de…", una transcripción, una frase literal de un paciente, o cualquier dato individual, RECHAZA con educación y recuérdales que este panel es 100% anónimo y agregado por diseño.

Anonimato: los grupos con menos de ${MIN_GROUP} registros se ocultan (k-anonimato). Si una herramienta devuelve "suppressed", explica que no hay volumen suficiente para reportarlo de forma anónima.

Importante: los recuentos son "menciones del tema" en los registros, NO número de pacientes. No los presentes como pacientes.

Usa las herramientas para responder con datos reales. Responde en español, conciso (máx 3 párrafos), con números/porcentajes y, cuando ayude, una recomendación de marketing accionable (ángulo, mensaje, segmento). Nunca inventes cifras.`;

export async function POST(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: "anthropic_not_configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? "").trim().slice(0, 1500);
  if (!question) return NextResponse.json({ error: "empty_question" }, { status: 400 });

  // Historial de conversación lo mantiene el cliente (sin persistencia, sin PII).
  const history: { role: string; content: string }[] = Array.isArray(body.history)
    ? body.history.filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string").slice(-10)
    : [];

  const messages: any[] = [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: question }];

  for (let i = 0; i < 5; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": ANTHROPIC_KEY },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 1100, system: SYSTEM, tools: TOOLS, messages }),
    });
    if (!r.ok) return NextResponse.json({ error: "claude_error", message: await r.text() }, { status: 500 });
    const data = await r.json();

    if (data.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: data.content });
      const toolResults: any[] = [];
      for (const tu of data.content.filter((c: any) => c.type === "tool_use")) {
        let result: any;
        const corpus: Corpus = ["clinical", "sessions", "both"].includes(tu.input?.corpus) ? tu.input.corpus : "both";
        if (tu.name === "topic_frequencies") result = await toolTopicFrequencies(corpus);
        else if (tu.name === "corpus_overview") result = await toolCorpusOverview(corpus);
        else if (tu.name === "topic_trend") result = await toolTopicTrend(String(tu.input?.topic ?? ""), corpus, tu.input?.months);
        else result = { error: "unknown_tool" };
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 8000) });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const text = (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    return NextResponse.json({ answer: text, iterations: i + 1 });
  }
  return NextResponse.json({ error: "max_iterations", message: "Reformula la pregunta, por favor." }, { status: 500 });
}
