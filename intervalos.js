import { abrir, ejecutar } from "./uso.js";

const CERCA_MS = 3000;
const ROJO_MS = 500;
const NOMBRES = {
  preparar: "A entrenar",
  actividad: "Actividad",
  descanso: "Descanso entre intervalos",
  entre: "Descanso entre series",
};

const TIMBRES = {
  arrancar: {
    tick: [784, 0.06, 0.16, "triangle"],
    tonos: [[523, 0, 0.08, 0.1, "triangle"], [659, 0.08, 0.08, 0.11, "triangle"], [784, 0.16, 0.08, 0.12, "triangle"], [1046, 0.24, 0.22, 0.13, "triangle"]],
  },
  descanso: {
    tick: [880, 0.05, 0.14, "square"],
    tonos: [[466, 0, 0.16, 0.1, "sine"], [311, 0.18, 0.26, 0.1, "sine"]],
  },
  volver: {
    tick: [880, 0.05, 0.14, "square"],
    tonos: [[698, 0, 0.08, 0.1, "square"], [1046, 0.1, 0.16, 0.11, "square"]],
  },
  fin: {
    tick: [880, 0.08, 0.18, "square"],
    tonos: [[932, 0, 0.13, 0.14, "square"], [784, 0.15, 0.13, 0.14, "square"], [932, 0.3, 0.13, 0.15, "square"], [784, 0.45, 0.13, 0.15, "square"], [932, 0.6, 0.2, 0.16, "square"]],
  },
};

const PALABRAS = { 1: "uno", 2: "dos", 3: "tres" };

let frase;
let armarBtn;
let micro;
let microTexto;
let statusEl;
let setup;
let reloj;
let faseEl;
let tiempoEl;
let avanceEl;
let empezarBtn;
let pausarBtn;
let seguirBtn;
let reiniciarBtn;
let sonidoBtn;
let vozBtn;
let repsEl;
let seriesEl;
let campos;

let fases = [];
let indice = 0;
let finFase = 0;
let restante = 0;
let corriendo = false;
let pausado = false;
let enRojo = false;
let ultimoTac = null;
let raf = 0;
let rojoTimer = 0;
let tictacEncendido = true;
let vozEncendida = true;
const sonidos = new Map();
const reproductores = [];
let pantalla = null;
let totalSeries = 1;
let totalReps = 8;

const U = ["cero", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
const DIEZ = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciseis", "diecisiete", "dieciocho", "diecinueve"];
const DEC = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];

function formas(n) {
  if (n === 0) return ["cero"];
  if (n === 1) return ["un", "uno", "una"];
  if (n < 16) return [n < 10 ? U[n] : DIEZ[n - 10]];
  if (n < 20) return [DIEZ[n - 10]];
  if (n === 20) return ["veinte"];
  if (n < 30) {
    const resto = n - 20;
    const cortas = resto === 1 ? ["veintiun", "veintiuno"] : [`veinti${U[resto]}`];
    const largas = resto === 1 ? ["veinte y un", "veinte y uno", "veinte y una"] : [`veinte y ${U[resto]}`];
    return [...cortas, ...largas];
  }
  if (n < 100) {
    const decena = Math.floor(n / 10);
    const resto = n % 10;
    if (resto === 0) return [DEC[decena]];
    if (resto === 1) return [`${DEC[decena]} y un`, `${DEC[decena]} y uno`, `${DEC[decena]} y una`];
    return [`${DEC[decena]} y ${U[resto]}`];
  }
  if (n === 100) return ["cien", "ciento"];
  return formas(n - 100).map((forma) => `ciento ${forma}`);
}

const FRASES = [];
for (let n = 0; n <= 199; n += 1) {
  for (const forma of formas(n)) FRASES.push([forma, String(n)]);
}
FRASES.sort((a, b) => b[0].length - a[0].length);
const NUM_RE = new RegExp(`\\b(?:${FRASES.map(([forma]) => forma.replace(/ /g, "\\s+")).join("|")})\\b`, "g");
const NUM_MAP = new Map(FRASES);
const TIEMPO = "(?:(\\d+(?:\\.\\d+)?)\\s*(?:minutos?|mins?|min)\\b(?:\\s*(?:y\\s+)?(\\d+(?:\\.\\d+)?)\\s*(?:segundos?|segs?|seg|s)\\b)?|(\\d+(?:\\.\\d+)?)\\s*(?:segundos?|segs?|seg|s)\\b)";

function normalizar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ponerDigitos(texto) {
  return texto.replace(NUM_RE, (hallado) => NUM_MAP.get(hallado.replace(/\s+/g, " ")) || hallado);
}

function aNumero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function msDeGrupos(minutos, segundosExtra, soloSegundos) {
  if (soloSegundos != null && soloSegundos !== "") return Math.round(aNumero(soloSegundos) * 1000);
  if (minutos == null || minutos === "") return null;
  return Math.round((aNumero(minutos) * 60 + (segundosExtra ? aNumero(segundosExtra) : 0)) * 1000);
}

function tiempoDe(texto, etiqueta) {
  const antes = new RegExp(`${TIEMPO}\\s*(?:de\\s+)?(?:${etiqueta})\\b`, "i").exec(texto);
  const despues = new RegExp(`(?:${etiqueta})\\s*(?:de\\s+)?${TIEMPO}\\b`, "i").exec(texto);
  const elegido = !antes ? despues : !despues ? antes : antes.index <= despues.index ? antes : despues;
  if (!elegido) return null;
  const ms = msDeGrupos(elegido[1], elegido[2], elegido[3]);
  return ms == null || ms < 0 ? null : ms;
}

function cuenta(texto, etiqueta) {
  const hallado = new RegExp(`(\\d+)\\s*(?:de\\s+)?(?:${etiqueta})\\b`, "i").exec(texto);
  if (!hallado) return null;
  const n = Number(hallado[1]);
  return n >= 1 ? n : null;
}

export function interpretar(texto) {
  const limpio = ponerDigitos(normalizar(texto));
  return {
    actividad: tiempoDe(limpio, "actividad|ejercicio"),
    descansoIntervalos: tiempoDe(limpio, "descanso\\s+entre\\s+(?:intervalos?|repeticiones|repeticion)"),
    repeticiones: cuenta(limpio, "repeticiones|repeticion|reps|rep"),
    series: cuenta(limpio, "series|serie|vueltas|vuelta"),
    descansoSeries: tiempoDe(limpio, "descanso\\s+entre\\s+series?"),
  };
}

function ponerDuracion(par, ms) {
  const total = Math.min(180 * 60, Math.max(0, Math.round(ms / 1000)));
  par[0].value = String(Math.floor(total / 60));
  par[1].value = String(total % 60);
}

function aplicarFrase(texto) {
  const leido = interpretar(texto);
  const cambios = [
    leido.actividad != null,
    leido.descansoIntervalos != null,
    leido.repeticiones != null,
    leido.series != null,
    leido.descansoSeries != null,
  ].filter(Boolean).length;
  if (!cambios) {
    setStatus("No entendí esa frase. Usá tiempos con actividad, descanso entre intervalos, repeticiones, series y descanso entre series.", "error");
    return;
  }
  if (leido.actividad != null) ponerDuracion(campos.actividad, leido.actividad);
  if (leido.descansoIntervalos != null) ponerDuracion(campos.descanso, leido.descansoIntervalos);
  if (leido.repeticiones != null) repsEl.value = String(Math.min(99, leido.repeticiones));
  if (leido.series != null) seriesEl.value = String(Math.min(99, leido.series));
  if (leido.descansoSeries != null) ponerDuracion(campos.entre, leido.descansoSeries);
  setStatus(cambios === 5 ? "Listo. Revisá los tiempos antes de empezar." : "Actualicé lo que entendí. El resto quedó como estaba.", "ok");
  if (!corriendo) pintarQuieto();
}

function setStatus(texto, tipo) {
  statusEl.hidden = !texto;
  statusEl.textContent = texto;
  statusEl.classList.toggle("is-error", tipo === "error");
  statusEl.classList.toggle("is-ok", tipo === "ok");
}

function duracion(par) {
  let minutos = Math.round(Number(par[0].value));
  let segundos = Math.round(Number(par[1].value));
  if (!Number.isFinite(minutos) || minutos < 0) minutos = 0;
  if (!Number.isFinite(segundos) || segundos < 0) segundos = 0;
  minutos += Math.floor(segundos / 60);
  segundos %= 60;
  return (Math.min(180, minutos) * 60 + segundos) * 1000;
}

function leerDuracion(par) {
  const ms = duracion(par);
  ponerDuracion(par, ms);
  return ms;
}

function entero(el) {
  const n = Math.round(Number(el.value));
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(99, n);
}

function leerEntero(el) {
  const n = entero(el);
  if (n) el.value = String(n);
  return n;
}

function formato(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutos = Math.floor(total / 60);
  const segundos = total % 60;
  return `${minutos}:${String(segundos).padStart(2, "0")}`;
}

function pintarQuieto() {
  const series = entero(seriesEl) || 1;
  const reps = entero(repsEl) || 1;
  reloj.dataset.fase = "actividad";
  reloj.classList.remove("reloj-cerca", "reloj-fin");
  faseEl.textContent = "Actividad";
  tiempoEl.textContent = formato(duracion(campos.actividad));
  avanceEl.textContent = `Serie 1 de ${series} · Repetición 1 de ${reps}`;
}

function botonesEnMarcha(enMarcha, enPausa) {
  empezarBtn.hidden = enMarcha;
  pausarBtn.hidden = !enMarcha || enPausa;
  seguirBtn.hidden = !enPausa;
}

export function anuncio(lista, i) {
  const proxima = lista[i + 1];
  if (!proxima || proxima.tipo === "preparar") return "Listo";
  if (proxima.tipo === "descanso" || proxima.tipo === "entre") return "Descanso";
  if (proxima.tipo === "actividad" && proxima.rep === 1) return `Empieza serie ${proxima.serie}`;
  if (proxima.tipo === "actividad") return "Empiezo";
  return "Listo";
}

export function señalDe(lista, i) {
  const proxima = lista[i + 1];
  if (!proxima) return "fin";
  if (proxima.tipo === "actividad") {
    const actual = lista[i];
    if (!actual || actual.tipo === "preparar") return "arrancar";
    return "volver";
  }
  return "descanso";
}

export function planificar({ actividad, descanso, entre, reps, series }) {
  const lista = [];
  for (let serie = 1; serie <= series; serie += 1) {
    for (let rep = 1; rep <= reps; rep += 1) {
      lista.push({ tipo: "actividad", serie, rep, ms: actividad });
      const ultimaRep = rep === reps;
      const ultimaSerie = serie === series;
      if (!ultimaRep && descanso > 0) lista.push({ tipo: "descanso", serie, rep, ms: descanso });
      if (ultimaRep && !ultimaSerie && entre > 0) lista.push({ tipo: "entre", serie, rep, ms: entre });
    }
  }
  return lista;
}

function armarFases() {
  const actividad = leerDuracion(campos.actividad);
  const descanso = leerDuracion(campos.descanso);
  const entre = leerDuracion(campos.entre);
  const reps = leerEntero(repsEl);
  const series = leerEntero(seriesEl);
  if (!reps || !series) return { error: "Las repeticiones y las series tienen que ser al menos 1." };
  if (actividad <= 0) return { error: "La actividad tiene que durar algo." };
  return { lista: planificar({ actividad, descanso, entre, reps, series }), reps, series };
}

function clip(freq, duracion, volumen, tipo) {
  const clave = `${freq}|${duracion}|${volumen}|${tipo}`;
  const guardado = sonidos.get(clave);
  if (guardado) return guardado;
  const rate = 22050;
  const n = Math.max(1, Math.floor(rate * duracion));
  const bytes = n * 2;
  const buffer = new ArrayBuffer(44 + bytes);
  const view = new DataView(buffer);
  const texto = (offset, valor) => {
    for (let i = 0; i < valor.length; i += 1) view.setUint8(offset + i, valor.charCodeAt(i));
  };
  texto(0, "RIFF");
  view.setUint32(4, 36 + bytes, true);
  texto(8, "WAVE");
  texto(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  texto(36, "data");
  view.setUint32(40, bytes, true);
  for (let i = 0; i < n; i += 1) {
    const ciclo = (freq * i / rate) % 1;
    let onda = Math.sin(2 * Math.PI * ciclo);
    if (tipo === "square") onda = ciclo < 0.5 ? 1 : -1;
    if (tipo === "triangle") onda = 1 - 4 * Math.abs(ciclo - 0.5);
    const env = Math.min(1, i / 70) * Math.min(1, (n - i) / 220);
    const muestra = Math.max(-1, Math.min(1, onda * env * Math.min(1, volumen * 4)));
    view.setInt16(44 + i * 2, muestra * 32767, true);
  }
  const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  sonidos.set(clave, url);
  return url;
}

function reproductorLibre() {
  const libre = reproductores.find((audio) => audio.paused || audio.ended);
  if (libre) return libre;
  const audio = new Audio();
  audio.preload = "auto";
  reproductores.push(audio);
  return audio;
}

function desbloquear() {
  const audio = reproductorLibre();
  audio.src = clip(880, 0.04, 0.2, "square");
  const arranque = audio.play();
  if (arranque && arranque.catch) arranque.catch(() => {});
}

function tocar(freq, duracion, volumen, tipo, espera) {
  const lanzar = () => {
    if (!tictacEncendido || vozEncendida) return;
    const audio = reproductorLibre();
    audio.src = clip(freq, duracion, volumen, tipo);
    audio.currentTime = 0;
    const arranque = audio.play();
    if (arranque && arranque.catch) arranque.catch(() => {});
  };
  if (espera > 0) setTimeout(lanzar, espera * 1000);
  else lanzar();
}

function decir(texto) {
  const voz = window.speechSynthesis;
  if (!voz || !texto) return;
  const fraseDicha = new SpeechSynthesisUtterance(texto);
  fraseDicha.lang = "es-AR";
  fraseDicha.rate = 1.08;
  const voces = voz.getVoices();
  const elegida = voces.find((item) => /es-AR/i.test(item.lang)) || voces.find((item) => /^es/i.test(item.lang));
  if (elegida) fraseDicha.voice = elegida;
  const hablar = () => voz.speak(fraseDicha);
  if (voz.speaking || voz.pending) {
    voz.cancel();
    setTimeout(hablar, 70);
    return;
  }
  hablar();
}

function callar() {
  const voz = window.speechSynthesis;
  if (!voz || (!voz.speaking && !voz.pending)) return;
  voz.cancel();
}

function tac() {
  if (!tictacEncendido) return;
  if (vozEncendida) {
    decir(PALABRAS[ultimoTac] || "");
    return;
  }
  const [freq, duracion, volumen, tipo] = TIMBRES[señalDe(fases, indice)].tick;
  tocar(freq, duracion, volumen, tipo, 0);
}

function alarma() {
  if (!tictacEncendido) return;
  if (vozEncendida) {
    decir(anuncio(fases, indice));
    return;
  }
  for (const [freq, espera, duracion, volumen, tipo] of TIMBRES[señalDe(fases, indice)].tonos) {
    tocar(freq, duracion, volumen, tipo, espera);
  }
}

function ticDelMomento() {
  if (!corriendo || pausado || enRojo || !tictacEncendido || vozEncendida) return;
  const queda = Math.max(0, finFase - performance.now());
  const segundo = Math.ceil(queda / 1000);
  if (segundo <= 0 || segundo > 3) return;
  ultimoTac = segundo;
  tac();
}

async function pedirPantalla() {
  if (!navigator.wakeLock) return;
  try {
    pantalla = await navigator.wakeLock.request("screen");
  } catch {
    pantalla = null;
  }
}

async function soltarPantalla() {
  try {
    await pantalla?.release();
  } catch {
    // La pantalla ya se podía apagar.
  }
  pantalla = null;
}

function pintar(ms) {
  const fase = fases[indice];
  if (!fase) return;
  reloj.classList.toggle("reloj-cerca", ms > 0 && ms <= CERCA_MS && !enRojo);
  reloj.dataset.fase = fase.tipo === "entre" ? "series" : fase.tipo;
  const nombre = NOMBRES[fase.tipo];
  if (faseEl.textContent !== nombre) faseEl.textContent = nombre;
  tiempoEl.textContent = formato(ms);
  avanceEl.textContent = fase.tipo === "preparar"
    ? "Preparáte"
    : `Serie ${fase.serie} de ${totalSeries} · Repetición ${fase.rep} de ${totalReps}`;
}

function entrarFase() {
  if (indice >= fases.length) {
    terminar();
    return;
  }
  const fase = fases[indice];
  restante = fase.ms;
  finFase = performance.now() + fase.ms;
  enRojo = false;
  ultimoTac = null;
  reloj.classList.remove("reloj-fin");
  pintar(fase.ms);
  const segundo = Math.ceil(fase.ms / 1000);
  if (segundo <= 3) {
    ultimoTac = segundo;
    tac();
  }
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function tick(ahora) {
  if (!corriendo || pausado || enRojo) return;
  const queda = Math.min(fases[indice].ms, finFase - ahora);
  if (queda <= 0) {
    alCero();
    return;
  }
  pintar(queda);
  const segundo = Math.ceil(queda / 1000);
  if (segundo <= 3 && segundo !== ultimoTac) {
    ultimoTac = segundo;
    tac();
  }
  raf = requestAnimationFrame(tick);
}

function alCero() {
  enRojo = true;
  pintar(0);
  reloj.classList.add("reloj-fin");
  reloj.classList.remove("reloj-cerca");
  alarma();
  clearTimeout(rojoTimer);
  rojoTimer = setTimeout(() => {
    enRojo = false;
    indice += 1;
    entrarFase();
  }, ROJO_MS);
}

function empezar() {
  const armado = armarFases();
  if (armado.error) {
    setStatus(armado.error, "error");
    return;
  }
  setStatus("");
  ejecutar("intervalos");
  fases = [{ tipo: "preparar", serie: 1, rep: 1, ms: 3000 }, ...armado.lista];
  totalReps = armado.reps;
  totalSeries = armado.series;
  indice = 0;
  corriendo = true;
  pausado = false;
  setup.disabled = true;
  botonesEnMarcha(true, false);
  callar();
  pedirPantalla();
  entrarFase();
  reloj.scrollIntoView({ block: "center" });
}

function pausar() {
  if (!corriendo || pausado || enRojo) return;
  pausado = true;
  restante = Math.max(0, finFase - performance.now());
  cancelAnimationFrame(raf);
  soltarPantalla();
  callar();
  botonesEnMarcha(true, true);
}

function seguir() {
  if (!pausado) return;
  pausado = false;
  finFase = performance.now() + restante;
  botonesEnMarcha(true, false);
  pedirPantalla();
  raf = requestAnimationFrame(tick);
}

function terminar() {
  corriendo = false;
  pausado = false;
  enRojo = false;
  setup.disabled = false;
  soltarPantalla();
  cancelAnimationFrame(raf);
  reloj.classList.remove("reloj-fin", "reloj-cerca");
  reloj.dataset.fase = "listo";
  faseEl.textContent = "Listo";
  tiempoEl.textContent = "Listo";
  avanceEl.textContent = "Terminó la rutina.";
  botonesEnMarcha(false, false);
}

function reiniciar() {
  corriendo = false;
  pausado = false;
  enRojo = false;
  fases = [];
  clearTimeout(rojoTimer);
  cancelAnimationFrame(raf);
  callar();
  setup.disabled = false;
  soltarPantalla();
  botonesEnMarcha(false, false);
  setStatus("");
  pintarQuieto();
}

function conectar() {
  frase = document.querySelector("#frase");
  armarBtn = document.querySelector("#armar");
  micro = document.querySelector("#micro");
  microTexto = document.querySelector("#micro-texto");
  statusEl = document.querySelector("#status");
  setup = document.querySelector("#setup");
  reloj = document.querySelector("#reloj");
  faseEl = document.querySelector("#reloj-fase");
  tiempoEl = document.querySelector("#reloj-tiempo");
  avanceEl = document.querySelector("#reloj-avance");
  empezarBtn = document.querySelector("#empezar");
  pausarBtn = document.querySelector("#pausar");
  seguirBtn = document.querySelector("#seguir");
  reiniciarBtn = document.querySelector("#reiniciar");
  sonidoBtn = document.querySelector("#sonido");
  vozBtn = document.querySelector("#voz");
  repsEl = document.querySelector("#reps");
  seriesEl = document.querySelector("#series");
  campos = {
    actividad: [document.querySelector("#act-min"), document.querySelector("#act-seg")],
    descanso: [document.querySelector("#desc-min"), document.querySelector("#desc-seg")],
    entre: [document.querySelector("#entre-min"), document.querySelector("#entre-seg")],
  };

  abrir("intervalos");
  faseEl.setAttribute("aria-live", "polite");

  armarBtn.addEventListener("click", () => aplicarFrase(frase.value));
  frase.addEventListener("input", (event) => {
    if (event.inputType === "insertFromPaste") aplicarFrase(frase.value);
  });
  setup.addEventListener("input", (event) => {
    if (event.target === frase || corriendo) return;
    pintarQuieto();
  });

  empezarBtn.addEventListener("click", empezar);
  pausarBtn.addEventListener("click", pausar);
  seguirBtn.addEventListener("click", seguir);
  reiniciarBtn.addEventListener("click", reiniciar);
  sonidoBtn.addEventListener("click", () => {
    tictacEncendido = !tictacEncendido;
    sonidoBtn.classList.toggle("is-mudo", !tictacEncendido);
    sonidoBtn.setAttribute("aria-pressed", tictacEncendido ? "false" : "true");
    sonidoBtn.setAttribute("aria-label", tictacEncendido ? "Silenciar los tic tac" : "Activar los tic tac");
    if (!tictacEncendido) {
      callar();
      return;
    }
    if (vozEncendida) return;
    desbloquear();
    ticDelMomento();
  });
  vozBtn.addEventListener("click", () => {
    vozEncendida = !vozEncendida;
    vozBtn.classList.toggle("is-mudo", !vozEncendida);
    vozBtn.setAttribute("aria-pressed", vozEncendida ? "false" : "true");
    vozBtn.setAttribute("aria-label", vozEncendida ? "Silenciar la voz" : "Activar la voz");
    if (vozEncendida) return;
    callar();
    if (!tictacEncendido) return;
    desbloquear();
    ticDelMomento();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && corriendo && !pausado) pedirPantalla();
  });

  const Voz = window.SpeechRecognition || window.webkitSpeechRecognition;
  function soltarMicrofono() {
    micro.classList.remove("is-escuchando");
    micro.setAttribute("aria-pressed", "false");
    microTexto.textContent = "Audio";
  }
  function avisoMicrofono(nombre) {
    if (!window.isSecureContext) {
      setStatus("En el celular Chrome no abre el micrófono por WiFi. Escribí la frase y apretá Armar.", "error");
      return;
    }
    if (nombre === "NotAllowedError" || nombre === "not-allowed") {
      setStatus("Chrome bloqueó el micrófono. Cuando aparezca el aviso, tocá Permitir. Si no aparece, tocá el candado de la barra y activalo.", "error");
      return;
    }
    setStatus("No pude abrir el micrófono. En Chrome, tocá el candado de la barra y elegí Permitir.", "error");
  }
  async function pedirMicrofono() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      avisoMicrofono(window.isSecureContext ? "missing" : "insecure");
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((pista) => pista.stop());
      return true;
    } catch (error) {
      avisoMicrofono(error && error.name);
      return false;
    }
  }
  if (!Voz) {
    micro.addEventListener("click", () => {
      avisoMicrofono(window.isSecureContext ? "missing" : "NotAllowedError");
    });
  } else {
    const reconocimiento = new Voz();
    reconocimiento.lang = "es-AR";
    reconocimiento.interimResults = false;
    reconocimiento.maxAlternatives = 1;
    reconocimiento.onresult = (event) => {
      const dicho = event.results[0][0].transcript;
      frase.value = dicho;
      aplicarFrase(dicho);
    };
    reconocimiento.onerror = (event) => {
      soltarMicrofono();
      avisoMicrofono(event.error);
    };
    reconocimiento.onend = () => {
      soltarMicrofono();
    };
    micro.addEventListener("click", async () => {
      if (micro.getAttribute("aria-pressed") === "true") {
        reconocimiento.stop();
        return;
      }
      setStatus("");
      micro.classList.add("is-escuchando");
      micro.setAttribute("aria-pressed", "true");
      microTexto.textContent = "Escuchando";
      const permitido = await pedirMicrofono();
      if (!permitido) {
        soltarMicrofono();
        return;
      }
      try {
        reconocimiento.start();
      } catch {
        soltarMicrofono();
        avisoMicrofono("not-allowed");
      }
    });
  }
}

if (typeof document !== "undefined") conectar();
