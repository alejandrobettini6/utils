import { obtenerArchivo, supabaseConectado, urlPublica } from "./supabase.public.js";

const titulo = document.querySelector("#titulo");
const detalle = document.querySelector("#detalle");
const statusEl = document.querySelector("#status");
const vista = document.querySelector("#vista");
const preview = document.querySelector("#preview");
const abrir = document.querySelector("#abrir");

const id = new URLSearchParams(window.location.search).get("id");

if (!id) {
  setStatus("Este link no tiene un archivo.", "error");
} else if (!supabaseConectado()) {
  setStatus("Falta conectar Supabase para abrir el archivo.", "error");
} else if (!/^[0-9a-f-]{36}$/i.test(id)) {
  setStatus("Este archivo ya no está.", "error");
} else {
  abrirArchivo(id);
}

async function abrirArchivo(archivoId) {
  setStatus("Buscando el archivo…");
  try {
    const archivo = await obtenerArchivo(archivoId);
    if (!archivo) {
      setStatus("Este archivo ya no está. Pudo haber vencido o el link está mal.", "error");
      return;
    }
    const url = urlPublica(archivo.storage_path);
    const tipo = (archivo.content_type || "").toLowerCase();
    titulo.textContent = archivo.nombre || "Archivo";
    document.title = `${titulo.textContent} · utils`;
    const fecha = new Date(archivo.expires_at);
    detalle.textContent = Number.isNaN(fecha.getTime())
      ? "Este link abre solo este archivo."
      : `Este link abre solo este archivo. Se borra el ${new Intl.DateTimeFormat("es-AR", { dateStyle: "long" }).format(fecha)}.`;
    preview.replaceChildren(vistaPrevia(url, tipo));
    abrir.href = url;
    vista.hidden = false;
    setStatus("");
  } catch (error) {
    setStatus(error.message || "No se pudo buscar el archivo.", "error");
  }
}

function vistaPrevia(url, tipo) {
  if (tipo.startsWith("image/") && tipo !== "image/svg+xml") {
    const imagen = document.createElement("img");
    imagen.className = "file-preview";
    imagen.alt = titulo.textContent;
    imagen.src = url;
    return imagen;
  }
  if (tipo === "application/pdf") {
    const marco = document.createElement("iframe");
    marco.className = "file-frame";
    marco.title = titulo.textContent;
    marco.src = url;
    return marco;
  }
  const nota = document.createElement("p");
  nota.className = "hint";
  nota.textContent = "Abrí el archivo con el botón de abajo.";
  return nota;
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.classList.toggle("is-error", kind === "error");
  statusEl.classList.toggle("is-ok", kind === "ok");
}
