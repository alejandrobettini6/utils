import { abrir, ejecutar } from "./uso.js";

abrir("imagen-marca");

const { PDFDocument, StandardFonts, rgb, degrees } = globalThis.PDFLib;
const MAX_SIDE = 2400;
const fileInput = document.querySelector("#file");
const dropTitle = document.querySelector("#drop-title");
const form = document.querySelector("#form");
const texto = document.querySelector("#texto");
const lugar = document.querySelector("#lugar");
const inclinacion = document.querySelector("#inclinacion");
const tamano = document.querySelector("#tamano");
const tamanoNum = document.querySelector("#tamano-num");
const opacidad = document.querySelector("#opacidad");
const opacidadNum = document.querySelector("#opacidad-num");
const statusEl = document.querySelector("#status");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");
const pdfPreview = document.querySelector("#pdf-preview");
const downloadBtn = document.querySelector("#download");

const state = { file: null, url: "", name: "" };

opacidad.addEventListener("input", () => {
  opacidadNum.textContent = opacidad.value;
});

tamano.addEventListener("input", () => {
  tamanoNum.textContent = tamano.value;
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  document.querySelector("#preview-btn").click();
});

document.querySelector("#preview-btn").addEventListener("click", async () => {
  if (!state.file) return;
  const mark = texto.value.trim();
  if (!mark) return;
  setStatus("Armando la vista previa…");
  try {
    if (isPdf(state.file)) await markPdf(mark);
    else await markImage(mark);
    ejecutar("imagen-marca");
  } catch (error) {
    setStatus(error.message || "No se pudo marcar el archivo.", "error");
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

async function markImage(mark) {
  const image = await loadImage(state.file);
  const size = fit(image.naturalWidth || image.width, image.naturalHeight || image.height, MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = size.w;
  canvas.height = size.h;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, size.w, size.h);
  const fontSize = Number(tamano.value);
  context.font = `700 ${fontSize}px Nunito, sans-serif`;
  context.fillStyle = `rgba(36, 28, 22, ${Number(opacidad.value) / 100})`;
  context.textBaseline = "middle";
  context.textAlign = "center";
  const width = context.measureText(mark).width;
  const point = place(lugar.value, size.w, size.h, width, fontSize);
  context.save();
  context.translate(point.x, point.y);
  if (inclinacion.value === "diagonal") context.rotate(-Math.PI / 5);
  context.fillText(mark, 0, 0);
  context.restore();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo armar la imagen.");
  showResult(blob, `${baseName(state.file.name, "imagen")}-marca.png`, "image");
  setStatus("Vista previa lista. Si te cierra, descargala.", "ok");
}

async function markPdf(mark) {
  let doc;
  try {
    doc = await PDFDocument.load(await state.file.arrayBuffer());
  } catch {
    throw new Error("Ese PDF está protegido o no se pudo leer.");
  }
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = Number(tamano.value);
  const textWidth = font.widthOfTextAtSize(mark, fontSize);
  const angle = inclinacion.value === "diagonal" ? Math.PI / 5 : 0;
  for (const page of doc.getPages()) {
    const origin = watermarkOrigin(page.getWidth(), page.getHeight(), textWidth, fontSize, lugar.value, angle);
    page.drawText(mark, {
      x: origin.x,
      y: origin.y,
      size: fontSize,
      font,
      color: rgb(0.14, 0.11, 0.09),
      opacity: Number(opacidad.value) / 100,
      rotate: degrees((angle * 180) / Math.PI),
    });
  }
  const bytes = await doc.save();
  showResult(new Blob([bytes], { type: "application/pdf" }), `${baseName(state.file.name, "documento")}-marca.pdf`, "pdf");
  const pages = doc.getPageCount();
  setStatus(pages === 1 ? "Marca puesta en la página." : `Marca puesta en las ${pages} páginas.`, "ok");
}

function watermarkOrigin(pageWidth, pageHeight, textWidth, fontSize, where, angle) {
  const pad = Math.max(fontSize, 24);
  let centerX = pageWidth / 2;
  let centerY = pageHeight / 2;
  if (where === "abajo") centerY = pad;
  if (where === "esquina") {
    centerX = pageWidth - textWidth / 2 - pad;
    centerY = pad;
  }
  const rise = fontSize * 0.35;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: centerX - (textWidth / 2 * cos - rise * sin),
    y: centerY - (textWidth / 2 * sin + rise * cos),
  };
}

function showResult(blob, name, kind) {
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(blob);
  state.name = name;
  preview.hidden = kind !== "image";
  pdfPreview.hidden = kind !== "pdf";
  if (kind === "image") preview.src = state.url;
  else pdfPreview.src = state.url;
  result.hidden = false;
}

function isPdf(file) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function baseName(name, fallback) {
  return name.replace(/\.[^.]+$/, "") || fallback;
}

function place(where, width, height, textWidth, fontSize) {
  const pad = Math.max(fontSize, 24);
  if (where === "centro") return { x: width / 2, y: height / 2 };
  if (where === "abajo") return { x: width / 2, y: height - pad };
  return { x: width - textWidth / 2 - pad, y: height - pad };
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

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.className = `status${kind ? ` is-${kind}` : ""}`;
}
