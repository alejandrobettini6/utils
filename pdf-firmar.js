import { abrir, ejecutar } from "./uso.js";

abrir("pdf-firmar");

const { PDFDocument } = globalThis.PDFLib;
const pdfjsLib = globalThis.pdfjsLib;
pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.js";

const canvas = document.querySelector("#pad");
const context = canvas.getContext("2d");
const pageCanvas = document.querySelector("#page-canvas");
const pageContext = pageCanvas.getContext("2d");
const signPage = document.querySelector("#sign-page");
const signSheet = document.querySelector("#sign-sheet");
const stamp = document.querySelector("#stamp");
const stampImg = document.querySelector("#stamp-img");
const resizeHandle = document.querySelector("#stamp-resize");
const fileInput = document.querySelector("#file");
const firmaInput = document.querySelector("#firma");
const paginaInput = document.querySelector("#pagina");
const statusEl = document.querySelector("#status");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");
const SIGN_ASPECT = canvas.height / canvas.width;
const state = {
  bytes: null,
  count: 0,
  url: "",
  pdf: null,
  pageWidth: 1,
  pageHeight: 1,
  box: { x: 0.38, y: 0.78, w: 0.24 },
};
const MIN_W = 0.045;
let drawing = false;
let last = null;
let drag = null;
let pinch = null;
let renderToken = 0;
const pointers = new Map();

context.lineWidth = 6;
context.lineCap = "round";
context.strokeStyle = "#241c16";

canvas.addEventListener("pointerdown", (event) => {
  drawing = true;
  canvas.setPointerCapture(event.pointerId);
  last = point(event);
});

canvas.addEventListener("pointermove", (event) => {
  if (!drawing || !last) return;
  const next = point(event);
  context.beginPath();
  context.moveTo(last.x, last.y);
  context.lineTo(next.x, next.y);
  context.stroke();
  last = next;
});

canvas.addEventListener("pointerup", () => {
  drawing = false;
  last = null;
  refreshStamp();
});

signSheet.addEventListener("pointerdown", onSheetDown);
signSheet.addEventListener("pointermove", onSheetMove);
signSheet.addEventListener("pointerup", endPointer);
signSheet.addEventListener("pointercancel", endPointer);
signSheet.addEventListener("wheel", onWheel, { passive: false });

document.querySelector("#limpiar").addEventListener("click", () => {
  clearPad();
  refreshStamp();
});

firmaInput.addEventListener("change", async () => {
  const file = firmaInput.files?.[0];
  if (!file) return;
  try {
    const image = await loadImage(file);
    clearPad();
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    context.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    refreshStamp();
  } catch (error) {
    setStatus(error.message || "No se pudo leer la firma.", "error");
  }
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  document.querySelector("#drop-title").textContent = file?.name || "Elegí un PDF";
  state.bytes = null;
  signPage.hidden = true;
  if (state.pdf) {
    state.pdf.destroy();
    state.pdf = null;
  }
  if (!file) return;
  try {
    state.bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(state.bytes.slice(0));
    state.count = doc.getPageCount();
    paginaInput.max = String(state.count);
    paginaInput.value = "1";
    state.box = { x: 0.38, y: 0.78, w: 0.24 };
    state.pdf = await pdfjsLib.getDocument({ data: state.bytes.slice(0) }).promise;
    refreshStamp();
    await renderPage();
    setStatus(`${state.count} ${state.count === 1 ? "página" : "páginas"}. Arrastrá la firma.`, "ok");
  } catch {
    signPage.hidden = true;
    setStatus("Ese PDF está protegido o no se pudo leer.", "error");
  }
});

paginaInput.addEventListener("change", () => {
  if (state.pdf) renderPage();
});

document.querySelector("#run").addEventListener("click", async () => {
  if (!state.bytes) {
    setStatus("Elegí un PDF.", "error");
    return;
  }
  const pageNumber = Number(paginaInput.value);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.count) {
    setStatus("Esa página no está en el PDF.", "error");
    return;
  }
  setStatus("Poniendo la firma…");
  try {
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const doc = await PDFDocument.load(state.bytes.slice(0));
    const image = await doc.embedPng(await png.arrayBuffer());
    const page = doc.getPages()[pageNumber - 1];
    const heightFraction = state.box.w * SIGN_ASPECT * (state.pageWidth / state.pageHeight);
    const width = state.box.w * page.getWidth();
    const height = heightFraction * page.getHeight();
    page.drawImage(image, {
      x: state.box.x * page.getWidth(),
      y: page.getHeight() - (state.box.y + heightFraction) * page.getHeight(),
      width,
      height,
    });
    const bytes = await doc.save();
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    preview.src = state.url;
    result.hidden = false;
    setStatus("Listo para descargar.", "ok");
    ejecutar("pdf-firmar");
  } catch {
    setStatus("No se pudo firmar ese PDF.", "error");
  }
});

document.querySelector("#download").addEventListener("click", () => {
  if (!state.url) return;
  const link = document.createElement("a");
  link.href = state.url;
  link.download = "firmado.pdf";
  document.body.append(link);
  link.click();
  link.remove();
});

async function renderPage() {
  const token = renderToken + 1;
  renderToken = token;
  const pageNumber = Number(paginaInput.value);
  if (!state.pdf || !Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.count) return;
  const page = await state.pdf.getPage(pageNumber);
  if (token !== renderToken) return;
  const base = page.getViewport({ scale: 1 });
  state.pageWidth = base.width;
  state.pageHeight = base.height;
  const viewport = page.getViewport({ scale: Math.min(2, 1400 / base.width) });
  pageCanvas.width = Math.floor(viewport.width);
  pageCanvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: pageContext, viewport }).promise;
  if (token !== renderToken) return;
  signPage.hidden = false;
  placeStamp();
}

function placeStamp() {
  const height = stampHeight();
  state.box.w = Math.min(Math.max(state.box.w, MIN_W), 0.9);
  state.box.x = Math.min(Math.max(state.box.x, 0), Math.max(0, 1 - state.box.w));
  state.box.y = Math.min(Math.max(state.box.y, 0), Math.max(0, 1 - height));
  stamp.style.left = `${state.box.x * 100}%`;
  stamp.style.top = `${state.box.y * 100}%`;
  stamp.style.width = `${state.box.w * 100}%`;
}

function stampHeight() {
  return state.box.w * SIGN_ASPECT * (state.pageWidth / state.pageHeight);
}

function onSheetDown(event) {
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  try {
    signSheet.setPointerCapture(event.pointerId);
  } catch {
    // Algunos navegadores no capturan un puntero que no es táctil.
  }
  if (pointers.size >= 2) {
    drag = null;
    pinch = { dist: pointerDistance(), box: { ...state.box } };
    return;
  }
  if (event.target === resizeHandle) startDrag(event, "resize");
  else if (stamp.contains(event.target)) startDrag(event, "move");
}

function onSheetMove(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pinch && pointers.size >= 2) {
    scaleBox(pinch.box, pointerDistance() / pinch.dist);
    return;
  }
  onDrag(event);
}

function endPointer(event) {
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (drag?.pointerId === event.pointerId) drag = null;
  if (signSheet.hasPointerCapture?.(event.pointerId)) {
    signSheet.releasePointerCapture(event.pointerId);
  }
}

function onWheel(event) {
  event.preventDefault();
  scaleBox(state.box, Math.exp(-event.deltaY * 0.0015));
}

function startDrag(event, mode) {
  event.preventDefault();
  drag = {
    mode,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    box: { ...state.box },
  };
}

function onDrag(event) {
  if (!drag || drag.pointerId !== event.pointerId) return;
  const rect = signSheet.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dx = (event.clientX - drag.x) / rect.width;
  const dy = (event.clientY - drag.y) / rect.height;
  if (drag.mode === "resize") state.box.w = drag.box.w + dx;
  else {
    state.box.x = drag.box.x + dx;
    state.box.y = drag.box.y + dy;
  }
  placeStamp();
}

function scaleBox(base, factor) {
  const baseHeight = base.w * SIGN_ASPECT * (state.pageWidth / state.pageHeight);
  const centerX = base.x + base.w / 2;
  const centerY = base.y + baseHeight / 2;
  const width = Math.min(Math.max(base.w * factor, MIN_W), 0.9);
  const height = width * SIGN_ASPECT * (state.pageWidth / state.pageHeight);
  state.box.w = width;
  state.box.x = centerX - width / 2;
  state.box.y = centerY - height / 2;
  placeStamp();
}

function pointerDistance() {
  const points = [...pointers.values()];
  if (points.length < 2) return 1;
  return Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y));
}

function refreshStamp() {
  stampImg.src = canvas.toDataURL("image/png");
}

function clearPad() {
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function point(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
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

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.className = `status${kind ? ` is-${kind}` : ""}`;
}
