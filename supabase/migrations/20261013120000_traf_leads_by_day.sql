-- Leads/día por embudo para el panel de traficker (pestaña "Leads por embudo").
-- Diagnóstico 9,99 = envíos del test (diagnostico_tests) con email real (excluye anónimos @pendiente.com).
-- Cita gratis = tokens de cita de bienvenida (diagnostico_gratis_tokens).
-- Día en hora de Madrid. Cuenta por created_at (primera captación del lead).
create or replace function traf_leads_by_day(p_since date)
returns table(embudo text, dia date, leads bigint)
language sql
stable
as $$
  select 'diagnostico_9_99'::text as embudo,
         (created_at at time zone 'Europe/Madrid')::date as dia,
         count(*)::bigint as leads
  from diagnostico_tests
  where created_at >= p_since
    and coalesce(user_email, '') not ilike '%@pendiente.com'
  group by 2
  union all
  select 'cita_gratis'::text as embudo,
         (created_at at time zone 'Europe/Madrid')::date as dia,
         count(*)::bigint as leads
  from diagnostico_gratis_tokens
  where created_at >= p_since
  group by 2;
$$;
