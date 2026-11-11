import { herramientas, verUso } from "./uso.js";

const form = document.querySelector("#form");
const claveInput = document.querySelector("#clave");
const statusEl = document.querySelector("#status");
const tabla = document.querySelector("#tabla");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.hidden = true;
  tabla.replaceChildren();
  try {
    const filas = await verUso(claveInput.value);
    const porId = new Map(filas.map((fila) => [fila.id, fila]));
    const todas = Object.entries(herramientas).map(([id, item]) => ({
      nombre: item.nombre,
      aperturas: porId.get(id)?.aperturas || 0,
      ejecuciones: porId.get(id)?.ejecuciones || 0,
    }));
    todas.sort((a, b) => b.aperturas - a.aperturas || b.ejecuciones - a.ejecuciones || a.nombre.localeCompare(b.nombre, "es"));
    const table = document.createElement("table");
    table.className = "uso-table";
    table.innerHTML = "<thead><tr><th>Herramienta</th><th>Aperturas</th><th>Ejecuciones</th></tr></thead>";
    const body = document.createElement("tbody");
    for (const fila of todas) {
      const tr = document.createElement("tr");
      for (const value of [fila.nombre, String(fila.aperturas), String(fila.ejecuciones)]) {
        const td = document.createElement("td");
        td.textContent = value;
        tr.append(td);
      }
      body.append(tr);
    }
    table.append(body);
    tabla.append(table);
    statusEl.textContent = "Listo.";
    statusEl.className = "status is-ok";
    statusEl.hidden = false;
  } catch (error) {
    statusEl.textContent = error.message || "No se pudo leer el uso.";
    statusEl.className = "status is-error";
    statusEl.hidden = false;
  }
});
