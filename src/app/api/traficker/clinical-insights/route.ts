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
export const maxDuration = 300; // Opus 4.8 + barrido amplio del corpus tarda; evita 504

// Tamaño mínimo de grupo para mostrar un recuento (k-anonimato). Por debajo se suprime.
const MIN_GROUP = 10;

// Columnas de texto sobre las que se cuenta (NUNCA se seleccionan ni se devuelven, solo COUNT).
const CLIN_COLS = ["highlights", "how_went", "patient_state", "intervention"];
const SESS_COLS = ["summary_md", "raw_excerpt"];
const CHAT_COLS = ["content"];
// Columnas de texto por corpus (para los recuentos ILIKE por tema).
const COLS_BY_KIND: Record<Kind, string[]> = { clinical: CLIN_COLS, sessions: SESS_COLS, chats: CHAT_COLS };

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

// Fuentes disponibles. chats = mensajes ENTRANTES del paciente en el CRM (type='received').
type Kind = "clinical" | "sessions" | "chats";
const KIND_CFG: Record<Kind, { table: string; dateCol: string }> = {
  clinical: { table: "psychologist_clinical_notes", dateCol: "session_date" },
  sessions: { table: "session_notes", dateCol: "meet_started_at" },
  chats: { table: "messages_mentesana", dateCol: "created_at" },
};

async function countCorpus(kind: Kind, orStr: string | null, from?: string, to?: string): Promise<number> {
  const { table, dateCol } = KIND_CFG[kind];
  let q: any = sb.from(table).select("id", { count: "exact", head: true });
  if (kind === "sessions") q = q.neq("status", "discarded");
  if (kind === "chats") q = q.eq("type", "received"); // solo lo que escribe el paciente
  if (orStr) q = q.or(orStr);
  if (from) q = q.gte(dateCol, from);
  if (to) q = q.lt(dateCol, to);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

// "all" = las tres fuentes; "both" se mantiene (clínicos + sesiones) por retrocompat.
type Corpus = Kind | "both" | "all";
function corporaOf(c: Corpus): Kind[] {
  if (c === "all") return ["clinical", "sessions", "chats"];
  if (c === "both") return ["clinical", "sessions"];
  return [c];
}

// ── Herramientas (solo agregación) ──────────────────────────────────────────

async function toolTopicFrequencies(corpus: Corpus) {
  const kinds = corporaOf(corpus);
  const total = (await Promise.all(kinds.map((k) => countCorpus(k, null)))).reduce((a, b) => a + b, 0);
  if (total < MIN_GROUP) return { suppressed: true, reason: "corpus_too_small", note: "No hay suficientes registros para reportar nada de forma anónima." };

  const rows = await Promise.all(
    TAXONOMY.map(async (t) => {
      const counts = await Promise.all(kinds.map((k) => countCorpus(k, buildOr(COLS_BY_KIND[k], t.syn))));
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
  if (kinds.includes("chats")) {
    const total = await countCorpus("chats", null);
    out.chats_pacientes = total < MIN_GROUP ? { suppressed: true } : { total_mensajes_entrantes: total };
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
      const counts = await Promise.all(kinds.map((k) => countCorpus(k, buildOr(COLS_BY_KIND[k], t.syn), b.from, b.to)));
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
    input_schema: { type: "object", properties: { corpus: { type: "string", enum: ["clinical", "sessions", "chats", "all"], description: "clinical=historiales, sessions=sesiones grabadas, chats=mensajes entrantes del paciente, all=las tres (default)." } } },
  },
  {
    name: "corpus_overview",
    description: "Resumen agregado del volumen disponible: nº de historiales/sesiones, % con red flags, asistencia. Sin datos de ningún paciente.",
    input_schema: { type: "object", properties: { corpus: { type: "string", enum: ["clinical", "sessions", "chats", "all"] } } },
  },
  {
    name: "topic_trend",
    description: "Evolución mensual de las menciones de UN tema concreto (para ver dolores en alza). Recuentos agregados por mes con k-anonimato.",
    input_schema: { type: "object", properties: { topic: { type: "string", description: "Clave del tema (ansiedad, pareja, duelo, autoestima, laboral, insomnio, trauma, toc, alimentacion, tdah, familia, dependencia, regulacion, soledad, social, maternidad, panico)." }, corpus: { type: "string", enum: ["clinical", "sessions", "chats", "all"] }, months: { type: "number", description: "Nº de meses hacia atrás (2-12, default 6)." } }, required: ["topic"] },
  },
  {
    name: "search_sessions",
    description: "Busca por SIGNIFICADO en el corpus embebido de voz del paciente (notas clínicas, expectativas del diagnóstico, tareas terapéuticas y quejas) y devuelve muchos fragmentos ANÓNIMOS de lo que expresan, en sus propias palabras. Úsalo para frases, dolores recurrentes, cómo describen su problema, objeciones, quejas, etc. Sube el limit para barrer la mayoría del corpus. Los fragmentos vienen saneados (sin nombres, emails, teléfonos ni IDs). NUNCA incluye de quién es cada fragmento.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Pregunta natural en español. Ej: 'cómo describen la ansiedad', 'qué dicen sobre dormir mal', 'frustración con terapias anteriores'." }, limit: { type: "number", description: "Nº de fragmentos (default 25, máx 60 — sube para barrer más corpus)." } }, required: ["query"] },
  },
  {
    name: "search_chats",
    description: "Busca por palabras clave en lo que ESCRIBEN los pacientes por WhatsApp/chat (solo mensajes entrantes) y devuelve fragmentos ANÓNIMOS y saneados. Úsalo para saber cómo preguntan, qué objeciones/dudas ponen antes de comprar, con qué palabras piden ayuda, quejas, etc. Los fragmentos vienen sin nombres, emails, teléfonos ni IDs. NUNCA incluye de quién es cada fragmento.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "Palabras o tema a buscar en los chats. Ej: 'precio', 'no tengo tiempo', 'ansiedad', 'reembolso'." }, limit: { type: "number", description: "Nº de fragmentos (default 12, máx 25)." } }, required: ["query"] },
  },
];

const SYSTEM = `Eres el Consultor de Insights Clínicos de Mente Sana Psicología, para el equipo de marketing/tráfico.

Tu trabajo: ayudar al traficker a entender la terapia real y la voz del paciente para orientar campañas, ángulos y mensajes. Tienes TRES fuentes: historiales clínicos, sesiones grabadas y los chats (lo que la gente escribe por WhatsApp). PUEDES contar:
- QUÉ dicen los pacientes, sus frases y cómo describen su problema en sus propias palabras.
- Cómo preguntan, qué dudas/objeciones ponen en el chat antes de comprar.
- Temas y dolores recurrentes, objeciones, expectativas.
- Recuentos agregados por tema y su evolución.

LO ÚNICO PROHIBIDO: revelar datos que IDENTIFIQUEN a un paciente concreto. NUNCA des nombres, apellidos, email, teléfono, ni ningún dato personal que permita saber QUIÉN dijo algo. Si un fragmento trae un nombre propio u otro dato personal, NO lo menciones: habla siempre de "un/a paciente", "varios", "muchos", en genérico. Está perfecto citar lo que dicen y los patrones; lo que no se da es la identidad de quién lo dice.

Herramientas:
- search_sessions → frases y cómo se expresan en historiales/diagnóstico (fragmentos anónimos saneados). "qué dicen / cómo describen".
- search_chats → cómo escriben por WhatsApp: dudas, objeciones antes de comprar, con qué palabras piden ayuda (fragmentos anónimos saneados).
- topic_frequencies / topic_trend / corpus_overview → cantidades y evolución por corpus (clinical/sessions/chats/all) con k-anonimato ${MIN_GROUP}; "menciones del tema", NO nº de pacientes.

Cómo responder (potente y con contexto): NO te quedes en lo superficial. Usa VARIAS herramientas por pregunta y CRUZA las tres fuentes (historiales, sesiones y chats) para dar una respuesta rica y bien fundamentada. Cuando aporte, llama a search_sessions Y search_chats para contrastar cómo lo viven en terapia vs cómo lo escriben antes de comprar. Estructura la respuesta: (1) hallazgo principal con datos/agregados, (2) la voz del paciente (frases anónimas reales que lo ilustren), (3) 2-3 recomendaciones de marketing accionables (ángulo, mensaje/copy usando sus propias palabras, y a qué segmento). Español, directo pero completo. Nunca inventes datos: si una fuente no tiene suficiente, dilo.`;

// Saneo de fragmentos antes de dárselos al modelo: quita prefijos con IDs, emails,
// teléfonos y referencias a psicóloga/cita N. (Los nombres propios los filtra además
// el system prompt, que prohíbe nombrarlos.)
function scrubSnippet(text: string): string {
  return String(text || "")
    .replace(/^Nota clínica psicóloga\s+\d+\s*\([^)]*\):\s*/i, "")
    .replace(/\bpsic[óo]loga\s+\d+/gi, "una psicóloga")
    .replace(/\bcita\s+\d+/gi, "una sesión")
    .replace(/\bALERTA:/gi, "")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/\b\+?\d[\d\s().-]{7,}\d\b/g, "[teléfono]")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function toolSearchSessions(query: string, limit: any) {
  const q = String(query ?? "").trim();
  if (!q) return { error: "missing_query" };
  const { voyageEmbed } = await import("@/lib/voyage-embed");
  const emb = await voyageEmbed(q, "query");
  if (!emb) return { error: "embedding_failed" };
  const n = Math.min(Math.max(Number(limit) || 25, 1), 60);
  // Barre la mayoría del corpus embebido de VOZ DEL PACIENTE: notas clínicas, expectativas
  // del diagnóstico, tareas y quejas. (Se dejan fuera meta_ad/video_brief/funnel: son material
  // interno de marketing, no voz del paciente.)
  const { data, error } = await sb.rpc("jarvis_search", { query_embedding: `[${emb.join(",")}]`, kinds: ["clinical_note", "diagnostico_test", "patient_task", "complaint"], match_limit: n });
  if (error) return { error: error.message };
  // SOLO devolvemos el texto saneado. Sin source_id, sin metadata, sin de quién es.
  const snippets = (data ?? []).map((r: any) => scrubSnippet(r.content)).filter((s: string) => s.length > 15);
  return { snippets, note: "Fragmentos anónimos (sin identidad). No menciones nombres ni datos personales aunque aparezcan." };
}

// Búsqueda en los CHATS del CRM: solo mensajes ENTRANTES del paciente (type='received'),
// por palabras clave, devolviendo fragmentos ANÓNIMOS y saneados. Sin embeddings (los chats
// no están indexados), así que casa por términos de la consulta. NUNCA de quién es cada uno.
async function toolSearchChats(query: string, limit: any) {
  const q = String(query ?? "").trim();
  if (!q) return { error: "missing_query" };
  // Términos: palabras de ≥5 letras (sin acentos ni símbolos que rompan el .or()).
  const terms = Array.from(new Set(
    q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 5),
  )).slice(0, 6);
  if (terms.length === 0) return { snippets: [], note: "Consulta demasiado genérica; usa palabras más concretas." };
  const orStr = terms.map((t) => `content.ilike."*${t}*"`).join(",");
  const n = Math.min(Math.max(Number(limit) || 12, 1), 25);
  const { data, error } = await sb
    .from("messages_mentesana")
    .select("content")
    .eq("type", "received")
    .or(orStr)
    .order("created_at", { ascending: false })
    .limit(n * 4);
  if (error) return { error: error.message };
  const seen = new Set<string>();
  const snippets: string[] = [];
  for (const r of data ?? []) {
    const s = scrubSnippet(r.content);
    if (s.length < 15 || s.length > 400) continue; // fuera mensajes muy cortos o parrafadas
    const key = s.slice(0, 60).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(s);
    if (snippets.length >= n) break;
  }
  return { snippets, note: "Fragmentos anónimos de lo que escriben los pacientes por chat (saneados, sin identidad). No menciones nombres ni datos personales aunque aparezcan." };
}

// ── Persistencia del historial (best-effort, no rompe el chat si falla) ──────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function saveTurn(conversationId: string, email: string, name: string, question: string, answer: string) {
  try {
    await sb.from("traficker_chat_messages").insert([
      { conversation_id: conversationId, traficker_email: email, traficker_name: name, role: "user", content: question },
      { conversation_id: conversationId, traficker_email: email, traficker_name: name, role: "assistant", content: answer },
    ]);
  } catch { /* el historial es secundario; nunca debe tumbar la respuesta */ }
}

// GET ?conversation_id=… → mensajes de esa conversación (de este traficker).
// GET sin params       → lista de conversaciones del traficker (id, título, fecha, nº).
export async function GET(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(req.url);
  const convId = url.searchParams.get("conversation_id");

  if (convId && UUID_RE.test(convId)) {
    const { data, error } = await sb
      .from("traficker_chat_messages")
      .select("role, content, created_at")
      .eq("traficker_email", auth.email)
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true })
      .limit(400);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ conversation_id: convId, messages: data ?? [] });
  }

  // Últimos mensajes del traficker → agrupar por conversación en JS.
  const { data, error } = await sb
    .from("traficker_chat_messages")
    .select("conversation_id, role, content, created_at")
    .eq("traficker_email", auth.email)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byConv = new Map<string, { conversation_id: string; title: string; last_at: string; count: number }>();
  for (const m of data ?? []) {
    const existing = byConv.get(m.conversation_id);
    if (!existing) {
      byConv.set(m.conversation_id, { conversation_id: m.conversation_id, title: "", last_at: m.created_at, count: 1 });
    } else {
      existing.count++;
    }
    // Como vienen en orden descendente, la última pregunta de usuario que veamos es la más antigua → título.
    if (m.role === "user") byConv.get(m.conversation_id)!.title = m.content.slice(0, 80);
  }
  const conversations = [...byConv.values()].sort((a, b) => (a.last_at < b.last_at ? 1 : -1));
  return NextResponse.json({ conversations });
}

export async function POST(req: NextRequest) {
  const auth = await requireTrafickerOrAdmin(req);
  if (auth instanceof NextResponse) return auth;

  const ANTHROPIC_KEY = (process.env.ANTHROPIC_API_KEY ?? "").trim();
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: "anthropic_not_configured" }, { status: 500 });

  const body = await req.json().catch(() => ({}));
  const question = String(body.question ?? "").trim().slice(0, 1500);
  if (!question) return NextResponse.json({ error: "empty_question" }, { status: 400 });

  const conversationId = UUID_RE.test(String(body.conversation_id ?? "")) ? String(body.conversation_id) : null;

  // Historial de conversación lo mantiene el cliente (sin persistencia, sin PII).
  const history: { role: string; content: string }[] = Array.isArray(body.history)
    ? body.history.filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string").slice(-16)
    : [];

  const messages: any[] = [...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: question }];

  for (let i = 0; i < 5; i++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "anthropic-version": "2023-06-01", "x-api-key": ANTHROPIC_KEY },
      body: JSON.stringify({ model: "claude-opus-4-8", max_tokens: 4000, system: SYSTEM, tools: TOOLS, messages }),
    });
    if (!r.ok) return NextResponse.json({ error: "claude_error", message: await r.text() }, { status: 500 });
    const data = await r.json();

    if (data.stop_reason === "tool_use") {
      messages.push({ role: "assistant", content: data.content });
      const toolResults: any[] = [];
      for (const tu of data.content.filter((c: any) => c.type === "tool_use")) {
        let result: any;
        const corpus: Corpus = ["clinical", "sessions", "chats", "both", "all"].includes(tu.input?.corpus) ? tu.input.corpus : "all";
        if (tu.name === "topic_frequencies") result = await toolTopicFrequencies(corpus);
        else if (tu.name === "corpus_overview") result = await toolCorpusOverview(corpus);
        else if (tu.name === "topic_trend") result = await toolTopicTrend(String(tu.input?.topic ?? ""), corpus, tu.input?.months);
        else if (tu.name === "search_sessions") result = await toolSearchSessions(String(tu.input?.query ?? ""), tu.input?.limit);
        else if (tu.name === "search_chats") result = await toolSearchChats(String(tu.input?.query ?? ""), tu.input?.limit);
        else result = { error: "unknown_tool" };
        toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 20000) });
      }
      messages.push({ role: "user", content: toolResults });
      continue;
    }

    const text = (data.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    if (conversationId) await saveTurn(conversationId, auth.email, auth.name, question, text);
    return NextResponse.json({ answer: text, iterations: i + 1, conversation_id: conversationId });
  }
  return NextResponse.json({ error: "max_iterations", message: "Reformula la pregunta, por favor." }, { status: 500 });
}
