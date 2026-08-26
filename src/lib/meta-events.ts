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
  click_cta_empezar: "AddToCart",
  start_matching: "ViewContent",
  // El momento con mas senal antes del pago: deja el correo. Es el Lead.
  view_email_gate: "Lead",
  view_match_result: "ViewContent",
  select_slot: "Schedule",
  initiate_checkout: "InitiateCheckout",
  purchase: "Purchase",
  upsell_bono_purchased: "Purchase",
  // Campaña Eva (influencer → diagnóstico)
  view_landing_eva: "ViewContent",
  click_cta_eva: "AddToCart",
  // Super embudo Llamada Inmediata (serviceId 300 · registro → app). El registro
  // deja el correo y crea la cuenta: ese es el Lead (misma lógica que view_email_gate).
  view_landing_llamada_inmediata: "ViewContent",
  llamada_inmediata_registro: "Lead",
};
