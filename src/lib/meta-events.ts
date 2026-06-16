// Mapa ÚNICO de eventos internos → eventos estándar de Meta.
// Compartido por el cliente (pixel + CAPI en src/lib/tracking.ts) y el servidor
// (/api/meta-capi). Si el pixel mapea un evento a estándar (p.ej. InitiateCheckout)
// pero el CAPI lo deja como custom, Meta NO deduplica → conversiones dobles o mal
// atribuidas. Manteniendo un solo mapa, el event_name coincide en ambos lados y la
// deduplicación por event_id funciona.
export const META_STANDARD: Record<string, string> = {
  test_started: "InitiateCheckout",
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
  start_matching: "InitiateCheckout",
  view_match_result: "ViewContent",
  select_slot: "Schedule",
  initiate_checkout: "InitiateCheckout",
  purchase: "Purchase",
  upsell_bono_purchased: "Purchase",
  // Campaña Eva (influencer → diagnóstico)
  view_landing_eva: "ViewContent",
  click_cta_eva: "AddToCart",
};
