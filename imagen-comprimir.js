import { abrir, ejecutar } from "./uso.js";

abrir("imagen-comprimir");

const MAX_SIDE = 2400;
const fileInput = document.querySelector("#file");
const dropTitle = document.querySelector("#drop-title");
const form = document.querySelector("#form");
const formato = document.querySelector("#formato");
const calidad = document.querySelector("#calidad");
const calidadNum = document.querySelector("#calidad-num");
const statusEl = document.querySelector("#status");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");
const fileMeta = document.querySelector("#file-meta");
const downloadBtn = document.querySelector("#download");

const state = { file: null, blob: null, url: "", name: "" };

calidad.addEventListener("input", () => {
  calidadNum.textContent = calidad.value;
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  state.file = file;
  dropTitle.textContent = file.name;
  form.hidden = false;
  result.hidden = true;
  setStatus("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.file) return;
  setStatus("Comprimiendo…");
  try {
    const image = await loadImage(state.file);
    const size = fit(image.naturalWidth || image.width, image.naturalHeight || image.height, MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = size.w;
    canvas.height = size.h;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, size.w, size.h);
    const type = formato.value;
    const quality = type === "image/png" ? undefined : Number(calidad.value) / 100;
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error("Este navegador no guarda ese formato.");
    if (state.url) URL.revokeObjectURL(state.url);
    state.blob = blob;
    state.url = URL.createObjectURL(blob);
    state.name = renamed(state.file.name, type);
    preview.src = state.url;
    fileMeta.textContent = `${formatBytes(state.file.size)} → ${formatBytes(blob.size)}`;
    result.hidden = false;
    setStatus("Listo para descargar.", "ok");
    ejecutar("imagen-comprimir");
  } catch (error) {
    setStatus(error.message || "No se pudo comprimir la imagen.", "error");
  }
});

downloadBtn.addEventListener("click", () => download(state.url, state.name));

function renamed(name, type) {
  const base = name.replace(/\.[^.]+$/, "") || "imagen";
  const ext = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  return `${base}.${ext}`;
}

function loadImage(file) {
  const url = URL.createObjectURL(file);
  const image = new Image();
  return new Promise((resolve, reject) => {
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo leer esa imagen."));
    };
    image.src = url;
  });
}

function fit(width, height, max) {
  const scale = Math.min(1, max / Math.max(width, height));
  return { w: Math.max(1, Math.round(width * scale)), h: Math.max(1, Math.round(height * scale)) };
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function download(url, name) {
  if (!url) return;
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.className = `status${kind ? ` is-${kind}` : ""}`;
}
