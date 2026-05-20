import { NextRequest, NextResponse } from "next/server";
import { getTraficker } from "@/lib/traficker-auth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const t = await getTraficker(req);
  if (!t) return NextResponse.json({ authenticated: false }, { status: 401 });
  return NextResponse.json({ authenticated: true, traficker: t });
}
