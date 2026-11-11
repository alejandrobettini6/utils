import { abrir, ejecutar } from "./uso.js";

abrir("unidades");

const TIPOS = {
  longitud: [
    ["mm", "Milímetros", 0.001],
    ["cm", "Centímetros", 0.01],
    ["m", "Metros", 1],
    ["km", "Kilómetros", 1000],
    ["in", "Pulgadas", 0.0254],
    ["ft", "Pies", 0.3048],
    ["mi", "Millas", 1609.344],
  ],
  peso: [
    ["g", "Gramos", 0.001],
    ["kg", "Kilos", 1],
    ["oz", "Onzas", 0.028349523125],
    ["lb", "Libras", 0.45359237],
  ],
  temperatura: [
    ["c", "Celsius"],
    ["f", "Fahrenheit"],
    ["k", "Kelvin"],
  ],
  tiempo: [
    ["ms", "Milisegundos", 0.001],
    ["s", "Segundos", 1],
    ["min", "Minutos", 60],
    ["h", "Horas", 3600],
  ],
};

const tipo = document.querySelector("#tipo");
const valor = document.querySelector("#valor");
const desde = document.querySelector("#desde");
const hacia = document.querySelector("#hacia");
const resultado = document.querySelector("#resultado");
let contado = false;

tipo.addEventListener("change", fillUnits);
[valor, desde, hacia].forEach((input) => input.addEventListener("input", convert));
tipo.addEventListener("change", convert);

fillUnits();
convert();

function fillUnits() {
  const options = TIPOS[tipo.value];
  const html = options.map(([id, label]) => `<option value="${id}">${label}</option>`).join("");
  desde.innerHTML = html;
  hacia.innerHTML = html;
  hacia.selectedIndex = Math.min(1, options.length - 1);
}

function convert() {
  const number = Number(valor.value);
  if (!Number.isFinite(number)) {
    resultado.textContent = "Escribí un número.";
    return;
  }
  const out = tipo.value === "temperatura"
    ? temperature(number, desde.value, hacia.value)
    : linear(number, tipo.value, desde.value, hacia.value);
  resultado.textContent = format(out);
  if (!contado) {
    contado = true;
    ejecutar("unidades");
  }
}

function linear(number, kind, from, to) {
  const table = Object.fromEntries(TIPOS[kind].map(([id, , factor]) => [id, factor]));
  return (number * table[from]) / table[to];
}

function temperature(number, from, to) {
  let celsius = number;
  if (from === "f") celsius = (number - 32) * 5 / 9;
  if (from === "k") celsius = number - 273.15;
  if (to === "f") return celsius * 9 / 5 + 32;
  if (to === "k") return celsius + 273.15;
  return celsius;
}

function format(number) {
  if (!Number.isFinite(number)) return "No se pudo convertir.";
  const digits = Math.abs(number) >= 100 ? 2 : 4;
  return String(Number(number.toFixed(digits)));
}
