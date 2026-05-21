import { NextRequest, NextResponse } from "next/server";
import { getTraficker } from "@/lib/traficker-auth";
import { getAgent } from "@/lib/agent-auth";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const t = await getTraficker(req);
  if (t) return NextResponse.json({ authenticated: true, traficker: t });
  // Fallback: admin agent puede ver el panel sin login OTP
  const agent = await getAgent(req);
  if (agent && (agent.role === "admin" || agent.agent_type === "traficker")) {
    return NextResponse.json({
      authenticated: true,
      traficker: { id: agent.id, email: agent.email ?? "", name: agent.name ?? "Admin", role: "admin" },
      via_admin: true,
    });
  }
  return NextResponse.json({ authenticated: false }, { status: 401 });
}
