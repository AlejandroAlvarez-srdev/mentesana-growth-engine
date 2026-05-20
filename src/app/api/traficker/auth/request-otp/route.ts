import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/emails/send";
import { emailLayout } from "@/lib/emails/layout";

const sb = createClient(process.env.NEXT_PUBLIC_BLOG_SUPABASE_URL!, process.env.BLOG_SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "invalid_email" }, { status: 400 });

  const { data: t } = await sb.from("trafickers").select("id, name, active").eq("email", email).eq("active", true).maybeSingle();
  if (!t) return NextResponse.json({ ok: true });

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expires = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await sb.from("traficker_otp").upsert({ email, code, expires_at: expires, attempts: 0, created_at: new Date().toISOString() }, { onConflict: "email" });

  const firstName = String(t.name ?? "").split(" ")[0] || "Hola";
  const content = `
    <p style="margin:0 0 16px;font-size:15px;color:#1a0a1f;">Hola ${firstName},</p>
    <p style="margin:0 0 24px;font-size:15px;color:#1a0a1f;">Tu código para entrar al panel Traficker de Mente Sana:</p>
    <div style="text-align:center;margin:24px 0;">
      <div style="display:inline-block;padding:18px 36px;background:linear-gradient(135deg,#6A178C,#8B2FB5);color:#fff;font-size:32px;font-weight:800;letter-spacing:8px;border-radius:14px;">${code}</div>
    </div>
    <p style="margin:0;font-size:13px;color:#555;text-align:center;">Caduca en 10 minutos.</p>
  `;
  await sendEmail({ to: email, toName: t.name, subject: `Tu código traficker: ${code}`, html: emailLayout({ title: "Acceso panel traficker", preheader: `Código ${code}`, content }) });
  return NextResponse.json({ ok: true });
}
