-- migracion.sql
-- Todo lo necesario para el QR de archivos de utils.
-- Corré este archivo completo en el SQL Editor de Supabase.
-- La service_role no va en este archivo ni en el repo.

-- ---------------------------------------------------------------------------
-- Esquema privado
-- No está expuesto por la API. Ahí vive la service_role que usa solo el cron.
-- ---------------------------------------------------------------------------

create schema if not exists utils_interno;

revoke all on schema utils_interno from public;
revoke all on schema utils_interno from anon, authenticated;

create table if not exists utils_interno.secreto (
  clave text primary key,
  valor text not null
);

revoke all on utils_interno.secreto from public;
revoke all on utils_interno.secreto from anon, authenticated;

comment on table utils_interno.secreto is
  'Secretos de utils. No tiene políticas para la API. Lo lee solo limpiar_utils_archivos.';

-- Pegá esto una sola vez en el SQL Editor, con tus datos, y no lo guardes en git:
-- insert into utils_interno.secreto (clave, valor) values
--   ('supabase_url', 'https://TU-PROYECTO.supabase.co'),
--   ('service_role', 'TU_SERVICE_ROLE')
-- on conflict (clave) do update set valor = excluded.valor;

-- ---------------------------------------------------------------------------
-- Tabla de archivos
-- El binario no se guarda acá. Acá está la ficha y la fecha de vencimiento.
-- namespace = 'utils' identifica todo lo de esta app para poder borrarlo junto.
-- ---------------------------------------------------------------------------

create table if not exists public.utils_archivos (
  id uuid primary key,
  namespace text not null default 'utils',
  nombre text not null,
  content_type text,
  bytes bigint not null,
  storage_path text not null unique,
  dias integer not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint utils_archivos_bytes_ok check (bytes > 0 and bytes <= 52428800),
  constraint utils_archivos_dias_ok check (dias between 1 and 90),
  constraint utils_archivos_namespace_ok check (namespace = 'utils')
);

create index if not exists utils_archivos_expires_at_idx
  on public.utils_archivos (expires_at);

create index if not exists utils_archivos_namespace_idx
  on public.utils_archivos (namespace);

comment on table public.utils_archivos is
  'Fichas de archivos subidos para un QR. El archivo está en el bucket utils-files.';

alter table public.utils_archivos enable row level security;

-- Sin políticas: anon y authenticated no pueden listar, leer, insertar ni borrar filas.
-- El alta y la lectura de un solo id pasan por las funciones de abajo.

-- ---------------------------------------------------------------------------
-- Alta de una ficha
-- El navegador manda el uuid. La ruta queda fija: utils/<uuid>/<nombre>.
-- ---------------------------------------------------------------------------

create or replace function public.crear_archivo(
  p_id uuid,
  p_nombre text,
  p_content_type text,
  p_bytes bigint,
  p_dias integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nombre text;
  v_path text;
  v_expira timestamptz;
begin
  if p_id is null then
    raise exception 'falta id';
  end if;
  if p_dias is null or p_dias < 1 or p_dias > 90 then
    raise exception 'dias fuera de rango';
  end if;
  if p_bytes is null or p_bytes <= 0 or p_bytes > 52428800 then
    raise exception 'peso fuera de rango';
  end if;

  v_nombre := regexp_replace(coalesce(p_nombre, ''), '[^A-Za-z0-9._-]+', '-', 'g');
  v_nombre := trim(both '-' from v_nombre);
  v_nombre := left(v_nombre, 120);
  if v_nombre = '' then
    v_nombre := 'archivo';
  end if;

  v_path := 'utils/' || p_id::text || '/' || v_nombre;
  v_expira := now() + make_interval(days => p_dias);

  insert into public.utils_archivos (
    id, namespace, nombre, content_type, bytes, storage_path, dias, expires_at
  ) values (
    p_id,
    'utils',
    v_nombre,
    nullif(btrim(coalesce(p_content_type, '')), ''),
    p_bytes,
    v_path,
    p_dias,
    v_expira
  );

  return jsonb_build_object(
    'id', p_id,
    'nombre', v_nombre,
    'storage_path', v_path,
    'expires_at', v_expira
  );
end;
$$;

revoke all on function public.crear_archivo(uuid, text, text, bigint, integer) from public;
grant execute on function public.crear_archivo(uuid, text, text, bigint, integer) to anon, authenticated;

-- Si la subida al bucket falla, el navegador anula la ficha creada hace menos de una hora.
-- No borra objetos del bucket: en ese caso el objeto todavía no existe.

create or replace function public.anular_archivo(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.utils_archivos
  where id = p_id
    and namespace = 'utils'
    and created_at > now() - interval '1 hour';
end;
$$;

revoke all on function public.anular_archivo(uuid) from public;
grant execute on function public.anular_archivo(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Lectura de un solo archivo
-- No devuelve nada si el id no existe o si ya venció.
-- No hay forma de pedir la lista.
-- ---------------------------------------------------------------------------

create or replace function public.obtener_archivo(p_id uuid)
returns table (
  id uuid,
  nombre text,
  content_type text,
  storage_path text,
  expires_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select a.id, a.nombre, a.content_type, a.storage_path, a.expires_at
  from public.utils_archivos a
  where a.id = p_id
    and a.namespace = 'utils'
    and a.expires_at > now();
$$;

revoke all on function public.obtener_archivo(uuid) from public;
grant execute on function public.obtener_archivo(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Bucket
-- Público para que el link abra el archivo. El nombre lleva un uuid, no se adivina.
-- La subida anónima solo entra en utils/<uuid>/<archivo>.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('utils-files', 'utils-files', true, 52428800)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

-- Sin policy de lectura: el bucket público se abre por la URL exacta
-- y nadie puede listar los nombres. Una policy SELECT amplia permitiría listar.
drop policy if exists "utils_files_leer" on storage.objects;

drop policy if exists "utils_files_subir" on storage.objects;
create policy "utils_files_subir"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'utils-files'
  and name ~ '^utils/[0-9a-fA-F-]{36}/[^/]+$'
);

-- ---------------------------------------------------------------------------
-- Limpieza
-- Borra en Storage con la API y, si eso respondió bien, borra las filas.
-- También borra objetos del bucket sin ficha y con más de 90 días.
-- Si faltan los secretos, no toca nada y avisa.
-- ---------------------------------------------------------------------------

create extension if not exists http with schema extensions;

create or replace function public.limpiar_utils_archivos()
returns void
language plpgsql
security definer
set search_path = public, extensions, utils_interno
as $$
declare
  v_url text;
  v_key text;
  v_paths text[];
  v_chunk text[];
  v_status integer;
  v_total integer;
  v_from integer;
begin
  select valor into v_url from utils_interno.secreto where clave = 'supabase_url';
  select valor into v_key from utils_interno.secreto where clave = 'service_role';

  if coalesce(v_url, '') = '' or coalesce(v_key, '') = '' then
    raise exception 'Falta supabase_url o service_role en utils_interno.secreto';
  end if;

  v_url := rtrim(v_url, '/');

  select coalesce(array_agg(storage_path), '{}')
  into v_paths
  from public.utils_archivos
  where expires_at <= now();

  v_total := coalesce(array_length(v_paths, 1), 0);
  v_from := 1;
  while v_from <= v_total loop
    v_chunk := v_paths[v_from:least(v_from + 99, v_total)];
    select status into v_status
    from extensions.http((
      'DELETE',
      v_url || '/storage/v1/object/utils-files',
      array[
        extensions.http_header('authorization', 'Bearer ' || v_key),
        extensions.http_header('apikey', v_key),
        extensions.http_header('content-type', 'application/json')
      ],
      'application/json',
      json_build_object('prefixes', v_chunk)::text
    )::extensions.http_request);

    if v_status < 200 or v_status >= 300 then
      raise exception 'Storage respondió % al borrar vencidos', v_status;
    end if;
    v_from := v_from + 100;
  end loop;

  delete from public.utils_archivos
  where expires_at <= now();

  select coalesce(array_agg(o.name), '{}')
  into v_paths
  from storage.objects o
  where o.bucket_id = 'utils-files'
    and o.created_at < now() - interval '90 days'
    and not exists (
      select 1
      from public.utils_archivos a
      where a.storage_path = o.name
    );

  v_total := coalesce(array_length(v_paths, 1), 0);
  v_from := 1;
  while v_from <= v_total loop
    v_chunk := v_paths[v_from:least(v_from + 99, v_total)];
    select status into v_status
    from extensions.http((
      'DELETE',
      v_url || '/storage/v1/object/utils-files',
      array[
        extensions.http_header('authorization', 'Bearer ' || v_key),
        extensions.http_header('apikey', v_key),
        extensions.http_header('content-type', 'application/json')
      ],
      'application/json',
      json_build_object('prefixes', v_chunk)::text
    )::extensions.http_request);

    if v_status < 200 or v_status >= 300 then
      raise exception 'Storage respondió % al borrar objetos sueltos', v_status;
    end if;
    v_from := v_from + 100;
  end loop;
end;
$$;

revoke all on function public.limpiar_utils_archivos() from public;
revoke all on function public.limpiar_utils_archivos() from anon, authenticated;

comment on function public.limpiar_utils_archivos() is
  'Borra archivos vencidos de utils y objetos huérfanos de más de 90 días.';

-- ---------------------------------------------------------------------------
-- BLOQUE CRON
-- Si "create extension pg_cron" falla, activala en Database > Extensions
-- y volvé a ejecutar solo desde este comentario hasta el fin del bloque.
-- Corre cada hora, minuto 0.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron with schema pg_catalog;

do $$
declare
  v_job bigint;
begin
  for v_job in
    select jobid from cron.job where jobname = 'limpiar_utils_archivos'
  loop
    perform cron.unschedule(v_job);
  end loop;
end $$;

select cron.schedule(
  'limpiar_utils_archivos',
  '0 * * * *',
  $cron$select public.limpiar_utils_archivos();$cron$
);

-- ---------------------------------------------------------------------------
-- Uso de herramientas
-- El sitio suma aperturas y ejecuciones. La lista solo sale con la clave
-- guardada en utils_interno.secreto, clave uso_panel.
-- Cargala una vez en el SQL Editor y no la dejes en el repo:
-- insert into utils_interno.secreto (clave, valor) values
--   ('uso_panel', 'UNA-CLAVE-LARGA')
-- on conflict (clave) do update set valor = excluded.valor;
-- ---------------------------------------------------------------------------

create table if not exists public.utils_uso (
  herramienta text primary key,
  aperturas bigint not null default 0,
  ejecuciones bigint not null default 0,
  constraint utils_uso_aperturas_ok check (aperturas >= 0),
  constraint utils_uso_ejecuciones_ok check (ejecuciones >= 0)
);

alter table public.utils_uso enable row level security;

create or replace function public.registrar_uso(p_herramienta text, p_evento text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_evento is null or p_evento not in ('abrir', 'ejecutar') then
    return;
  end if;
  if p_herramienta is null or p_herramienta not in (
    'gif', 'pdf', 'qr', 'twitter', 'youtube',
    'imagen-comprimir', 'imagen-heic', 'imagen-marca',
    'pdf-unir', 'pdf-dividir', 'pdf-paginas', 'pdf-imagenes', 'pdf-firmar',
    'texto-contar', 'texto-diff', 'texto-csv', 'clave', 'unidades'
  ) then
    return;
  end if;

  insert into public.utils_uso (herramienta, aperturas, ejecuciones)
  values (
    p_herramienta,
    case when p_evento = 'abrir' then 1 else 0 end,
    case when p_evento = 'ejecutar' then 1 else 0 end
  )
  on conflict (herramienta) do update
  set aperturas = public.utils_uso.aperturas + excluded.aperturas,
      ejecuciones = public.utils_uso.ejecuciones + excluded.ejecuciones;
end;
$$;

revoke all on function public.registrar_uso(text, text) from public;
grant execute on function public.registrar_uso(text, text) to anon, authenticated;

create or replace function public.ver_uso(p_clave text)
returns jsonb
language plpgsql
security definer
set search_path = public, utils_interno
as $$
declare
  v_clave text;
  v_filas jsonb;
begin
  select valor into v_clave
  from utils_interno.secreto
  where clave = 'uso_panel';

  if coalesce(v_clave, '') = '' or p_clave is null or p_clave <> v_clave then
    return jsonb_build_object('ok', false);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'herramienta', u.herramienta,
    'aperturas', u.aperturas,
    'ejecuciones', u.ejecuciones
  ) order by u.aperturas desc, u.ejecuciones desc, u.herramienta), '[]'::jsonb)
  into v_filas
  from public.utils_uso u;

  return jsonb_build_object('ok', true, 'filas', v_filas);
end;
$$;

revoke all on function public.ver_uso(text) from public;
grant execute on function public.ver_uso(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- BORRADO TOTAL MANUAL
-- No se ejecuta solo. Sirve para vaciar a propósito todo lo de esta app.
-- El identificador es namespace = 'utils' y el bucket utils-files.
-- No toca otras tablas ni otros buckets del proyecto.
--
-- Opción recomendada, porque también borra los archivos del bucket:
-- update public.utils_archivos
-- set expires_at = now() - interval '1 minute'
-- where namespace = 'utils';
-- select public.limpiar_utils_archivos();
--
-- Opción directa, si después vaciás el bucket utils-files en el panel:
-- delete from storage.objects where bucket_id = 'utils-files';
-- delete from public.utils_archivos where namespace = 'utils';
-- ---------------------------------------------------------------------------
