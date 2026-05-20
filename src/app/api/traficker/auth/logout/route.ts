import { NextResponse } from "next/server";
import { TRAFICKER_COOKIE_NAME } from "@/lib/traficker-auth";

export const dynamic = "force-dynamic";
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ name: TRAFICKER_COOKIE_NAME, value: "", path: "/", maxAge: 0 });
  return res;
}
