import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { issueTrafickerSession, trafickerCookieOptions } from "@/lib/traficker-auth";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  const code = String(body.code ?? "").trim();
  if (!email || !/^\d{6}$/.test(code)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const { data: otp } = await sb.from("traficker_otp").select("code, expires_at, attempts").eq("email", email).maybeSingle();
  if (!otp || new Date(otp.expires_at) < new Date()) return NextResponse.json({ error: "expired" }, { status: 401 });
  if (otp.attempts >= 5) return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  if (otp.code !== code) {
    await sb.from("traficker_otp").update({ attempts: (otp.attempts ?? 0) + 1 }).eq("email", email);
    return NextResponse.json({ error: "invalid_code" }, { status: 401 });
  }

  const { data: t } = await sb.from("trafickers").select("id, email, name, role").eq("email", email).eq("active", true).maybeSingle();
  if (!t) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await sb.from("traficker_otp").delete().eq("email", email);
  const session = issueTrafickerSession({ id: t.id, email: t.email, name: t.name, role: t.role });
  const opts = trafickerCookieOptions(session.maxAge);
  const res = NextResponse.json({ ok: true, traficker: t });
  res.cookies.set({ name: opts.name, value: session.value, httpOnly: opts.httpOnly, secure: opts.secure, sameSite: opts.sameSite, path: opts.path, maxAge: opts.maxAge });
  return res;
}
