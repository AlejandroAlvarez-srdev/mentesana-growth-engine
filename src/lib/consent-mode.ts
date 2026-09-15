// Google Consent Mode v2 (RGPD/AEPD). Señales de consentimiento para Google
// (GTM/GA4/Google Ads). Patrón oficial: default DENIED antes de cargar GTM →
// update GRANTED/DENIED cuando el usuario decide en el banner.
// Ref: https://developers.google.com/tag-platform/security/guides/consent
//
// Additivo: NO cambia qué scripts se cargan. Solo empuja las señales de consent
// al dataLayer. GTM/tags de Google las respetan (denied = sin cookies/PII; con
// modo avanzado en el contenedor, envían pings anónimos para modelado).

// Snippet inline que DEBE ejecutarse ANTES que GTM (se monta primero en
// TrackingScripts). Define dataLayer + gtag y fija el default en DENIED.
export const CONSENT_DEFAULT_JS = `
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
window.gtag = window.gtag || gtag;
gtag('consent', 'default', {
  'ad_storage': 'denied',
  'ad_user_data': 'denied',
  'ad_personalization': 'denied',
  'analytics_storage': 'denied',
  'wait_for_update': 500
});
try {
  var _c = JSON.parse(localStorage.getItem('ms_cookie_consent_v1') || 'null');
  if (_c && _c.categories) {
    gtag('consent', 'update', {
      'analytics_storage': _c.categories.analytics ? 'granted' : 'denied',
      'ad_storage': _c.categories.marketing ? 'granted' : 'denied',
      'ad_user_data': _c.categories.marketing ? 'granted' : 'denied',
      'ad_personalization': _c.categories.marketing ? 'granted' : 'denied'
    });
  }
} catch (e) {}
`.trim();

/** Empuja el update de Consent Mode v2 al aceptar/rechazar en el banner. */
export function updateConsentMode(analytics: boolean, marketing: boolean): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer || [];
  // gtag real hace dataLayer.push(arguments); replicamos con función normal (arguments).
  const gtag = (w.gtag || function () { (w.dataLayer as unknown[]).push(arguments); }) as (...args: unknown[]) => void;
  w.gtag = gtag;
  gtag("consent", "update", {
    analytics_storage: analytics ? "granted" : "denied",
    ad_storage: marketing ? "granted" : "denied",
    ad_user_data: marketing ? "granted" : "denied",
    ad_personalization: marketing ? "granted" : "denied",
  });
}
