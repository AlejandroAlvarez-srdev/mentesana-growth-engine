// Mapa ÚNICO de eventos internos → eventos estándar de Meta.
// Compartido por el cliente (pixel + CAPI en src/lib/tracking.ts) y el servidor
// (/api/meta-capi). Si el pixel mapea un evento a estándar (p.ej. InitiateCheckout)
// pero el CAPI lo deja como custom, Meta NO deduplica → conversiones dobles o mal
// atribuidas. Manteniendo un solo mapa, el event_name coincide en ambos lados y la
// deduplicación por event_id funciona.
// REGLA (25-ago): InitiateCheckout SOLO lo manda quien abre de verdad la
// pasarela. Antes lo mandaban tambien `start_matching` y `test_started`, que es
// empezar un cuestionario — Meta veia 522 InitiateCheckout a la semana cuando
// reales habia ~147, y las campanas optimizaban hacia gente que empieza tests,
// no hacia gente que paga. Si anades un evento aqui, comprueba que nadie mas
// mapea al mismo estandar en otro punto del embudo.
export const META_STANDARD: Record<string, string> = {
  test_started: "ViewContent",
  test_completed: "CompleteRegistration",
  match_viewed: "ViewContent",
  payment_started: "InitiateCheckout",
  payment_completed: "Purchase",
  contact_submitted: "Contact",
  newsletter_subscribed: "Subscribe",
  cta_click_buy: "AddToCart",
  page_view: "PageView",
  // Embudo de diagnóstico
  view_landing_diagnostico: "ViewContent",
  view_home: "ViewContent", // home (/) — vista de producto para Meta (además del PageView)
  click_cta_empezar: "AddToCart",
  start_matching: "ViewContent",
  // OJO: Lead y Schedule del embudo 9,99 se disparan SERVER-SIDE (CAPI), NO aquí:
  //   Lead     → src/app/api/diagnostico-test/route.ts cuando llega el email (sendCAPILead)
  //   Schedule → src/lib/amelia-create-booking.ts al crear la cita       (sendCAPISchedule)
  // El pixel client-side solo carga con consentimiento marketing (TrackingScripts) y con
  // Consent Mode default-denied + ITP se perdía >50% de los Lead/Schedule. El server no
  // depende del navegador (matchea por email/fbc/fbp) → llegan a Meta "por todo lado".
  // view_email_gate/select_slot se quedan como CUSTOM (siguen en analytics_events y en el
  // dataLayer para medir el embudo), pero NO mapean a estándar → así no hay doble conteo.
  view_match_result: "ViewContent",
  initiate_checkout: "InitiateCheckout",
  purchase: "Purchase",
  upsell_bono_purchased: "Purchase",
  // Campaña Eva (influencer → diagnóstico)
  view_landing_eva: "ViewContent",
  click_cta_eva: "AddToCart",
  // Super embudo Llamada Inmediata (serviceId 300 · registro → app). El registro
  // deja el correo y crea la cuenta: ese es el Lead (misma lógica que view_email_gate).
  view_landing_llamada_inmediata: "ViewContent",
  view_landing_llamada_gratis: "ViewContent",
  llamada_inmediata_registro: "Lead",
};
