// GET /api/cron/vuelve-1999
// Vercel Cron cada 5 min: pagos de la campaña WhatsApp "vuelve con tu psicóloga" (19,99)
// → bono de 1 sesión con su psicóloga en Amelia + aviso al equipo. Ver src/lib/vuelve-1999.ts.
import { NextRequest, NextResponse } from "next/server";
import { syncVuelve1999 } from "@/lib/vuelve-1999";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncVuelve1999()) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "vuelve_1999_failed" }, { status: 500 });
  }
}
