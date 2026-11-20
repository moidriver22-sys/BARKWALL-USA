-- =====================================================================
-- Barkwalk USA · Notificaciones push (Web Push / VAPID)
-- ---------------------------------------------------------------------
-- public.push_subscriptions: una fila por dispositivo/navegador (endpoint único) asociada al usuario.
--   · El navegador la registra con bw_register_push() al activar las notificaciones (obligatorio para usar la app).
--     Si otra cuenta inicia sesión en el MISMO dispositivo, el endpoint pasa a esa cuenta (no recibe avisos ajenos).
--   · Al cerrar sesión, bw_unregister_push() la borra.
--   · El servidor (/api/dispatch, service_role) la lee para enviar los avisos y borra las suscripciones caducadas.
-- Solo AÑADE objetos; no toca datos existentes. Se puede ejecutar más de una vez.
-- =====================================================================
create table if not exists public.push_subscriptions (
  id           bigserial primary key,
  user_id      uuid        not null references auth.users (id) on delete cascade,
  endpoint     text        not null unique,
  p256dh       text        not null,
  auth         text        not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  fail_count   int         not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
drop policy if exists "push_subscriptions: owner reads" on public.push_subscriptions;
create policy "push_subscriptions: owner reads" on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());

-- Alta / refresco de la suscripción del dispositivo actual (la escritura solo pasa por aquí)
create or replace function public.bw_register_push(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'invalid_subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
     set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent, last_seen_at = now(), fail_count = 0;
end $$;

create or replace function public.bw_unregister_push(p_endpoint text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

revoke all on function public.bw_register_push(text, text, text, text) from public, anon;
revoke all on function public.bw_unregister_push(text) from public, anon;
grant execute on function public.bw_register_push(text, text, text, text) to authenticated;
grant execute on function public.bw_unregister_push(text) to authenticated;

-- Verificación:
-- select count(*) from public.push_subscriptions;
-- select proname from pg_proc where proname in ('bw_register_push', 'bw_unregister_push');
