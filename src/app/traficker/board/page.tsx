// Kanban personal del traficker.
import Link from "next/link";
import MyTasksKanban from "@/components/MyTasksKanban";

export const dynamic = "force-dynamic";

export default function TrafickerBoard() {
  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "20px 16px" }}>
      <div style={{ marginBottom: 14 }}>
        <Link href="/traficker" style={{ fontSize: 12, color: "#6A178C", textDecoration: "none", fontWeight: 700 }}>← Volver al panel</Link>
      </div>
      <MyTasksKanban api="/api/traficker/tasks" title="Mi Kanban" />
    </div>
  );
}
