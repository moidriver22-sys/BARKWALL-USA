-- =====================================================================
-- Barkwalk USA · Filtro de lenguaje en la base de datos (GENERADO: no editar a mano)
-- ---------------------------------------------------------------------
-- Generado por scripts/build-content-filter.js desde api/_lib/content-filter.js (la misma regla que usa
-- la app y el servidor). Así, aunque alguien llame a Supabase directamente sin pasar por la interfaz,
-- no puede guardar insultos en el chat, en las mascotas, en el pasaporte ni en su nombre.
-- Error que recibe la app: código 22023, mensaje 'content_blocked'.
-- Solo revisa los campos que CAMBIAN (los datos antiguos no bloquean otras ediciones).
-- =====================================================================
create schema if not exists private;

-- Misma construcción que termPattern() en JavaScript: cada letra "c" → "c+", separadores [._*-]* entre letras,
-- espacios → \s+, y límites de palabra salvo que el término empiece/termine con '*'.
create or replace function private.bw_content_pattern()
returns text language sql immutable parallel safe set search_path = '' as $fn$
  select string_agg('(' ||
      case when left(t, 1) = '*' then '' else '(^|[^a-z])' end ||
      (select string_agg(
                (select string_agg(ch || '+', '[._*-]*' order by o)
                   from unnest(string_to_array(w, null)) with ordinality as c(ch, o)),
                '\s+' order by wo)
         from unnest(string_to_array(trim(both '*' from t), ' ')) with ordinality as x(w, wo)) ||
      case when right(t, 1) = '*' then '' else '($|[^a-z])' end || ')', '|' order by n)
  from unnest(array['puta', 'putas', 'puto', 'putos', 'hijueputa', 'hijoputa', 'hijo de perra', 'hija de perra', 'pendej*', 'cabron*', 'chingad*', 'chingar*', 'chinga', 'chingas', 'chingues', 'verga', 'vergas', 'culero', 'culera', 'culeros', 'culeras', 'mierd*', 'pinche', 'pinches', 'joto', 'jotos', 'marica', 'maricas', 'maricon', 'maricones', 'gilipoll*', 'mamon', 'mamona', 'mamones', 'malparid*', 'gonorrea', 'idiota', 'idiotas', 'imbecil', 'imbeciles', 'estupido', 'estupida', 'estupidos', 'estupidas', 'sudaca', 'sudacas', 'mayate', '*fuck*', '*shit*', 'asshole*', 'dumbass', 'bastard', 'bastards', 'cunt', 'cunts', 'dickhead*', 'whore', 'whores', 'slut', 'sluts', 'son of a bitch', 'sonofabitch', 'motherfuck*', 'twat', 'twats', 'wanker', 'wankers', 'douchebag*', 'retard', 'retards', 'retarded', 'idiot', 'idiots', 'moron', 'morons', 'imbecile', 'faggot*', 'nigger*', 'nigga*', 'kike', 'kikes', 'chink', 'chinks', 'spic', 'spics', 'wetback*', 'beaner', 'beaners']::text[]) with ordinality as terms(t, n)
$fn$;

create or replace function private.bw_content_ok(t text)
returns boolean language sql immutable parallel safe set search_path = '' as $fn$
  select t is null or t = '' or not (
    regexp_replace(translate(lower(t), 'áàâäãéèêëíìîïóòôöõúùûüñç013457@$!', 'aaaaaeeeeiiiiooooouuuuncoieastasi'), 'shih tzu|shihtzu|shitzu|shitsu|shiitake|shiatsu', ' ', 'g')
    ~ private.bw_content_pattern()
  )
$fn$;

create or replace function private.bw_content_guard()
returns trigger language plpgsql security definer set search_path = '' as $fn$
declare
  col text;
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
begin
  if auth.role() = 'service_role' then return new; end if; -- el servidor ya valida con el mismo filtro
  foreach col in array tg_argv loop
    if (n ->> col) is distinct from (o ->> col) and not private.bw_content_ok(n ->> col) then
      raise exception 'content_blocked' using errcode = '22023', detail = col,
        hint = 'Texto con palabras no permitidas / Text contains words that are not allowed';
    end if;
  end loop;
  return new;
end $fn$;

drop trigger if exists bw_content_walk_messages on public.walk_messages;
create trigger bw_content_walk_messages before insert or update on public.walk_messages
  for each row execute function private.bw_content_guard('message');

drop trigger if exists bw_content_pets on public.pets;
create trigger bw_content_pets before insert or update on public.pets
  for each row execute function private.bw_content_guard('name', 'breed', 'notes');

drop trigger if exists bw_content_pet_passports on public.pet_passports;
create trigger bw_content_pet_passports before insert or update on public.pet_passports
  for each row execute function private.bw_content_guard('pet_name', 'breed', 'notes', 'allergies');

drop trigger if exists bw_content_profiles on public.profiles;
create trigger bw_content_profiles before insert or update on public.profiles
  for each row execute function private.bw_content_guard('full_name');

-- Verificación:
-- select private.bw_content_ok('Hola, Luna fue al parque'), private.bw_content_ok('eres un pendejo');  -- true, false
