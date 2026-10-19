-- Facturación de bonos por embudo con RANGO DE FECHAS (calendarios en la pestaña
-- "Facturación bonos" del panel traficker). Misma lógica que traf_bonos_by_embudo
-- (bono = pago completado €90–€1200; embudo = señal de captación más antigua por email)
-- pero acotada por [p_since, p_until] en días de Madrid y agrupada por día o por mes
-- (p_gran = 'day' | 'month'). La función de 1 argumento se mantiene para el resto.
create or replace function traf_bonos_by_embudo_rango(p_since date, p_until date, p_gran text default 'month')
returns table(periodo text, embudo text, bonos bigint, revenue numeric)
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
  select to_char((p.created_at at time zone 'Europe/Madrid'), case when p_gran = 'day' then 'YYYY-MM-DD' else 'YYYY-MM' end) as periodo,
         coalesce(o.origin_funnel, 'desconocido') as embudo,
         count(*)::bigint as bonos,
         round(sum(p.amount_cents) / 100.0, 2) as revenue
  from payments p
  left join origin o on o.email = lower(p.patient_email)
  where p.created_at >= (p_since::timestamp at time zone 'Europe/Madrid')
    and p.created_at < ((p_until + 1)::timestamp at time zone 'Europe/Madrid')
    and p.status = 'completed'
    and p.amount_cents between 9000 and 120000
    and p.patient_email is not null
  group by 1, 2;
$$;
