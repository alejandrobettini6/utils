import { abrir, ejecutar } from "./uso.js";

abrir("clave");

const largo = document.querySelector("#largo");
const largoNum = document.querySelector("#largo-num");
const claveEl = document.querySelector("#clave");
const copyBtn = document.querySelector("#copy");
const statusEl = document.querySelector("#status");
let clave = "";

largo.addEventListener("input", () => {
  largoNum.textContent = largo.value;
});

document.querySelector("#run").addEventListener("click", () => {
  const sets = ["abcdefghijkmnopqrstuvwxyz"];
  if (document.querySelector("#mayus").checked) sets.push("ABCDEFGHJKLMNPQRSTUVWXYZ");
  if (document.querySelector("#numeros").checked) sets.push("23456789");
  if (document.querySelector("#simbolos").checked) sets.push("!@#$%&*+-?");
  const all = sets.join("");
  const length = Number(largo.value);
  const chars = [];
  sets.forEach((set) => chars.push(pick(set)));
  while (chars.length < length) chars.push(pick(all));
  shuffle(chars);
  clave = chars.join("");
  claveEl.textContent = clave;
  copyBtn.disabled = false;
  setStatus("Lista para copiar.", "ok");
  ejecutar("clave");
});

copyBtn.addEventListener("click", async () => {
  if (!clave) return;
  try {
    await navigator.clipboard.writeText(clave);
    setStatus("Copiada.", "ok");
  } catch {
    setStatus("No se pudo copiar. Seleccioná la clave a mano.", "error");
  }
});

function pick(set) {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return set[bytes[0] % set.length];
}

function shuffle(list) {
  for (let index = list.length - 1; index > 0; index -= 1) {
    const bytes = new Uint32Array(1);
    crypto.getRandomValues(bytes);
    const swap = bytes[0] % (index + 1);
    [list[index], list[swap]] = [list[swap], list[index]];
  }
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.className = `status${kind ? ` is-${kind}` : ""}`;
}
