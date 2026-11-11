import { abrir, ejecutar } from "./uso.js";

abrir("imagen-heic");

const MAX_PIXELS = 16000000;
const JPG_QUALITY = 0.85;
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "mif1"]);

const fileInput = document.querySelector("#file");
const dropTitle = document.querySelector("#drop-title");
const form = document.querySelector("#form");
const formato = document.querySelector("#formato");
const statusEl = document.querySelector("#status");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");
const fileMeta = document.querySelector("#file-meta");
const downloadBtn = document.querySelector("#download");

const state = { file: null, url: "", name: "" };
let decoderPromise = null;

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
  const type = formato.value;
  setStatus(type === "image/png" ? "Pasando a PNG…" : "Pasando a JPG…");
  try {
    const header = new Uint8Array(await state.file.slice(0, 64).arrayBuffer());
    if (!isHeic(header)) throw new Error("Eso no es una foto HEIC.");
    const drawn = await drawPhoto(state.file);
    const blob = await new Promise((resolve) => {
      drawn.canvas.toBlob(resolve, type, type === "image/png" ? undefined : JPG_QUALITY);
    });
    if (!blob) throw new Error("Este navegador no guarda ese formato.");
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(blob);
    state.name = renamed(state.file.name, type);
    preview.src = state.url;
    fileMeta.textContent = `${formatBytes(state.file.size)} → ${formatBytes(blob.size)}`;
    result.hidden = false;
    const note = drawn.scaled ? " La foto era muy grande y se achicó para poder guardarla." : "";
    setStatus(`Listo para descargar.${note}`, "ok");
    ejecutar("imagen-heic");
  } catch (error) {
    setStatus(error.message || "No se pudo convertir esa foto.", "error");
  }
});

downloadBtn.addEventListener("click", () => {
  if (!state.url) return;
  const link = document.createElement("a");
  link.href = state.url;
  link.download = state.name;
  document.body.append(link);
  link.click();
  link.remove();
});

async function drawPhoto(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      return canvasFromSource(bitmap);
    } finally {
      bitmap.close?.();
    }
  } catch {
    setStatus("Este navegador no lee HEIC solo. Bajando el decodificador…");
    return canvasFromDecoder(new Uint8Array(await file.arrayBuffer()));
  }
}

function canvasFromSource(source) {
  const size = fitPixels(source.width, source.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  canvas.getContext("2d").drawImage(source, 0, 0, size.w, size.h);
  return { canvas, scaled: size.scaled };
}

async function canvasFromDecoder(bytes) {
  const lib = await loadDecoder();
  const images = new lib.HeifDecoder().decode(bytes);
  const image = images?.[0];
  const width = image?.get_width?.() || 0;
  const height = image?.get_height?.() || 0;
  if (!width || !height) throw new Error("No se pudo leer esa foto HEIC.");
  const pixels = new ImageData(width, height);
  const displayed = await new Promise((resolve, reject) => {
    image.display(pixels, (result) => {
      if (!result) reject(new Error("No se pudo leer esa foto HEIC."));
      else resolve(result);
    });
  });
  const size = fitPixels(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const context = canvas.getContext("2d");
  if (size.scaled) context.putImageData(downsample(displayed, width, height, size.w, size.h), 0, 0);
  else context.putImageData(displayed, 0, 0);
  return { canvas, scaled: size.scaled };
}

function loadDecoder() {
  if (!decoderPromise) {
    decoderPromise = injectDecoder().catch((error) => {
      decoderPromise = null;
      throw error;
    });
  }
  return decoderPromise;
}

async function injectDecoder() {
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "./vendor/libheif/libheif.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("No se pudo bajar el decodificador."));
    document.head.append(script);
  });
  const factory = globalThis.libheif;
  if (typeof factory !== "function") throw new Error("No se pudo preparar el decodificador.");
  const response = await fetch("./vendor/libheif/libheif.wasm");
  if (!response.ok) throw new Error("No se pudo bajar el decodificador.");
  const wasm = await response.arrayBuffer();
  try {
    const lib = factory({ wasmBinary: wasm });
    if (lib.calledRun) return lib;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("No se pudo preparar el decodificador.")), 45000);
      lib.onRuntimeInitialized = () => {
        clearTimeout(timer);
        resolve(lib);
      };
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error("No se pudo preparar el decodificador.");
  }
}

function isHeic(bytes) {
  if (bytes.length < 12) return false;
  if (ascii(bytes, 4, 8) !== "ftyp") return false;
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  const end = size >= 16 ? Math.min(bytes.length, size) : bytes.length;
  for (let index = 8; index + 4 <= end; index += 4) {
    if (index === 12) continue;
    if (HEIC_BRANDS.has(ascii(bytes, index, index + 4))) return true;
  }
  return false;
}

function ascii(bytes, start, end) {
  let text = "";
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index]);
  return text;
}

function fitPixels(width, height) {
  const pixels = width * height;
  if (pixels <= MAX_PIXELS) return { w: width, h: height, scaled: false };
  const scale = Math.sqrt(MAX_PIXELS / pixels);
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
    scaled: true,
  };
}

function downsample(source, width, height, targetWidth, targetHeight) {
  const src = source.data;
  const out = new ImageData(targetWidth, targetHeight);
  const dst = out.data;
  for (let y = 0; y < targetHeight; y += 1) {
    const sy = Math.min(height - 1, Math.floor((y * height) / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sx = Math.min(width - 1, Math.floor((x * width) / targetWidth));
      const from = (sy * width + sx) * 4;
      const to = (y * targetWidth + x) * 4;
      dst[to] = src[from];
      dst[to + 1] = src[from + 1];
      dst[to + 2] = src[from + 2];
      dst[to + 3] = src[from + 3];
    }
  }
  return out;
}

function renamed(name, type) {
  const base = name.replace(/\.[^.]+$/, "") || "foto";
  return `${base}.${type === "image/png" ? "png" : "jpg"}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.className = `status${kind ? ` is-${kind}` : ""}`;
}
