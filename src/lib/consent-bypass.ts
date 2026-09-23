// Dominios donde el tracking se dispara SIN esperar el consentimiento del banner
// (bypass del Consent Mode). SCOPED a embudos de anuncios concretos — el sitio
// principal mentesanapsicologia.com NO está aquí y mantiene su gating RGPD/AEPD.
//
// OJO cumplimiento: para tráfico UE esto es un riesgo RGPD/AEPD; se usa en dominios
// de campaña (LATAM). El píxel de salud sigue suprimiendo Lead/Purchase/Schedule/
// Contact — aquí solo se fuerzan PageView/ViewContent y eventos custom.
export const CONSENT_BYPASS_HOSTS = new Set<string>([
  "sesiondecitasms.com",
  "www.sesiondecitasms.com",
]);

export function consentBypassed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return CONSENT_BYPASS_HOSTS.has(window.location.hostname);
  } catch {
    return false;
  }
}
