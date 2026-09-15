// Consentimiento de cookies — RGPD + Guía AEPD Cookies (julio 2023).
// El consentimiento es PREVIO, GRANULAR y revocable. Mientras no exista decisión
// del usuario, no se carga ningún script de analítica/marketing.

export const CONSENT_KEY = "ms_cookie_consent_v1";
export const CONSENT_EVENT = "ms:cookie-consent-changed";

export type ConsentCategories = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
};

export type ConsentRecord = {
  v: 1;
  categories: ConsentCategories;
  ts: string;
};

export function readConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentRecord;
    if (parsed?.v !== 1 || !parsed.categories) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeConsent(categories: Omit<ConsentCategories, "necessary">) {
  if (typeof window === "undefined") return;
  const record: ConsentRecord = {
    v: 1,
    categories: { necessary: true, analytics: !!categories.analytics, marketing: !!categories.marketing },
    ts: new Date().toISOString(),
  };
  localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  // Consent Mode v2 (Google): actualiza las señales a granted/denied según la
  // decisión. Import dinámico para no acoplar en SSR. Ver src/lib/consent-mode.ts.
  import("./consent-mode").then((m) => m.updateConsentMode(record.categories.analytics, record.categories.marketing)).catch(() => {});
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: record }));
}

export function clearConsent() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(CONSENT_KEY);
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: null }));
}

export function hasConsent(category: "analytics" | "marketing"): boolean {
  const c = readConsent();
  return !!c?.categories[category];
}
