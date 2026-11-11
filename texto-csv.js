import { abrir, ejecutar } from "./uso.js";

abrir("texto-csv");

const entrada = document.querySelector("#entrada");
const salida = document.querySelector("#salida");
const downloadBtn = document.querySelector("#download");
const statusEl = document.querySelector("#status");
let fileName = "";

document.querySelector("#a-json").addEventListener("click", () => {
  try {
    const rows = parseCsv(entrada.value);
    if (rows.length < 2) throw new Error("El CSV necesita una fila de títulos y al menos una fila.");
    const [headers, ...body] = rows;
    const data = body.map((row) => {
      const item = {};
      headers.forEach((header, index) => {
        item[header || `columna_${index + 1}`] = row[index] ?? "";
      });
      return item;
    });
    salida.value = JSON.stringify(data, null, 2);
    fileName = "datos.json";
    downloadBtn.disabled = false;
    setStatus(`${data.length} filas.`, "ok");
    ejecutar("texto-csv");
  } catch (error) {
    setStatus(error.message || "Eso no es un CSV.", "error");
  }
});

document.querySelector("#a-csv").addEventListener("click", () => {
  try {
    const data = JSON.parse(entrada.value);
    if (!Array.isArray(data) || !data.length || typeof data[0] !== "object" || data[0] === null) {
      throw new Error("El JSON tiene que ser una lista de objetos.");
    }
    const headers = [...new Set(data.flatMap((item) => Object.keys(item)))];
    const lines = [headers, ...data.map((item) => headers.map((header) => item[header] ?? ""))];
    salida.value = lines.map((row) => row.map(csvCell).join(",")).join("\n");
    fileName = "datos.csv";
    downloadBtn.disabled = false;
    setStatus(`${data.length} filas.`, "ok");
    ejecutar("texto-csv");
  } catch (error) {
    setStatus(error.message || "Eso no es un JSON de filas.", "error");
  }
});

downloadBtn.addEventListener("click", () => {
  if (!salida.value) return;
  const blob = new Blob([salida.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((item) => item.some((value) => value !== ""));
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.className = `status${kind ? ` is-${kind}` : ""}`;
}
