-- =====================================================================
-- Barkwalk USA · El paseador solo ve SU ganancia, nunca lo que pagó el cliente (aplicado el 2026-11-23)
-- ---------------------------------------------------------------------
-- Problema: walk_requests.total_price guardaba el precio por día que pagó el cliente. Los paseadores
-- verificados leen walk_requests (solicitudes abiertas y sus paseos, también por Realtime), y RLS no puede
-- ocultar una sola columna según el rol → el paseador recibía el precio bruto del cliente.
-- Solución (en los DATOS, no solo en la pantalla):
--   1. walk_requests ya no guarda el precio del cliente: total_price (y el antiguo walker_payout_amount)
--      quedan SIEMPRE en NULL (trigger), incluso si algún código antiguo intenta escribirlos.
--   2. Nuevas columnas con la ganancia NETA del paseador, calculadas en el servidor (api/_lib/earnings.js):
--        walker_earning_std_cents  → con el porcentaje estándar (WALKER_PAYOUT_PERCENT, 75 %)
--        walker_earning_pro_cents  → con el porcentaje Walker Pro (WALKER_PRO_PAYOUT_PERCENT, 80 %)
--      La app muestra la que corresponde (walker_is_pro, que la base fija al aceptar). Al pagar, el monto
--      exacto transferido queda en walker_payout_cents.
--   3. El precio del cliente sigue en public.bookings (per_day_cents / total_cents): solo lo leen el dueño
--      de la reserva y los administradores (RLS), nunca un paseador.
-- Las columnas nuevas no las puede cambiar nadie desde la app (trigger bw_walk_requests_guard: el paseador
-- solo toca estado/ubicación/foto y el cliente solo 'status').
-- =====================================================================
alter table public.walk_requests alter column total_price drop not null; -- era NOT NULL: ahora siempre vacía

alter table public.walk_requests add column if not exists walker_earning_std_cents integer;
alter table public.walk_requests add column if not exists walker_earning_pro_cents integer;

do $$ begin
  alter table public.walk_requests add constraint walk_requests_walker_earning_nonneg
    check (coalesce(walker_earning_std_cents, 0) >= 0 and coalesce(walker_earning_pro_cents, 0) >= 0);
exception when duplicate_object then null; end $$;

create or replace function private.bw_walk_requests_no_client_price()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.total_price := null;          -- precio del cliente: vive en bookings, nunca aquí
  new.walker_payout_amount := null; -- columna antigua, sustituida por walker_payout_cents
  return new;
end $$;

drop trigger if exists bw_walk_requests_no_client_price on public.walk_requests;
create trigger bw_walk_requests_no_client_price before insert or update on public.walk_requests
  for each row execute function private.bw_walk_requests_no_client_price();

-- Datos ya guardados: se borra el precio del cliente de walk_requests (el de las reservas sigue en bookings)
update public.walk_requests set total_price = null, walker_payout_amount = null
 where total_price is not null or walker_payout_amount is not null;

-- Después de desplegar: GET /api/dispatch?action=backfill_earnings (CRON_SECRET) rellena la ganancia de los
-- días creados antes de esta versión.
-- Verificación:
-- select count(*) filter (where total_price is not null) as con_precio_cliente from public.walk_requests;  -- 0
