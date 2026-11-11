import { abrir, ejecutar } from "./uso.js";

abrir("texto-diff");

const antes = document.querySelector("#antes");
const despues = document.querySelector("#despues");
const vista = document.querySelector("#vista");
const diff = document.querySelector("#diff");
const statusEl = document.querySelector("#status");
let comparado = null;

document.querySelector("#run").addEventListener("click", () => {
  try {
    comparado = textDiff(antes.value, despues.value);
    pintar();
    const cambios = comparado.original.some((token) => !token.same)
      || comparado.comparar.some((token) => !token.same);
    setStatus(cambios ? "En verde lo que coincide. En rojo lo que cambia." : "Los dos textos son iguales.", "ok");
    ejecutar("texto-diff");
  } catch (error) {
    comparado = null;
    diff.hidden = true;
    setStatus(error.message || "No se pudo comparar.", "error");
  }
});

vista.addEventListener("change", () => {
  if (comparado) pintar();
});

function pintar() {
  const tokens = comparado[vista.value];
  diff.hidden = false;
  diff.replaceChildren();
  const label = document.createElement("p");
  label.className = "diff-caption";
  label.textContent = vista.value === "original" ? "Texto original" : "Texto a comparar";
  diff.append(label);
  const body = document.createElement("p");
  body.className = "diff-body";
  for (const token of tokens) {
    const mark = document.createElement("mark");
    mark.className = token.same ? "diff-same" : "diff-change";
    mark.textContent = token.text;
    body.append(mark);
  }
  diff.append(body);
}

function textDiff(aText, bText) {
  const a = aText.match(/\s+|\S+/g) || [];
  const b = bText.match(/\s+|\S+/g) || [];
  if (a.length > 2500 || b.length > 2500) {
    throw new Error("Cada texto puede tener hasta 2500 palabras.");
  }
  const original = [];
  const comparar = [];
  for (const hunk of hunks(a, b)) {
    if (hunk.kind === "same") {
      push(original, hunk.text, true);
      push(comparar, hunk.text, true);
      continue;
    }
    const pairs = Math.min(hunk.left.length, hunk.right.length);
    for (let index = 0; index < pairs; index += 1) {
      const chars = charDiff(hunk.left[index], hunk.right[index]);
      for (const piece of chars.left) push(original, piece.text, piece.same);
      for (const piece of chars.right) push(comparar, piece.text, piece.same);
    }
    for (const text of hunk.left.slice(pairs)) push(original, text, false);
    for (const text of hunk.right.slice(pairs)) push(comparar, text, false);
  }
  return { original, comparar };
}

function hunks(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const result = [];
  let i = 0;
  let j = 0;
  let left = [];
  let right = [];
  const flush = () => {
    if (!left.length && !right.length) return;
    result.push({ kind: "change", left, right });
    left = [];
    right = [];
  };
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush();
      result.push({ kind: "same", text: a[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push(a[i]);
      i += 1;
    } else {
      right.push(b[j]);
      j += 1;
    }
  }
  while (i < n) {
    left.push(a[i]);
    i += 1;
  }
  while (j < m) {
    right.push(b[j]);
    j += 1;
  }
  flush();
  return result;
}

function charDiff(aText, bText) {
  const a = [...aText];
  const b = [...bText];
  if (a.length * b.length > 1500000) {
    return {
      left: [{ text: aText, same: false }],
      right: [{ text: bText, same: false }],
    };
  }
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const left = [];
  const right = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push(left, a[i], true);
      push(right, b[j], true);
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push(left, a[i], false);
      i += 1;
    } else {
      push(right, b[j], false);
      j += 1;
    }
  }
  while (i < n) {
    push(left, a[i], false);
    i += 1;
  }
  while (j < m) {
    push(right, b[j], false);
    j += 1;
  }
  return { left, right };
}

function push(list, text, same) {
  const last = list[list.length - 1];
  if (last && last.same === same) last.text += text;
  else list.push({ text, same });
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.className = `status${kind ? ` is-${kind}` : ""}`;
}
