-- Fecha de nacimiento OPCIONAL de la mascota (formulario "Mis mascotas", selector Mes / Día / Año)
-- ---------------------------------------------------------------------------
-- · pets.birth_date (date, null = no la conocen: p. ej. perros adoptados; siguen escribiendo la edad a mano).
-- · Si hay fecha: no puede ser futura ni de hace más de 30 años (el mismo tope que la edad 0–30), y la base
--   calcula pets.age (años cumplidos, hora de Birmingham) en cada escritura, así todo lo que ya lee "age"
--   (pasaporte, paseador, asesor) sigue funcionando. La app además la recalcula al mostrarla (siempre al día).
-- · No cambia RLS ni permisos: authenticated tiene INSERT/SELECT/UPDATE a nivel de tabla en pets.
-- ---------------------------------------------------------------------------

alter table public.pets add column if not exists birth_date date;

create or replace function private.bw_pets_birth_date()
returns trigger
language plpgsql
set search_path = ''
as $$
declare hoy date := (now() at time zone 'America/Chicago')::date;
begin
  if new.birth_date is null then return new; end if;
  if new.birth_date > hoy then
    raise exception 'pets: la fecha de nacimiento no puede ser futura' using errcode = '23514';
  end if;
  if new.birth_date < (hoy - interval '30 years')::date then
    raise exception 'pets: la fecha de nacimiento no puede ser de hace más de 30 años' using errcode = '23514';
  end if;
  new.age := extract(year from age(hoy, new.birth_date))::int::text;
  return new;
end $$;

revoke execute on function private.bw_pets_birth_date() from public, anon, authenticated;

drop trigger if exists bw_pets_birth_date on public.pets;
create trigger bw_pets_birth_date
  before insert or update of birth_date, age on public.pets
  for each row execute function private.bw_pets_birth_date();
