import { delGrupo, grupos, herramientas, recientes } from "./uso.js";

const row = document.querySelector("#recent-row");
const sheet = document.querySelector("#sheet");
const sheetTitle = document.querySelector("#sheet-title");
const sheetList = document.querySelector("#sheet-list");
const buscar = document.querySelector("#buscar");
const verTodas = document.querySelector("#ver-todas");
const volver = document.querySelector("#volver");
const borrar = document.querySelector("#borrar");
const resultados = document.querySelector("#resultados");
const portada = document.querySelector("#portada");
const catalogo = Object.entries(herramientas).map(([id, item]) => ({ id, ...item }));

function paintRecents() {
  row.replaceChildren(...recientes().map((id) => {
    const item = herramientas[id];
    const link = document.createElement("a");
    link.className = "recent-link";
    link.href = item.href;
    link.textContent = item.nombre;
    return link;
  }));
}

document.querySelectorAll("[data-grupo]").forEach((link) => {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    const grupo = link.dataset.grupo;
    sheetTitle.textContent = grupos[grupo].nombre;
    sheetList.replaceChildren(...delGrupo(grupo).map((item) => enlace(item)));
    sheet.showModal();
  });
});

document.querySelector("#search").addEventListener("submit", (event) => {
  event.preventDefault();
  pintarBusqueda(buscar.value);
});

buscar.addEventListener("input", () => {
  if (palabras(buscar.value).length) pintarBusqueda(buscar.value);
  else if (!buscar.value) mostrarGrupos();
  else actualizarControles();
});

verTodas.addEventListener("click", () => {
  buscar.value = "";
  pintarCatalogo();
});

volver.addEventListener("click", () => {
  buscar.value = "";
  mostrarGrupos();
});

borrar.addEventListener("click", () => {
  buscar.value = "";
  mostrarGrupos();
  buscar.focus();
});

sheet.addEventListener("click", (event) => {
  if (event.target === sheet) sheet.close();
});

function pintarBusqueda(texto) {
  const claves = palabras(texto);
  const encontrados = catalogo.filter((item) => {
    const ficha = normalizar(`${item.nombre} ${item.texto} ${nombresGrupo(item)}`);
    return claves.some((clave) => ficha.includes(clave));
  });
  mostrarResultados();
  resultados.replaceChildren();
  if (!encontrados.length) {
    const vacio = document.createElement("p");
    vacio.className = "search-empty";
    vacio.textContent = "Nada con eso.";
    resultados.append(vacio);
    return;
  }
  const lista = document.createElement("div");
  lista.className = "sheet-list";
  lista.append(...encontrados.map((item) => enlace(item, true)));
  resultados.append(lista);
}

function pintarCatalogo() {
  mostrarResultados();
  resultados.replaceChildren();
  for (const [id, grupo] of Object.entries(grupos)) {
    const titulo = document.createElement("h3");
    titulo.className = "search-group";
    titulo.textContent = grupo.nombre;
    const lista = document.createElement("div");
    lista.className = "sheet-list";
    lista.append(...delGrupo(id).map((item) => enlace(item)));
    resultados.append(titulo, lista);
  }
}

function mostrarResultados() {
  portada.hidden = true;
  resultados.hidden = false;
  actualizarControles();
  window.scrollTo(0, 0);
}

function mostrarGrupos() {
  resultados.hidden = true;
  resultados.replaceChildren();
  portada.hidden = false;
  actualizarControles();
}

function actualizarControles() {
  borrar.hidden = !buscar.value;
  volver.hidden = !portada.hidden;
}

function actualizarBorrar() {
  borrar.hidden = !buscar.value;
}

function enlace(item, conGrupo) {
  const tool = document.createElement("a");
  tool.className = "sheet-link";
  tool.href = item.href;
  const name = document.createElement("span");
  name.className = "sheet-name";
  name.textContent = item.nombre;
  const text = document.createElement("span");
  text.className = "sheet-text";
  text.textContent = conGrupo ? `${item.texto} · ${nombresGrupo(item)}` : item.texto;
  tool.append(name, text);
  return tool;
}

function nombresGrupo(item) {
  return [].concat(item.grupo).map((id) => grupos[id].nombre).join(" · ");
}

function normalizar(texto) {
  return texto.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function palabras(texto) {
  const relleno = new Set(["a", "al", "de", "del", "el", "la", "las", "los", "un", "una", "y", "o", "en", "por", "que", "con", "para"]);
  return normalizar(texto).split(/[^a-z0-9]+/).filter((palabra) => palabra && !relleno.has(palabra));
}

paintRecents();
