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
  view_content: "ViewContent", // cualquier página pública (route change) → ViewContent en todo lado
  click_cta_empezar: "AddToCart",
  start_matching: "ViewContent",
  // Lead del embudo 9,99 = la persona DEJA EL EMAIL en el gate. Sale por DOS vías con el
  // MISMO event_id (lead_<sha256(email)[:24]>) y Meta deduplica:
  //   - servidor: src/app/api/diagnostico-test/route.ts (sendCAPILead) → no depende del
  //     navegador (ITP/consentimiento), matchea por email/fbc/fbp.
  //   - navegador: start_matching_analysis (se dispara justo después de guardar el email,
  //     lleva props.email → lib/tracking calcula el mismo event_id). Así el Lead se ve al
  //     instante en "Eventos de prueba" de Events Manager y en el pixel del navegador.
  //   Schedule → src/lib/amelia-create-booking.ts al crear la cita (sendCAPISchedule).
  // view_email_gate/select_slot se quedan como CUSTOM (siguen en analytics_events y en el
  // dataLayer para medir el embudo), pero NO mapean a estándar → así no hay doble conteo.
  start_matching_analysis: "Lead",
  // Este dataset está en categoría SALUD y Meta SUPRIME en el navegador Lead/Schedule/Purchase/
  // InitiateCheckout/CompleteRegistration ("restricted event") hasta que se cambie la restricción
  // en Events Manager. "Contact" SÍ pasa: al dejar el email disparamos también email_capturado →
  // Contact (lib/tracking lo emite justo después del Lead, con id determinista contact_<hash>) para
  // tener un evento estándar optimizable YA. Cuando Meta desbloquee Lead, ambos siguen saliendo.
  email_capturado: "Contact",
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
