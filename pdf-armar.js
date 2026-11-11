import { abrir, ejecutar } from "./uso.js";

const { PDFDocument, degrees } = globalThis.PDFLib;
const MODOS = { unir: "pdf-unir", dividir: "pdf-dividir", paginas: "pdf-paginas" };

const statusEl = document.querySelector("#status");
const result = document.querySelector("#result");
const preview = document.querySelector("#preview");
const downloadBtn = document.querySelector("#download");
const listaUnir = document.querySelector("#lista-unir");
const listaPaginas = document.querySelector("#lista-paginas");

const state = {
  unir: [],
  dividir: null,
  paginasBytes: null,
  paginas: [],
  url: "",
  name: "armado.pdf",
};

function modo() {
  const hash = location.hash.replace("#", "");
  return MODOS[hash] ? hash : "unir";
}

function pintarModo() {
  const actual = modo();
  document.querySelectorAll("[data-modo]").forEach((button) => {
    button.classList.toggle("is-on", button.dataset.modo === actual);
  });
  document.querySelector("#panel-unir").hidden = actual !== "unir";
  document.querySelector("#panel-dividir").hidden = actual !== "dividir";
  document.querySelector("#panel-paginas").hidden = actual !== "paginas";
}

document.querySelectorAll("[data-modo]").forEach((button) => {
  button.addEventListener("click", () => {
    location.hash = button.dataset.modo;
  });
});

window.addEventListener("hashchange", () => {
  pintarModo();
  abrir(MODOS[modo()]);
});

document.querySelector("#files-unir").addEventListener("change", (event) => {
  state.unir = [...event.target.files];
  pintarUnir();
});

document.querySelector("#file-dividir").addEventListener("change", (event) => {
  state.dividir = event.target.files?.[0] || null;
  document.querySelector("#nombre-dividir").textContent = state.dividir?.name || "Elegí un PDF";
});

document.querySelector("#file-paginas").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  document.querySelector("#nombre-paginas").textContent = file?.name || "Elegí un PDF";
  state.paginas = [];
  state.paginasBytes = null;
  if (!file) return;
  try {
    state.paginasBytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(state.paginasBytes);
    state.paginas = doc.getPages().map((page, index) => ({
      src: index,
      base: page.getRotation().angle || 0,
      extra: 0,
    }));
    pintarPaginas();
  } catch {
    setStatus("Ese PDF está protegido o no se pudo leer.", "error");
  }
});

document.querySelector("#run-unir").addEventListener("click", unir);
document.querySelector("#run-dividir").addEventListener("click", dividir);
document.querySelector("#run-paginas").addEventListener("click", guardarPaginas);
downloadBtn.addEventListener("click", () => bajar(state.url, state.name));

if (!location.hash) history.replaceState(null, "", "#unir");
pintarModo();
abrir(MODOS[modo()]);

function pintarUnir() {
  listaUnir.replaceChildren(...state.unir.map((file, index) => fila(file.name, [
    ["Subir", () => mover(state.unir, index, -1), pintarUnir],
    ["Bajar", () => mover(state.unir, index, 1), pintarUnir],
  ])));
}

function pintarPaginas() {
  listaPaginas.replaceChildren(...state.paginas.map((page, index) => {
    const giro = (page.base + page.extra) % 360;
    return fila(`Página ${page.src + 1} · ${giro}°`, [
      ["Subir", () => mover(state.paginas, index, -1), pintarPaginas],
      ["Bajar", () => mover(state.paginas, index, 1), pintarPaginas],
      ["Girar", () => { page.extra = (page.extra + 90) % 360; }, pintarPaginas],
    ]);
  }));
}

function fila(label, actions) {
  const row = document.createElement("div");
  row.className = "page-row";
  const name = document.createElement("span");
  name.textContent = label;
  row.append(name);
  for (const [text, step, paint] of actions) {
    const button = document.createElement("button");
    button.className = "btn";
    button.type = "button";
    button.textContent = text;
    button.addEventListener("click", () => {
      step();
      paint();
    });
    row.append(button);
  }
  return row;
}

function mover(list, index, delta) {
  const next = index + delta;
  if (next < 0 || next >= list.length) return;
  const [item] = list.splice(index, 1);
  list.splice(next, 0, item);
}

async function unir() {
  if (state.unir.length < 2) {
    setStatus("Elegí al menos dos PDF.", "error");
    return;
  }
  setStatus("Uniendo…");
  try {
    const out = await PDFDocument.create();
    for (const file of state.unir) {
      const src = await PDFDocument.load(await file.arrayBuffer());
      const copied = await out.copyPages(src, src.getPageIndices());
      copied.forEach((page) => out.addPage(page));
    }
    await mostrar(await out.save(), "unido.pdf");
    ejecutar("pdf-unir");
  } catch {
    setStatus("No se pudo unir. Algún PDF puede estar protegido.", "error");
  }
}

async function dividir() {
  if (!state.dividir) {
    setStatus("Elegí un PDF.", "error");
    return;
  }
  setStatus("Sacando páginas…");
  try {
    const src = await PDFDocument.load(await state.dividir.arrayBuffer());
    const indexes = parseRango(document.querySelector("#rango").value, src.getPageCount());
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, indexes);
    copied.forEach((page) => out.addPage(page));
    await mostrar(await out.save(), "paginas.pdf");
    ejecutar("pdf-dividir");
  } catch (error) {
    setStatus(error.message || "No se pudo dividir ese PDF.", "error");
  }
}

async function guardarPaginas() {
  if (!state.paginasBytes || !state.paginas.length) {
    setStatus("Elegí un PDF.", "error");
    return;
  }
  setStatus("Guardando el orden…");
  try {
    const src = await PDFDocument.load(state.paginasBytes);
    const out = await PDFDocument.create();
    const copied = await out.copyPages(src, state.paginas.map((page) => page.src));
    copied.forEach((page, index) => {
      const giro = (state.paginas[index].base + state.paginas[index].extra) % 360;
      page.setRotation(degrees(giro));
      out.addPage(page);
    });
    await mostrar(await out.save(), "ordenado.pdf");
    ejecutar("pdf-paginas");
  } catch {
    setStatus("No se pudo guardar ese PDF.", "error");
  }
}

function parseRango(text, count) {
  const indexes = [];
  for (const part of text.split(",")) {
    const bit = part.trim();
    if (!bit) continue;
    const range = bit.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      let from = Number(range[1]);
      let to = Number(range[2]);
      if (from > to) [from, to] = [to, from];
      for (let page = from; page <= to; page += 1) indexes.push(page - 1);
    } else if (/^\d+$/.test(bit)) {
      indexes.push(Number(bit) - 1);
    } else {
      throw new Error("Usá números como 1-3, 5.");
    }
  }
  const unique = [...new Set(indexes)].filter((page) => page >= 0 && page < count);
  if (!unique.length) throw new Error("Esas páginas no están en el PDF.");
  return unique;
}

async function mostrar(bytes, name) {
  if (state.url) URL.revokeObjectURL(state.url);
  const blob = new Blob([bytes], { type: "application/pdf" });
  state.url = URL.createObjectURL(blob);
  state.name = name;
  preview.src = state.url;
  result.hidden = false;
  setStatus("Listo para descargar.", "ok");
}

function bajar(url, name) {
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
