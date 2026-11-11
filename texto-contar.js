import { abrir, ejecutar } from "./uso.js";

abrir("texto-contar");

const texto = document.querySelector("#texto");
const cuenta = document.querySelector("#cuenta");
let contado = false;

texto.addEventListener("input", () => {
  const value = texto.value;
  const words = value.trim() ? value.trim().split(/\s+/).length : 0;
  const letters = (value.match(/\p{L}/gu) || []).length;
  const lines = value ? value.split(/\r?\n/).length : 0;
  cuenta.textContent = `${words} palabras · ${letters} letras · ${value.length} caracteres · ${lines} líneas`;
  if (!contado && value.trim()) {
    contado = true;
    ejecutar("texto-contar");
  }
});
