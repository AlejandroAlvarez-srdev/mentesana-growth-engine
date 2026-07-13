// A/B testing determinista basado en hash de visitor_id.
// El mismo visitor siempre ve la misma variante (sticky) sin necesidad de servidor.

function hashString(s: string): number {
  // xmur3 (fast, deterministic, distributes uniformly)
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  h = h ^ (h >>> 16);
  return h >>> 0;
}

/**
 * Retorna 'A' (control) o 'B' (variante) de forma determinista.
 * split=0.5 → 50/50. El mismo visitorId + testName siempre da el mismo resultado.
 */
export function getVariant(testName: string, visitorId: string, split = 0.5): "A" | "B" {
  if (!visitorId) return "A";
  const h = hashString(`${testName}:${visitorId}`);
  const r = (h % 1_000_000) / 1_000_000;
  return r < split ? "B" : "A";
}

/** Lee (o genera) el visitor_id del localStorage, compatible con lib/tracking.ts */
export function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem("ms_visitor_id");
    if (!id) {
      id = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem("ms_visitor_id", id);
    }
    return id;
  } catch { return ""; }
}

/**
 * Fuerza una variante desde la URL: `?ab=A` o `?ab=B`.
 * Sticky por sesión: si el override viene por URL, lo guardamos en sessionStorage
 * para que persista entre navegaciones internas (schedule → payment → etc.).
 * Devuelve null si no hay override activo.
 */
export function getForcedVariant(): "A" | "B" | null {
  if (typeof window === "undefined") return null;
  try {
    // 1. Prioridad: query param en la URL actual
    const p = new URLSearchParams(window.location.search);
    const raw = (p.get("ab") || "").toUpperCase();
    if (raw === "A" || raw === "B") {
      sessionStorage.setItem("ms_ab_diagnostico_v2_forced", raw);
      return raw as "A" | "B";
    }
    // 2. Sticky durante la sesión (útil tras redirects internos)
    const cached = sessionStorage.getItem("ms_ab_diagnostico_v2_forced");
    if (cached === "A" || cached === "B") return cached as "A" | "B";
    return null;
  } catch { return null; }
}
