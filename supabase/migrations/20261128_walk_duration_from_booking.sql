-- =====================================================================
-- Barkwalk USA · La duración del paseo SIEMPRE es la que se pagó en la reserva (aplicado el 2026-11-23)
-- ---------------------------------------------------------------------
-- Caso investigado: un paseo de prueba de "$16" mostraba 5 minutos a mitad del viaje. Ese paseo no venía de una
-- reserva pagada: se insertó a mano en walk_requests (sin booking_id, payment_status 'pending') con
-- duration = '5 min' mientras el precio decía otra cosa ($16 = Paseo Estándar 15 min). La pantalla del paseo,
-- el mínimo para completar (80 %: 12 min para 15) y las alertas leen walk_requests.duration, así que mostraron
-- exactamente lo que estaba guardado.
-- Raíz: nada obligaba a que walk_requests.duration coincidiera con lo contratado. El webhook la sacaba del
-- TEXTO de la etiqueta del servicio, y un admin / SQL / código antiguo podía escribir cualquier valor.
-- Corrección:
--   1. bookings.duration_label / duration_minutes: la duración CONTRATADA, del catálogo del servidor
--      (api/_lib/pricing.js) al crear el cobro (/api/create-payment-intent).
--   2. Trigger: en todo paseo con reserva, walk_requests.duration se fija desde su reserva al crearlo y si
--      alguien intenta cambiarla. No hay forma de que un paseo pagado muestre otra duración.
-- =====================================================================
alter table public.bookings add column if not exists duration_label text;
alter table public.bookings add column if not exists duration_minutes integer;

-- Reservas anteriores: la duración es la última parte de la etiqueta ("🚶 Paseo Estándar · 15 min" → "15 min")
update public.bookings
   set duration_label = nullif(trim(regexp_replace(service_label, '^.*·', '')), '')
 where duration_label is null and service_label like '%·%';

create or replace function private.bw_walk_duration_from_booking()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if new.booking_id is null then return new; end if;
  select coalesce(b.duration_label, nullif(trim(regexp_replace(b.service_label, '^.*·', '')), ''))
    into v from public.bookings b where b.id = new.booking_id;
  if v is not null then new.duration := v; end if;
  return new;
end $$;

drop trigger if exists bw_walk_requests_sync_duration on public.walk_requests;
create trigger bw_walk_requests_sync_duration before insert or update of duration, booking_id on public.walk_requests
  for each row execute function private.bw_walk_duration_from_booking();

-- Paseos ya creados con reserva: se alinean con su reserva
update public.walk_requests w set duration = b.duration_label
  from public.bookings b
 where w.booking_id = b.id and b.duration_label is not null and w.duration is distinct from b.duration_label;

-- Verificación:
-- select w.id, w.duration, b.duration_label from public.walk_requests w join public.bookings b on b.id = w.booking_id
--  where w.duration is distinct from b.duration_label;   -- vacío
