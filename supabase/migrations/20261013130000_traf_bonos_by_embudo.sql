-- Facturación de bonos por mes y embudo de ORIGEN del cliente (panel traficker,
-- pestaña "Facturación bonos"). El origen se deriva EN VIVO de las señales de
-- captación (sin tabla que mantener), así la atribución es siempre correcta para
-- histórico y nuevas ventas:
--   diagnóstico 9,99 = primer pago 9,99 o primer envío del test (lo más antiguo)
--   cita gratis      = primer token de cita de bienvenida
--   gana la señal MÁS ANTIGUA por email; sin señal -> 'desconocido'.
-- Bono = pago de terapia €90–€1200 (independiente del campo 'producto', que está
-- incompleto desde ~sep-2026 y tiene outliers).
create or replace function traf_bonos_by_embudo(p_since date)
returns table(mes text, embudo text, bonos bigint, revenue numeric)
language sql
stable
as $$
  with origin as (
    select email, origin_funnel
    from (
      select email, origin_funnel,
             row_number() over (partition by email order by origin_at asc nulls last) as rn
      from (
        select lower(patient_email) as email, 'diagnostico_9_99'::text as origin_funnel, min(created_at) as origin_at
        from payments
        where amount_cents between 900 and 1050 and status = 'completed' and patient_email is not null and patient_email <> ''
        group by 1
        union all
        select lower(user_email), 'diagnostico_9_99', min(created_at)
        from diagnostico_tests
        where user_email is not null and user_email not ilike '%@pendiente.com'
        group by 1
        union all
        select lower(email), 'cita_gratis', min(created_at)
        from diagnostico_gratis_tokens
        where email is not null and email <> ''
        group by 1
      ) s
    ) r
    where rn = 1
  )
  select to_char((p.created_at at time zone 'Europe/Madrid'), 'YYYY-MM') as mes,
         coalesce(o.origin_funnel, 'desconocido') as embudo,
         count(*)::bigint as bonos,
         round(sum(p.amount_cents) / 100.0, 2) as revenue
  from payments p
  left join origin o on o.email = lower(p.patient_email)
  where p.created_at >= p_since
    and p.status = 'completed'
    and p.amount_cents between 9000 and 120000
    and p.patient_email is not null
  group by 1, 2;
$$;
