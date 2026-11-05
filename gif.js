import { GIFEncoder, quantize, applyPalette } from "./vendor/gifenc.js";

const FPS = 10;
const MAX_WIDTH = 480;
const MAX_SPAN = 15;
const HEAVY_BYTES = 80 * 1024 * 1024;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|ogg|ogv)$/i;

const dropzone = document.querySelector("#dropzone");
const fileInput = document.querySelector("#file");
const dropTitle = document.querySelector("#drop-title");
const dropHelp = document.querySelector("#drop-help");
const heavyNote = document.querySelector("#heavy-note");
const statusEl = document.querySelector("#status");
const editor = document.querySelector("#editor");
const video = document.querySelector("#video");
const fileMeta = document.querySelector("#file-meta");
const startRange = document.querySelector("#start-range");
const endRange = document.querySelector("#end-range");
const startNum = document.querySelector("#start-num");
const endNum = document.querySelector("#end-num");
const spanLabel = document.querySelector("#span-label");
const limitNote = document.querySelector("#limit-note");
const previewBtn = document.querySelector("#preview");
const convertBtn = document.querySelector("#convert");
const meter = document.querySelector("#meter");
const meterFill = document.querySelector("#meter-fill");
const result = document.querySelector("#result");
const gifPreview = document.querySelector("#gif-preview");
const copyBtn = document.querySelector("#copy");
const shareBtn = document.querySelector("#share");
const downloadBtn = document.querySelector("#download");
const copyStatus = document.querySelector("#copy-status");

const state = {
  file: null,
  videoUrl: "",
  gifUrl: "",
  gifBlob: null,
  gifName: "video.gif",
  duration: 0,
  start: 0,
  end: 0,
  converting: false,
  previewing: false,
};

let loadToken = 0;
let runToken = 0;
let seekToken = 0;
let previewTimer = 0;
let frameSeek = 0;

video.playsInline = true;

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());

dropzone.addEventListener("dragover", () => dropzone.classList.add("is-hot"));
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-hot"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  dropzone.classList.remove("is-hot");
  const file = pickVideo(event.dataTransfer?.files);
  if (file) loadFile(file);
});

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) loadFile(file);
});

startRange.addEventListener("input", () => {
  stopPreview();
  setSelection(Number(startRange.value), state.end, "start");
  showFrame(state.start);
});

endRange.addEventListener("input", () => {
  stopPreview();
  setSelection(state.start, Number(endRange.value), "end");
  showFrame(state.end);
});

startNum.addEventListener("change", () => applyTyped("start", startNum));
endNum.addEventListener("change", () => applyTyped("end", endNum));

previewBtn.addEventListener("click", playSegment);
convertBtn.addEventListener("click", convert);
copyBtn.addEventListener("click", copyGif);
shareBtn.addEventListener("click", shareGif);
downloadBtn.addEventListener("click", downloadGif);

video.addEventListener("timeupdate", () => {
  if (!state.previewing) return;
  if (video.currentTime >= state.end - 0.03) stopPreview();
});

function pickVideo(fileList) {
  const files = [...(fileList || [])];
  const videoFile = files.find(isVideo);
  if (videoFile) return videoFile;
  if (files.length) {
    setStatus("Elegí un archivo de video.", "error");
  }
  return null;
}

function isVideo(file) {
  return file.type.startsWith("video/") || VIDEO_EXT.test(file.name);
}

async function loadFile(file) {
  if (!isVideo(file)) {
    setStatus("Elegí un archivo de video.", "error");
    return;
  }

  const token = ++loadToken;
  runToken += 1;
  stopPreview();
  state.converting = false;
  state.file = file;
  clearGif();
  setCopyStatus("");
  setProgress(0, false);
  setStatus("Leyendo el video…");
  heavyNote.hidden = file.size <= HEAVY_BYTES;

  dropzone.classList.add("is-compact");
  dropTitle.textContent = file.name;
  dropHelp.textContent = "Tocá o soltá otro video para cambiarlo";
  editor.hidden = false;
  result.hidden = true;

  const nextUrl = URL.createObjectURL(file);
  const previousUrl = state.videoUrl;
  state.videoUrl = nextUrl;
  video.src = nextUrl;
  if (previousUrl) URL.revokeObjectURL(previousUrl);

  try {
    await waitForMeta(video);
    if (token !== loadToken) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) {
      throw new Error("Este video no tiene una duración usable. Probá con un mp4.");
    }
    state.duration = video.duration;
    startRange.max = String(state.duration);
    endRange.max = String(state.duration);
    startNum.max = String(state.duration);
    endNum.max = String(state.duration);
    setSelection(0, Math.min(state.duration, MAX_SPAN), "end");
    fileMeta.textContent = `${file.name} · ${formatBytes(file.size)} · ${state.duration.toFixed(1)} s`;
    setStatus("");
    video.currentTime = state.start;
  } catch (error) {
    if (token !== loadToken) return;
    editor.hidden = true;
    setStatus(error.message || "No se pudo abrir el video.", "error");
  }
}

function waitForMeta(element) {
  if (element.readyState >= 1 && Number.isFinite(element.duration)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("No se pudo abrir el video."));
    }, 15000);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("No se pudo abrir el video."));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      element.removeEventListener("loadedmetadata", onReady);
      element.removeEventListener("error", onError);
    };
    element.addEventListener("loadedmetadata", onReady);
    element.addEventListener("error", onError);
  });
}

function applyTyped(source, input) {
  const value = Number.parseFloat(input.value);
  if (!Number.isFinite(value)) {
    renderSelection();
    return;
  }
  stopPreview();
  if (source === "start") setSelection(value, state.end, "start");
  else setSelection(state.start, value, "end");
  showFrame(source === "start" ? state.start : state.end);
}

function setSelection(start, end, source) {
  const max = state.duration;
  if (!max) return;
  let nextStart = clamp(start, 0, max);
  let nextEnd = clamp(end, 0, max);
  const gap = Math.min(0.1, max);
  if (nextEnd - nextStart < gap) {
    if (source === "end") nextStart = clamp(nextEnd - gap, 0, max);
    else nextEnd = clamp(nextStart + gap, 0, max);
    if (nextEnd - nextStart < gap) {
      nextStart = 0;
      nextEnd = max;
    }
  }
  state.start = clamp(round1(nextStart), 0, max);
  state.end = clamp(round1(nextEnd), 0, max);
  if (state.end < state.start) state.end = clamp(state.start + gap, 0, max);
  renderSelection();
}

function renderSelection() {
  startRange.value = String(state.start);
  endRange.value = String(state.end);
  startNum.value = state.start.toFixed(1);
  endNum.value = state.end.toFixed(1);
  const span = state.end - state.start;
  const tooLong = span > MAX_SPAN + 0.05;
  spanLabel.textContent = `Tramo de ${span.toFixed(1)} s`;
  spanLabel.classList.toggle("is-bad", tooLong);
  limitNote.hidden = !tooLong;
  const locked = state.converting;
  convertBtn.disabled = locked || tooLong || span <= 0;
  previewBtn.disabled = locked || span <= 0;
  startRange.disabled = locked;
  endRange.disabled = locked;
  startNum.disabled = locked;
  endNum.disabled = locked;
}

function showFrame(time) {
  if (state.converting || !state.duration) return;
  cancelAnimationFrame(frameSeek);
  frameSeek = requestAnimationFrame(() => {
    if (Math.abs(video.currentTime - time) > 0.04) video.currentTime = time;
  });
}

async function playSegment() {
  if (state.converting || state.end <= state.start) return;
  stopPreview();
  state.previewing = true;
  previewBtn.textContent = "Viendo…";
  try {
    await seekTo(state.start);
    if (!state.previewing) return;
    await video.play();
  } catch {
    stopPreview();
    setStatus("No se pudo reproducir ese tramo.", "error");
    return;
  }
  const ms = Math.max(80, (state.end - state.start) * 1000 + 60);
  previewTimer = window.setTimeout(stopPreview, ms);
}

function stopPreview() {
  state.previewing = false;
  window.clearTimeout(previewTimer);
  if (!video.paused) video.pause();
  previewBtn.textContent = "Ver tramo";
}

async function convert() {
  const span = state.end - state.start;
  if (state.converting || span <= 0 || span > MAX_SPAN + 0.05) return;
  const token = ++runToken;
  const start = state.start;
  const end = state.end;
  state.converting = true;
  stopPreview();
  result.hidden = true;
  clearGif();
  setCopyStatus("");
  renderSelection();
  setProgress(0, true);
  setStatus("Preparando los fotogramas…");
  editor.setAttribute("aria-busy", "true");
  video.pause();

  const wasMuted = video.muted;
  video.muted = true;

  try {
    const blob = await encodeClip(token, start, end);
    if (token !== runToken) return;
    const url = URL.createObjectURL(blob);
    state.gifBlob = blob;
    state.gifUrl = url;
    state.gifName = toGifName(state.file?.name || "video");
    gifPreview.src = url;
    result.hidden = false;
    updateShareButton();
    setProgress(1, false);
    setStatus("Listo para copiar, compartir o descargar.", "ok");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    result.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  } catch (error) {
    if (token !== runToken) return;
    setProgress(0, false);
    setStatus(error.message || "No se pudo convertir el video.", "error");
  } finally {
    video.muted = wasMuted;
    if (token === runToken) {
      state.converting = false;
      editor.removeAttribute("aria-busy");
      renderSelection();
    }
  }
}

async function encodeClip(token, start, end) {
  const span = end - start;
  const frameCount = Math.max(1, Math.round(span * FPS));
  const delay = Math.max(20, Math.round((span / frameCount) * 1000));
  const { w, h } = fitSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const gif = GIFEncoder();
  for (let index = 0; index < frameCount; index += 1) {
    if (token !== runToken) throw new Error("Se canceló la conversión.");
    const time = start + ((index + 0.5) * span) / frameCount;
    await seekTo(Math.min(time, Math.max(start, end - 0.04)));
    await paintedFrame();
    context.drawImage(video, 0, 0, w, h);
    const { data } = context.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    const indexed = applyPalette(data, palette);
    gif.writeFrame(indexed, w, h, { palette, delay, dispose: 1 });
    setProgress((index + 1) / frameCount, true);
    setStatus(`Armando fotograma ${index + 1} de ${frameCount}`);
    await yieldToUi();
  }

  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

function fitSize(width, height) {
  const scale = Math.min(1, MAX_WIDTH / width);
  let w = Math.max(2, Math.round(width * scale));
  let h = Math.max(2, Math.round(height * scale));
  if (w % 2) w -= 1;
  if (h % 2) h -= 1;
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

function seekTo(time) {
  const token = ++seekToken;
  const target = clamp(time, 0, Math.max(0, (video.duration || 0) - 0.001));
  if (Math.abs(video.currentTime - target) < 0.02 && video.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Tardó demasiado en leer un fotograma."));
    }, 8000);
    const onSeeked = () => {
      if (token !== seekToken) return;
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("No se pudo leer el video en ese segundo."));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("error", onError);
    };
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("error", onError);
    try {
      video.currentTime = target;
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

function paintedFrame() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = window.setTimeout(finish, 90);
    if (typeof video.requestVideoFrameCallback === "function") {
      video.requestVideoFrameCallback(() => {
        window.clearTimeout(timer);
        finish();
      });
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.clearTimeout(timer);
      finish();
    }));
  });
}

function yieldToUi() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function updateShareButton() {
  shareBtn.hidden = !state.gifBlob;
}

async function copyGif() {
  if (!state.gifBlob) return;
  let supports = true;
  if (typeof ClipboardItem !== "undefined" && typeof ClipboardItem.supports === "function") {
    try {
      supports = ClipboardItem.supports("image/gif");
    } catch {
      supports = true;
    }
  }
  if (!navigator.clipboard || typeof ClipboardItem === "undefined" || !supports) {
    setCopyStatus("Este navegador no puede copiar un gif animado. Usá Compartir o Descargar.", "error");
    return;
  }
  try {
    const item = new ClipboardItem({
      "image/gif": Promise.resolve(state.gifBlob),
    });
    await navigator.clipboard.write([item]);
    setCopyStatus("Copiado. Pegalo en WhatsApp u otro lado.", "ok");
  } catch {
    setCopyStatus("No se pudo copiar el gif animado. Probá Compartir o Descargar.", "error");
  }
}

async function shareGif() {
  const file = gifFile();
  if (!file || !navigator.share) {
    setCopyStatus("Este navegador no abre el menú para compartir. Probá Descargar.", "error");
    return;
  }
  try {
    await navigator.share({ files: [file], title: state.gifName });
    setCopyStatus("Listo para compartir.", "ok");
  } catch (error) {
    if (error?.name === "AbortError") return;
    setCopyStatus("No se pudo abrir el menú para compartir. Probá Descargar.", "error");
  }
}

function downloadGif() {
  if (!state.gifUrl) return;
  const link = document.createElement("a");
  link.href = state.gifUrl;
  link.download = state.gifName;
  document.body.append(link);
  link.click();
  link.remove();
}

function gifFile() {
  if (!state.gifBlob) return null;
  return new File([state.gifBlob], state.gifName, { type: "image/gif" });
}

function clearGif() {
  if (state.gifUrl) URL.revokeObjectURL(state.gifUrl);
  state.gifUrl = "";
  state.gifBlob = null;
  gifPreview.removeAttribute("src");
  shareBtn.hidden = true;
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

function setProgress(ratio, visible) {
  const percent = Math.round(clamp(ratio, 0, 1) * 100);
  meter.hidden = !visible;
  meter.ariaValueNow = String(percent);
  meterFill.style.width = `${percent}%`;
}

function toGifName(name) {
  const base = name.replace(/\.[^.]+$/, "").trim() || "video";
  return `${base}.gif`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
