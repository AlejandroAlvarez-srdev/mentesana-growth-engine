"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CONSENT_EVENT, readConsent, writeConsent } from "@/lib/cookie-consent";

// Banner de consentimiento conforme a la Guía AEPD de Cookies (julio 2023):
// - Acción "Rechazar todas" con la misma prominencia que "Aceptar todas".
// - Sin pre-marcas; granularidad por finalidad.
// - Hasta decisión, no se carga ningún script de analítica/marketing.
// Se puede reabrir desde el footer o desde /legal/cookies con el evento "ms:open-cookie-prefs".

const OPEN_PREFS_EVENT = "ms:open-cookie-prefs";

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    const existing = readConsent();
    if (!existing) {
      setVisible(true);
    } else {
      setAnalytics(existing.categories.analytics);
      setMarketing(existing.categories.marketing);
    }
    const onOpen = () => {
      const c = readConsent();
      if (c) {
        setAnalytics(c.categories.analytics);
        setMarketing(c.categories.marketing);
      }
      setShowPanel(true);
      setVisible(true);
    };
    window.addEventListener(OPEN_PREFS_EVENT, onOpen);
    window.addEventListener(CONSENT_EVENT, () => {});
    return () => window.removeEventListener(OPEN_PREFS_EVENT, onOpen);
  }, []);

  const acceptAll = () => {
    writeConsent({ analytics: true, marketing: true });
    setVisible(false);
    setShowPanel(false);
  };
  const rejectAll = () => {
    writeConsent({ analytics: false, marketing: false });
    setVisible(false);
    setShowPanel(false);
  };
  const saveCustom = () => {
    writeConsent({ analytics, marketing });
    setVisible(false);
    setShowPanel(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cookie-consent-title"
      className="fixed inset-x-0 bottom-0 z-[9999] p-3 sm:p-4"
    >
      <div className="mx-auto max-w-3xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden">
        {!showPanel ? (
          <div className="p-5 sm:p-6">
            <h2 id="cookie-consent-title" className="text-base sm:text-lg font-semibold text-gray-900">
              Tu privacidad importa
            </h2>
            <p className="mt-2 text-sm text-gray-600 leading-relaxed">
              Usamos cookies propias y de terceros para mantener el sitio operativo, medir el uso de forma anónima y, si lo
              autorizas, mostrarte publicidad personalizada. Puedes aceptar todas, rechazarlas o elegir por categoría. Más
              información en nuestra{" "}
              <Link href="/legal/cookies" className="underline text-[#6A178C]">política de cookies</Link>{" "}
              y{" "}
              <Link href="/legal/privacidad" className="underline text-[#6A178C]">política de privacidad</Link>.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <button
                onClick={acceptAll}
                className="flex-1 rounded-full bg-[#6A178C] text-white text-sm font-semibold py-2.5 px-4 hover:bg-[#581174] transition-colors"
              >
                Aceptar todas
              </button>
              <button
                onClick={rejectAll}
                className="flex-1 rounded-full bg-gray-100 text-gray-900 text-sm font-semibold py-2.5 px-4 hover:bg-gray-200 transition-colors"
              >
                Rechazar todas
              </button>
              <button
                onClick={() => setShowPanel(true)}
                className="flex-1 rounded-full bg-white text-[#6A178C] text-sm font-semibold py-2.5 px-4 ring-1 ring-[#6A178C]/30 hover:bg-[#6A178C]/5 transition-colors"
              >
                Configurar
              </button>
            </div>
          </div>
        ) : (
          <div className="p-5 sm:p-6 max-h-[80vh] overflow-y-auto">
            <h2 id="cookie-consent-title" className="text-base sm:text-lg font-semibold text-gray-900">
              Preferencias de cookies
            </h2>
            <p className="mt-1 text-xs text-gray-500">
              Marca solo las categorías que quieras autorizar. Tu elección se guarda en este dispositivo.
            </p>

            <div className="mt-4 space-y-3">
              <Category
                title="Estrictamente necesarias"
                description="Garantizan el funcionamiento básico (sesión, seguridad, carrito, idioma). No se pueden desactivar."
                checked={true}
                disabled={true}
                onChange={() => {}}
              />
              <Category
                title="Analíticas"
                description="Nos ayudan a entender cómo se usa la web (Google Tag Manager, Microsoft Clarity). Datos agregados, no identifican personalmente."
                checked={analytics}
                onChange={setAnalytics}
              />
              <Category
                title="Marketing y publicidad"
                description="Permiten medir y personalizar campañas en Meta (Facebook/Instagram) y TikTok. Implican transferencia a EE. UU. (DPF)."
                checked={marketing}
                onChange={setMarketing}
              />
            </div>

            <div className="mt-5 flex flex-col sm:flex-row gap-2">
              <button
                onClick={saveCustom}
                className="flex-1 rounded-full bg-[#6A178C] text-white text-sm font-semibold py-2.5 px-4 hover:bg-[#581174] transition-colors"
              >
                Guardar mis preferencias
              </button>
              <button
                onClick={acceptAll}
                className="flex-1 rounded-full bg-gray-100 text-gray-900 text-sm font-semibold py-2.5 px-4 hover:bg-gray-200 transition-colors"
              >
                Aceptar todas
              </button>
              <button
                onClick={rejectAll}
                className="flex-1 rounded-full bg-white text-gray-700 text-sm font-semibold py-2.5 px-4 ring-1 ring-gray-300 hover:bg-gray-50 transition-colors"
              >
                Rechazar todas
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Category({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`flex items-start gap-3 p-3 rounded-xl ring-1 ring-gray-200 ${disabled ? "bg-gray-50" : "bg-white hover:bg-gray-50 cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4 rounded border-gray-300 accent-[#6A178C]"
      />
      <span className="flex-1">
        <span className="block text-sm font-semibold text-gray-900">{title}</span>
        <span className="block text-xs text-gray-600 leading-relaxed mt-0.5">{description}</span>
      </span>
    </label>
  );
}

export function openCookiePreferences() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OPEN_PREFS_EVENT));
  }
}
