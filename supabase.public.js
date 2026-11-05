export const supabasePublic = {
  url: "https://gxtmgcxlynogoldslubb.supabase.co",
  anonKey: "sb_publishable_jrPPckjC1uGmaL3szMnlPw_lTt42dJp",
};

const BUCKET = "utils-files";

export function supabaseConectado() {
  const url = supabasePublic.url.trim();
  const key = supabasePublic.anonKey.trim();
  return Boolean(url && key && !url.includes("TU-PROYECTO") && !key.includes("TU_ANON"));
}

export async function crearArchivo({ id, nombre, contentType, bytes, dias }) {
  const response = await fetch(`${base()}/rest/v1/rpc/crear_archivo`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      p_id: id,
      p_nombre: nombre,
      p_content_type: contentType || "application/octet-stream",
      p_bytes: bytes,
      p_dias: dias,
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(mensajeError(body, "No se pudo registrar el archivo."));
  return body;
}

export async function anularArchivo(id) {
  await fetch(`${base()}/rest/v1/rpc/anular_archivo`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ p_id: id }),
  });
}

export async function subirArchivo(storagePath, file) {
  const response = await fetch(`${base()}/storage/v1/object/${BUCKET}/${encodePath(storagePath)}`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": file.type || "application/octet-stream",
      "x-upsert": "false",
    },
    body: file,
  });
  if (response.ok) return;
  const body = await response.json().catch(() => ({}));
  throw new Error(mensajeError(body, "No se pudo subir el archivo."));
}

export async function obtenerArchivo(id) {
  const response = await fetch(`${base()}/rest/v1/rpc/obtener_archivo`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ p_id: id }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(mensajeError(body, "No se pudo buscar el archivo."));
  return Array.isArray(body) ? body[0] || null : null;
}

export function urlPublica(storagePath) {
  return `${base()}/storage/v1/object/public/${BUCKET}/${encodePath(storagePath)}`;
}

function base() {
  return supabasePublic.url.trim().replace(/\/$/, "");
}

function authHeaders() {
  return {
    apikey: supabasePublic.anonKey.trim(),
    Authorization: `Bearer ${supabasePublic.anonKey.trim()}`,
  };
}

function jsonHeaders() {
  return {
    ...authHeaders(),
    "Content-Type": "application/json",
  };
}

function encodePath(path) {
  return path.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function mensajeError(body, fallback) {
  const text = `${body?.message || ""} ${body?.error || ""} ${body?.msg || ""}`.toLowerCase();
  if (text.includes("bucket") && text.includes("not found")) {
    return "No está el bucket utils-files. Corré migracion.sql en Supabase.";
  }
  if (text.includes("dias fuera de rango") || text.includes("peso fuera de rango")) {
    return "Ese archivo no entra en las reglas de días o de peso.";
  }
  return fallback;
}
