import {
  anularArchivo,
  crearArchivo,
  subirArchivo,
  supabaseConectado,
} from "./supabase.public.js";
import { abrir, ejecutar } from "./uso.js";

abrir("qr");

const MAX_BYTES = 50 * 1024 * 1024;

const linkInput = document.querySelector("#link");
const generarLinkBtn = document.querySelector("#generar-link");
const dropzone = document.querySelector("#dropzone");
const fileInput = document.querySelector("#file");
const dropTitle = document.querySelector("#drop-title");
const dropHelp = document.querySelector("#drop-help");
const diasPanel = document.querySelector("#dias-panel");
const fileMeta = document.querySelector("#file-meta");
const diasRange = document.querySelector("#dias-range");
const diasNum = document.querySelector("#dias-num");
const subirBtn = document.querySelector("#subir");
const statusEl = document.querySelector("#status");
const result = document.querySelector("#result");
const qrLink = document.querySelector("#qr-link");
const vence = document.querySelector("#vence");
const qrImg = document.querySelector("#qr-img");
const copiarLinkBtn = document.querySelector("#copiar-link");
const copiarQrBtn = document.querySelector("#copiar-qr");
const compartirBtn = document.querySelector("#compartir");
const descargarBtn = document.querySelector("#descargar");
const copyStatus = document.querySelector("#copy-status");

const state = {
  file: null,
  url: "",
  pngUrl: "",
  pngBlob: null,
  busy: false,
};

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());
dropzone.addEventListener("dragover", () => dropzone.classList.add("is-hot"));
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-hot"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  dropzone.classList.remove("is-hot");
  const file = event.dataTransfer?.files?.[0];
  if (file) elegirArchivo(file);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) elegirArchivo(file);
});

generarLinkBtn.addEventListener("click", generarDesdeLink);
subirBtn.addEventListener("click", subirYGenerar);
diasRange.addEventListener("input", () => setDias(Number(diasRange.value)));
diasNum.addEventListener("change", () => setDias(Number.parseInt(diasNum.value, 10)));
copiarLinkBtn.addEventListener("click", copiarLink);
copiarQrBtn.addEventListener("click", copiarQr);
compartirBtn.addEventListener("click", compartirQr);
descargarBtn.addEventListener("click", descargarQr);
linkInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") generarDesdeLink();
});

function elegirArchivo(file) {
  if (file.size > MAX_BYTES) {
    setStatus("El archivo pasa los 50 MB.", "error");
    return;
  }
  if (file.size <= 0) {
    setStatus("Ese archivo está vacío.", "error");
    return;
  }
  state.file = file;
  dropzone.classList.add("is-compact");
  dropTitle.textContent = file.name;
  dropHelp.textContent = "Tocá o soltá otro para cambiarlo";
  fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;
  diasPanel.hidden = false;
  setStatus("");
}

function generarDesdeLink() {
  const url = parseHttpUrl(linkInput.value);
  if (!url) {
    setStatus("El link tiene que empezar con http:// o https://.", "error");
    return;
  }
  mostrarQr(url, "");
  setStatus("");
}

async function subirYGenerar() {
  if (state.busy || !state.file) return;
  if (!supabaseConectado()) {
    setStatus("Falta conectar Supabase. Hace falta la URL y la anon key en supabase.public.js.", "error");
    return;
  }

  const dias = diasElegidos();
  const file = state.file;
  const id = crypto.randomUUID();
  state.busy = true;
  subirBtn.disabled = true;
  setStatus("Subiendo el archivo…");

  let registrado = false;
  try {
    const ficha = await crearArchivo({
      id,
      nombre: file.name,
      contentType: file.type,
      bytes: file.size,
      dias,
    });
    registrado = true;
    await subirArchivo(ficha.storage_path, file);
    const pagina = new URL(`archivo.html?id=${encodeURIComponent(id)}`, window.location.href);
    mostrarQr(pagina.toString(), textoVencimiento(ficha.expires_at));
    setStatus("Listo. El archivo se abre con ese link.", "ok");
  } catch (error) {
    if (registrado) await anularArchivo(id).catch(() => {});
    setStatus(error.message || "No se pudo subir el archivo.", "error");
  } finally {
    state.busy = false;
    subirBtn.disabled = false;
  }
}

function mostrarQr(url, aviso) {
  const png = dibujarQr(url);
  if (state.pngUrl) URL.revokeObjectURL(state.pngUrl);
  state.url = url;
  state.pngBlob = png.blob;
  state.pngUrl = URL.createObjectURL(png.blob);
  qrLink.value = url;
  qrImg.src = state.pngUrl;
  vence.textContent = aviso;
  vence.hidden = !aviso;
  result.hidden = false;
  setCopyStatus("");
  actualizarCompartir();
  ejecutar("qr");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  result.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
}

function dibujarQr(text) {
  const qrcode = globalThis.qrcode;
  if (qrcode.stringToBytesFuncs["UTF-8"]) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];
  }
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const scale = 8;
  const margin = 4;
  const size = (count + margin * 2) * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#241c16";
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      context.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
    }
  }
  const url = canvas.toDataURL("image/png");
  return { blob: dataUrlToBlob(url) };
}

function dataUrlToBlob(dataUrl) {
  const [header, data] = dataUrl.split(",");
  const type = /data:(.*?);/.exec(header)?.[1] || "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

async function copiarLink() {
  if (!state.url) return;
  try {
    await navigator.clipboard.writeText(state.url);
    setCopyStatus("Link copiado.", "ok");
  } catch {
    setCopyStatus("No se pudo copiar el link. Seleccionalo a mano.", "error");
  }
}

async function copiarQr() {
  if (!state.pngBlob) return;
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") {
    setCopyStatus("Este navegador no copia imágenes. Descargá el QR.", "error");
    return;
  }
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": Promise.resolve(state.pngBlob) }),
    ]);
    setCopyStatus("QR copiado.", "ok");
  } catch {
    setCopyStatus("No se pudo copiar la imagen. Probá Descargar.", "error");
  }
}

async function compartirQr() {
  if (!state.pngBlob || !navigator.share) {
    setCopyStatus("Este navegador no abre el menú para compartir.", "error");
    return;
  }
  const file = new File([state.pngBlob], "qr.png", { type: "image/png" });
  try {
    await navigator.share({ files: [file], title: "QR", text: state.url });
  } catch (error) {
    if (error?.name === "AbortError") return;
    setCopyStatus("No se pudo abrir el menú para compartir.", "error");
  }
}

function descargarQr() {
  if (!state.pngUrl) return;
  const link = document.createElement("a");
  link.href = state.pngUrl;
  link.download = "qr.png";
  document.body.append(link);
  link.click();
  link.remove();
}

function actualizarCompartir() {
  compartirBtn.hidden = !state.pngBlob;
}

function setDias(value) {
  const dias = clamp(Number.isFinite(value) ? Math.round(value) : 7, 1, 90);
  diasRange.value = String(dias);
  diasNum.value = String(dias);
}

function diasElegidos() {
  setDias(Number.parseInt(diasNum.value, 10));
  return Number.parseInt(diasNum.value, 10);
}

function parseHttpUrl(value) {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

function textoVencimiento(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return "";
  const texto = new Intl.DateTimeFormat("es-AR", { dateStyle: "long" }).format(fecha);
  return `El archivo se borra el ${texto}.`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.classList.toggle("is-error", kind === "error");
  statusEl.classList.toggle("is-ok", kind === "ok");
}

function setCopyStatus(text, kind) {
  copyStatus.textContent = text;
  copyStatus.hidden = !text;
  copyStatus.classList.toggle("is-error", kind === "error");
  copyStatus.classList.toggle("is-ok", kind === "ok");
}
