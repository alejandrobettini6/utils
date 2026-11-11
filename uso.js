import { supabaseConectado, supabasePublic } from "./supabase.public.js";

const RECIENTES = "utils-recientes";
const INICIALES = ["gif", "pdf", "youtube", "qr"];

export const grupos = {
  imagenes: {
    nombre: "Imágenes",
    href: "./imagenes.html",
    mark: "Img",
    texto: "Comprimir una foto, o marcar una foto o un PDF.",
  },
  pdf: {
    nombre: "PDF",
    href: "./pdfs.html",
    mark: "PDF",
    texto: "Unir, marcar, firmar o pasar de Word.",
  },
  video: {
    nombre: "Video",
    href: "./videos.html",
    mark: "Vid",
    texto: "Pasar un video a gif.",
  },
  descargas: {
    nombre: "Descargas",
    href: "./descargas.html",
    mark: "Baj",
    texto: "Bajar un video de Twitter o YouTube.",
  },
  texto: {
    nombre: "Texto y datos",
    href: "./datos.html",
    mark: "Aa",
    texto: "Contar, comparar, CSV, QR y claves.",
  },
};

export const herramientas = {
  "imagen-comprimir": {
    nombre: "Comprimir",
    texto: "JPG, PNG o WebP más liviano.",
    href: "./imagen-comprimir.html",
    grupo: "imagenes",
  },
  "imagen-heic": {
    nombre: "HEIC",
    texto: "Pasar una foto HEIC a JPG o PNG.",
    href: "./imagen-heic.html",
    grupo: "imagenes",
  },
  "imagen-marca": {
    nombre: "Marca de agua",
    texto: "Un texto encima de una foto o de un PDF.",
    href: "./imagen-marca.html",
    grupo: ["imagenes", "pdf"],
  },
  pdf: {
    nombre: "Word a PDF",
    texto: "De un .docx a un PDF.",
    href: "./pdf.html",
    grupo: "pdf",
  },
  "pdf-unir": {
    nombre: "Unir",
    texto: "Varios PDF en uno solo.",
    href: "./pdf-armar.html#unir",
    grupo: "pdf",
  },
  "pdf-dividir": {
    nombre: "Dividir",
    texto: "Sacar algunas páginas a otro archivo.",
    href: "./pdf-armar.html#dividir",
    grupo: "pdf",
  },
  "pdf-paginas": {
    nombre: "Rotar y ordenar",
    texto: "Girar páginas o cambiar el orden.",
    href: "./pdf-armar.html#paginas",
    grupo: "pdf",
  },
  "pdf-imagenes": {
    nombre: "Imágenes a PDF",
    texto: "Cada foto queda en una página.",
    href: "./pdf-imagenes.html",
    grupo: "pdf",
  },
  "pdf-firmar": {
    nombre: "Firmar",
    texto: "Arrastrá la firma hasta el lugar.",
    href: "./pdf-firmar.html",
    grupo: "pdf",
  },
  gif: {
    nombre: "Gif",
    texto: "De un video a un gif para copiar o mandar.",
    href: "./gif.html",
    grupo: "video",
  },
  twitter: {
    nombre: "Twitter",
    texto: "Pegá el link de un tuit y bajá el video.",
    href: "./twitter.html",
    grupo: "descargas",
  },
  youtube: {
    nombre: "YouTube",
    texto: "Pegá el link y bajá o compartí el video.",
    href: "./youtube.html",
    grupo: "descargas",
  },
  "texto-contar": {
    nombre: "Contador",
    texto: "Palabras, letras y caracteres.",
    href: "./texto-contar.html",
    grupo: "texto",
  },
  "texto-diff": {
    nombre: "Diferencias",
    texto: "Qué cambió entre dos textos.",
    href: "./texto-diff.html",
    grupo: "texto",
  },
  "texto-csv": {
    nombre: "CSV y JSON",
    texto: "Pasar de uno al otro.",
    href: "./texto-csv.html",
    grupo: "texto",
  },
  qr: {
    nombre: "QR",
    texto: "Un QR de un link o de un archivo temporal.",
    href: "./qr.html",
    grupo: "texto",
  },
  clave: {
    nombre: "Contraseña",
    texto: "Una clave larga y al azar.",
    href: "./clave.html",
    grupo: "texto",
  },
  unidades: {
    nombre: "Unidades",
    texto: "Longitud, peso y temperatura.",
    href: "./unidades.html",
    grupo: "texto",
  },
};

export function delGrupo(grupo) {
  return Object.entries(herramientas)
    .filter(([, item]) => [].concat(item.grupo).includes(grupo))
    .map(([id, item]) => ({ id, ...item }));
}

export function recientes() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECIENTES) || "[]");
    const ids = Array.isArray(saved) ? saved.filter((id) => herramientas[id]) : [];
    if (ids.length) return ids.slice(0, 4);
  } catch {
    // El navegador no dejó leer el almacenamiento.
  }
  return INICIALES.slice();
}

export function abrir(id) {
  if (!herramientas[id]) return;
  recordar(id);
  registrar(id, "abrir");
}

export function ejecutar(id) {
  if (!herramientas[id]) return;
  registrar(id, "ejecutar");
}

export async function verUso(clave) {
  if (!supabaseConectado()) {
    throw new Error("Falta conectar Supabase en supabase.public.js.");
  }
  const response = await fetch(`${base()}/rest/v1/rpc/ver_uso`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ p_clave: clave }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.ok !== true) {
    throw new Error("Esa clave no abre el panel.");
  }
  const filas = Array.isArray(body.filas) ? body.filas : [];
  return filas.map((fila) => ({
    id: fila.herramienta,
    nombre: herramientas[fila.herramienta]?.nombre || fila.herramienta,
    aperturas: Number(fila.aperturas) || 0,
    ejecuciones: Number(fila.ejecuciones) || 0,
  }));
}

function recordar(id) {
  try {
    const ids = [id, ...recientes().filter((item) => item !== id)].slice(0, 4);
    localStorage.setItem(RECIENTES, JSON.stringify(ids));
  } catch {
    // Seguir sin guardar el reciente.
  }
}

function registrar(id, evento) {
  if (!supabaseConectado()) return;
  fetch(`${base()}/rest/v1/rpc/registrar_uso`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ p_herramienta: id, p_evento: evento }),
    keepalive: true,
  }).catch(() => {});
}

function base() {
  return supabasePublic.url.trim().replace(/\/$/, "");
}

function jsonHeaders() {
  const key = supabasePublic.anonKey.trim();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}
