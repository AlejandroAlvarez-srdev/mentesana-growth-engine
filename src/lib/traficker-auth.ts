// Auth para trafickers — cookie HMAC ms_traficker, OTP por email.
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";

const COOKIE_NAME = "ms_traficker";
const MAX_AGE = 60 * 60 * 24; // 24h

const DEFAULT_SECRET = "REDACTED_SECRET";
function getSecret(): string { return (process.env.TRAFICKER_SESSION_SECRET || DEFAULT_SECRET).trim(); }
function sign(payload: string, secret: string): string { return crypto.createHmac("sha256", secret).update(payload).digest("hex"); }

export type TrafickerProfile = { id: string; email: string; name: string; role: string };

export function issueTrafickerSession(profile: TrafickerProfile): { value: string; maxAge: number } {
  const secret = getSecret();
  const ts = Date.now();
  const payload = `${ts}.${Buffer.from(JSON.stringify(profile)).toString("base64url")}`;
  return { value: `${payload}.${sign(payload, secret)}`, maxAge: MAX_AGE };
}

function parseAndVerify(token: string): TrafickerProfile | null {
  try {
    const secret = getSecret();
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [ts, b64, sig] = parts;
    const expected = sign(`${ts}.${b64}`, secret);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const age = Date.now() - Number(ts);
    if (age < 0 || age > MAX_AGE * 1000) return null;
    return JSON.parse(Buffer.from(b64, "base64url").toString("utf-8")) as TrafickerProfile;
  } catch { return null; }
}

export async function getTraficker(req?: NextRequest): Promise<TrafickerProfile | null> {
  const store = req ? req.cookies : await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return parseAndVerify(token);
}

export async function requireTraficker(req: NextRequest) {
  const p = await getTraficker(req);
  if (!p) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return { traficker: p };
}

// Helper dual: acepta cookie de agente admin O cookie de traficker O cookie de video-maker.
// El video-maker (Dani) accede al chat de insights clínicos desde su propio panel
// (/video-maker → tab Insights) para orientar campañas y guiones con la voz real del paciente.
export async function requireTrafickerOrAdmin(req: NextRequest): Promise<{ email: string; name: string; kind: "traficker" | "agent" | "video_maker" } | NextResponse> {
  const traf = await getTraficker(req);
  if (traf) return { email: traf.email, name: traf.name, kind: "traficker" };
  const { getVideoMaker } = await import("@/lib/video-maker-auth");
  const maker = await getVideoMaker(req);
  if (maker) return { email: maker.email ?? "", name: maker.name ?? maker.email ?? "video-maker", kind: "video_maker" };
  const { getAgent } = await import("@/lib/agent-auth");
  const agent = await getAgent(req);
  if (agent && (agent.role === "admin" || agent.agent_type === "traficker")) {
    return { email: agent.email ?? "", name: agent.name ?? agent.email ?? "", kind: "agent" };
  }
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}

export function trafickerCookieOptions(maxAge: number) {
  return { name: COOKIE_NAME, httpOnly: true as const, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge };
}
export const TRAFICKER_COOKIE_NAME = COOKIE_NAME;
