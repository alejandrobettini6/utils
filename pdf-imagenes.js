import { abrir, ejecutar } from "./uso.js";

abrir("pdf-imagenes");

const { PDFDocument } = globalThis.PDFLib;
const MAX_SIDE = 1600;
const filesInput = document.querySelector("#files");
const dropTitle = document.querySelector("#drop-title");
const lista = document.querySelector("#lista");
const statusEl = document.querySelector("#status");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");
const state = { files: [], url: "" };

filesInput.addEventListener("change", () => {
  state.files = [...filesInput.files];
  pintar();
});

function pintar() {
  dropTitle.textContent = state.files.length ? `${state.files.length} fotos` : "Elegí una o más fotos";
  lista.replaceChildren(...state.files.map((file, index) => {
    const row = document.createElement("div");
    row.className = "page-row";
    const name = document.createElement("span");
    name.textContent = file.name;
    row.append(name);
    for (const [text, delta] of [["Subir", -1], ["Bajar", 1]]) {
      const button = document.createElement("button");
      button.className = "btn";
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", () => {
        const next = index + delta;
        if (next < 0 || next >= state.files.length) return;
        const [item] = state.files.splice(index, 1);
        state.files.splice(next, 0, item);
        pintar();
      });
      row.append(button);
    }
    return row;
  }));
}

document.querySelector("#run").addEventListener("click", async () => {
  if (!state.files.length) {
    setStatus("Elegí al menos una foto.", "error");
    return;
  }
  setStatus("Armando el PDF…");
  try {
    const doc = await PDFDocument.create();
    for (const file of state.files) {
      const png = await toPng(file);
      const image = await doc.embedPng(png.bytes);
      const page = doc.addPage([png.w, png.h]);
      page.drawImage(image, { x: 0, y: 0, width: png.w, height: png.h });
    }
    const bytes = await doc.save();
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    preview.src = state.url;
    result.hidden = false;
    setStatus("Listo para descargar.", "ok");
    ejecutar("pdf-imagenes");
  } catch (error) {
    setStatus(error.message || "No se pudo armar el PDF.", "error");
  }
});

document.querySelector("#download").addEventListener("click", () => {
  if (!state.url) return;
  const link = document.createElement("a");
  link.href = state.url;
  link.download = "imagenes.pdf";
  document.body.append(link);
  link.click();
  link.remove();
});

async function toPng(file) {
  const url = URL.createObjectURL(file);
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("No se pudo leer una de las fotos."));
    element.src = url;
  });
  URL.revokeObjectURL(url);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d").drawImage(image, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo preparar una foto.");
  return { bytes: await blob.arrayBuffer(), w, h };
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.className = `status${kind ? ` is-${kind}` : ""}`;
}
