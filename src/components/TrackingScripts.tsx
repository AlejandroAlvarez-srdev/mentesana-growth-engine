"use client";

import Script from "next/script";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { track } from "@/lib/tracking";
import { CONSENT_EVENT, readConsent, type ConsentRecord } from "@/lib/cookie-consent";
import { CONSENT_DEFAULT_JS, updateConsentMode } from "@/lib/consent-mode";
import { consentBypassed } from "@/lib/consent-bypass";

// Carga condicional de scripts de tracking según consentimiento RGPD/AEPD.
// - Hasta que el usuario decide, NO se inyecta nada (ni GTM, ni Pixel, ni TikTok, ni Clarity).
// - Si revoca, los scripts ya cargados permanecen en memoria pero dejan de recibir eventos
//   (lib/tracking.ts comprueba hasConsent antes de cada llamada). Para borrarlos del todo
//   el usuario debe limpiar cookies del navegador — así lo explica /legal/cookies.

export default function TrackingScripts() {
  const [consent, setConsent] = useState<ConsentRecord | null>(null);
  const [bypass, setBypass] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setConsent(readConsent());
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent<ConsentRecord | null>).detail;
      setConsent(detail);
    };
    window.addEventListener(CONSENT_EVENT, onChange);
    return () => window.removeEventListener(CONSENT_EVENT, onChange);
  }, []);

  // BYPASS del Consent Mode en dominios de campaña (consent-bypass.ts): en ellos el
  // tracking se carga y dispara SIN esperar el banner. Además forzamos Consent Mode
  // GRANTED para que los tags de Google también trabajen. Scoped por hostname → el
  // sitio principal NO se ve afectado.
  useEffect(() => {
    if (!consentBypassed()) return;
    setBypass(true);
    try { updateConsentMode(true, true); } catch {}
  }, []);

  // Con bypass tratamos analytics/marketing como concedidos (solo en ese dominio).
  const analytics = !!consent?.categories.analytics || bypass;
  const marketing = !!consent?.categories.marketing || bypass;

  // QA de Meta: abre cualquier página con ?meta_test=CODE (el código de "Eventos de prueba" de
  // Events Manager) y durante 1 h los eventos SERVER-SIDE (CAPI) llevan test_event_code → se ven
  // en esa pestaña junto a los del pixel del navegador, y Meta no los cuenta como reales.
  useEffect(() => {
    try {
      const code = new URLSearchParams(window.location.search).get("meta_test");
      if (code && /^[A-Za-z0-9_-]{4,40}$/.test(code)) document.cookie = `ms_meta_test=${code}; path=/; max-age=3600; SameSite=Lax`;
    } catch {}
  }, []);

  // ViewContent EN TODO LADO: además del PageView del pixel, en cada cambio de ruta de
  // una página PÚBLICA mandamos un ViewContent (pixel + CAPI vía track → view_home/
  // view_content) para que Meta registre la vista de contenido de toda la web. Solo con
  // consentimiento marketing. Se excluyen las herramientas internas (admin/agent/traficker/
  // flujos), que no son marketing.
  useEffect(() => {
    if (!marketing || !pathname) return;
    if (/^\/(admin|agent|traficker|flujos)(\/|$)/.test(pathname)) return;
    if (pathname === "/") track("view_home", { page: "home" });
    else track("view_content", { path: pathname });
  }, [pathname, marketing]);

  return (
    <>
      {/* Consent Mode v2 (Google): default DENIED para todos, ANTES de cargar GTM.
          Se ejecuta siempre; el update a granted/denied lo dispara writeConsent()
          cuando el usuario decide en el banner. Additivo: no carga tags por sí solo. */}
      <Script id="ms-consent-default" strategy="afterInteractive">
        {CONSENT_DEFAULT_JS}
      </Script>
      {analytics && (
        <Script id="gtm" strategy="lazyOnload">
          {`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','GTM-N3PMGZP');`}
        </Script>
      )}
      {analytics && (
        <Script id="ms-clarity" strategy="lazyOnload">
          {`
            (function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
            })(window, document, "clarity", "script", "unffwvwq3a");
          `}
        </Script>
      )}
      {analytics && (
        <Script id="funnelytics" strategy="afterInteractive">
          {`(function(funnel) {var deferredEvents = [];window.funnelytics = {events: {trigger: function (name, attributes, callback, opts) {deferredEvents.push({name: name, attributes: attributes, callback: callback, opts: opts});}}};var insert = document.getElementsByTagName('script')[0],script = document.createElement('script');script.addEventListener('load', function() {window.funnelytics.init(funnel, false, deferredEvents, {"anonymiseUsers":false});});script.src = 'https://cdn.funnelytics.io/track-v3.js';script.type = 'text/javascript';script.async = true;insert.parentNode.insertBefore(script, insert);})('8e25b10e-8d12-4d68-ac23-12ab8faf4fa8');`}
        </Script>
      )}
      {marketing && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', 'REDACTED_ID');
            fbq('track', 'PageView');
          `}
        </Script>
      )}
      {marketing && (
        <Script id="tiktok-pixel" strategy="lazyOnload">
          {`
            !function (w, d, t) {
              w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(
              var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script")
              ;n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};
              ttq.load('D8G65R3C77UEC9ORTSO0');
              ttq.page();
            }(window, document, 'ttq');
          `}
        </Script>
      )}
      {marketing && (
        <noscript>
          <img height="1" width="1" style={{ display: "none" }} alt=""
            src="https://www.facebook.com/tr?id=REDACTED_ID&ev=PageView&noscript=1" />
        </noscript>
      )}
      {analytics && (
        <noscript>
          <iframe src="https://www.googletagmanager.com/ns.html?id=GTM-N3PMGZP" height="0" width="0" style={{ display: "none", visibility: "hidden" }} />
        </noscript>
      )}
    </>
  );
}
