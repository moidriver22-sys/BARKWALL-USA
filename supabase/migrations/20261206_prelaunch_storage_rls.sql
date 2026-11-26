-- Auditoría de seguridad previa al lanzamiento (2026-11-26).
-- Todas las tablas de public ya tienen RLS y ninguna es accesible para anon; esto cierra lo que quedaba.

-- 1) walk-photos: la política "Public Access" (rol public) dejaba a cualquiera, incluso sin sesión,
--    LISTAR todas las fotos de todos los paseos (y así enumerar IDs de paseos).
--    El bucket sigue siendo público, así que las URLs públicas que ya usa la app (getPublicUrl) siguen
--    funcionando: /object/public no pasa por RLS. Solo se quita el listado/lectura vía API.
drop policy if exists "Public Access" on storage.objects;
drop policy if exists "walk-photos: participants or admin read" on storage.objects;
create policy "walk-photos: participants or admin read" on storage.objects
  for select to authenticated
  using (bucket_id = 'walk-photos'
         and (public.bw_is_walk_participant((storage.foldername(name))[1]) or public.bw_is_admin()));

--    Límite de tamaño y tipos (no tenía ninguno; la app sube JPEG de ≤1600 px tras el sello de agua).
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
 where id = 'walk-photos';

-- 2) pets: el UPDATE del dueño no tenía WITH CHECK, así que podía reasignar su mascota a otro owner_id.
alter policy "Owners update own pets" on public.pets
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

-- 3) protect_stripe_account_id(): función antigua que ningún trigger usa (bw_profiles_guard la sustituyó).
--    Se le quita el EXECUTE público para que no aparezca en /rpc.
revoke execute on function public.protect_stripe_account_id() from public, anon, authenticated;

-- Pendiente fuera de SQL: activar "Leaked password protection" en el panel de Supabase
-- (Authentication → Policies/Password security). pg_net en public no es movible (no relocatable).
