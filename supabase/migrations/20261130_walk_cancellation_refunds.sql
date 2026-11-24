-- =====================================================================
-- Barkwalk USA · Migración 2026-11-24 · Reembolsos por cancelación de días de paseo
--   · public.walk_cancellations: una fila por día PAGADO que se cancela (quién, si ya había paseador,
--     cuántas horas faltaban, decisión y reembolso). Montos SOLO aquí: walk_requests no lleva precios del cliente.
--   · Trigger en walk_requests → anota la cancelación y llama al instante a /api/dispatch?action=cancellations
--     (pg_net, después del commit). El cron de 10 min ('barkwalk-dispatch') hace de respaldo.
--   · Lógica de reembolso: api/_lib/cancellations.js (100 % automático / 50 % y especiales → aviso al equipo).
-- =====================================================================
begin;

create table if not exists public.walk_cancellations (
  walk_id          uuid primary key references public.walk_requests(id) on delete cascade,
  booking_id       uuid not null references public.bookings(id) on delete cascade,
  client_id        uuid not null,
  cancelled_at     timestamptz not null default now(),
  cancelled_by     text not null check (cancelled_by in ('client', 'walker', 'admin', 'system')),
  walker_assigned  boolean not null default false,
  prev_status      text,
  hours_before     numeric,
  status           text not null default 'pending'
                   check (status in ('pending', 'refunding', 'refunded', 'needs_review', 'refunded_manual', 'skipped')),
  decision         text,
  refund_cents     int check (refund_cents is null or refund_cents >= 0),
  suggested_cents  int check (suggested_cents is null or suggested_cents >= 0),
  stripe_refund_id text,
  error            text,
  processed_at     timestamptz,
  notified_at      timestamptz
);
create index if not exists walk_cancellations_pending_idx on public.walk_cancellations (cancelled_at) where status = 'pending';
create index if not exists walk_cancellations_booking_idx on public.walk_cancellations (booking_id);

alter table public.walk_cancellations enable row level security;
revoke all on public.walk_cancellations from anon;
revoke insert, update, delete, truncate on public.walk_cancellations from authenticated;
grant select on public.walk_cancellations to authenticated;
drop policy if exists "walk_cancellations: client reads own" on public.walk_cancellations;
create policy "walk_cancellations: client reads own" on public.walk_cancellations
  for select to authenticated using (client_id = auth.uid());
drop policy if exists "walk_cancellations: admin reads" on public.walk_cancellations;
create policy "walk_cancellations: admin reads" on public.walk_cancellations
  for select to authenticated using (public.bw_is_admin());

-- Anota la cancelación de un día pagado. auth.uid() identifica quién la hizo:
--   cliente dueño → 'client' · paseador asignado → 'walker' · admin → 'admin'
--   sin sesión (servidor: reembolso total o disputa, que ya cancelan con su propia lógica) → 'system'
create or replace function private.bw_walk_cancel_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_by  text;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled'
     and new.payment_status = 'paid' and new.booking_id is not null then
    v_by := case
      when v_uid is null then 'system'
      when v_uid = old.client_id then 'client'
      when old.walker_id is not null and v_uid = old.walker_id then 'walker'
      when public.bw_is_admin() then 'admin'
      else 'system' end;
    insert into public.walk_cancellations (walk_id, booking_id, client_id, cancelled_by, walker_assigned, prev_status, hours_before)
    values (new.id, new.booking_id, new.client_id, v_by, old.walker_id is not null, coalesce(old.status, 'pending'),
            case when new.scheduled_at is null then null
                 else round((extract(epoch from (new.scheduled_at - now())) / 3600.0)::numeric, 2) end)
    on conflict (walk_id) do nothing;

    -- Procesar al instante (pg_net envía después del commit). Si falla, el cron de 10 min lo recoge.
    if v_by <> 'system' then
      begin
        perform net.http_post(
          url := 'https://www.barkwalkusa.com/api/dispatch?action=cancellations',
          headers := jsonb_build_object('Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'barkwalk_cron_secret')),
          body := '{}'::jsonb, timeout_milliseconds := 30000);
      exception when others then null; -- nunca bloquea la cancelación
      end;
    end if;
  end if;
  return new;
end $$;
revoke all on function private.bw_walk_cancel_log() from public, anon, authenticated;

drop trigger if exists bw_walk_requests_cancel_log on public.walk_requests;
create trigger bw_walk_requests_cancel_log
  after update of status on public.walk_requests
  for each row execute function private.bw_walk_cancel_log();

commit;
