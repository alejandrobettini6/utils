import { GIFEncoder, quantize, applyPalette } from "./vendor/gifenc.js";

const FPS = 10;
const MAX_GIF_WIDTH = 480;
const MAX_GIF_SPAN = 15;
const LIGHT_EDGE = 480;

export function conectarGif(video, { nombre }) {
  const gifBox = document.querySelector("#gif-box");
  const gifStartRange = document.querySelector("#gif-start-range");
  const gifEndRange = document.querySelector("#gif-end-range");
  const gifStartNum = document.querySelector("#gif-start-num");
  const gifEndNum = document.querySelector("#gif-end-num");
  const gifSpan = document.querySelector("#gif-span");
  const gifLimit = document.querySelector("#gif-limit");
  const gifPreviewBtn = document.querySelector("#gif-preview");
  const gifConvertBtn = document.querySelector("#gif-convert");
  const gifMeter = document.querySelector("#gif-meter");
  const gifMeterFill = document.querySelector("#gif-meter-fill");
  const gifResult = document.querySelector("#gif-result");
  const gifImg = document.querySelector("#gif-img");
  const gifCopyBtn = document.querySelector("#gif-copy");
  const gifShareBtn = document.querySelector("#gif-share");
  const gifDownloadBtn = document.querySelector("#gif-download");
  const gifStatus = document.querySelector("#gif-status");

  const state = {
    duration: 0,
    start: 0,
    end: 0,
    converting: false,
    previewing: false,
    blob: null,
    url: "",
    name: "",
  };

  let token = 0;
  let seekToken = 0;
  let previewTimer = 0;
  let frameSeek = 0;

  gifStartRange.addEventListener("input", () => {
    stopPreview();
    setSelection(Number(gifStartRange.value), state.end, "start");
    showFrame(state.start);
  });
  gifEndRange.addEventListener("input", () => {
    stopPreview();
    setSelection(state.start, Number(gifEndRange.value), "end");
    showFrame(state.end);
  });
  gifStartNum.addEventListener("change", () => applyTyped("start", gifStartNum));
  gifEndNum.addEventListener("change", () => applyTyped("end", gifEndNum));
  gifPreviewBtn.addEventListener("click", playSegment);
  gifConvertBtn.addEventListener("click", convert);
  gifCopyBtn.addEventListener("click", copyGif);
  gifShareBtn.addEventListener("click", shareGif);
  gifDownloadBtn.addEventListener("click", downloadGif);
  video.addEventListener("timeupdate", () => {
    if (!state.previewing) return;
    if (video.currentTime >= state.end - 0.03) stopPreview();
  });

  return { listo, limpiar };

  async function listo() {
    const current = token;
    gifBox.hidden = true;
    try {
      await waitForMeta(video);
    } catch {
      if (current !== token) return;
      setStatus("El video está listo. No se pudo leer la duración para armar el gif.", "error");
      return;
    }
    if (current !== token) return;
    if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) {
      setStatus("El video está listo. No se pudo leer la duración para armar el gif.", "error");
      return;
    }
    state.duration = video.duration;
    for (const input of [gifStartRange, gifEndRange, gifStartNum, gifEndNum]) {
      input.max = String(state.duration);
    }
    setSelection(0, Math.min(state.duration, MAX_GIF_SPAN), "end");
    gifBox.hidden = false;
  }

  function limpiar() {
    token += 1;
    stopPreview();
    state.duration = 0;
    state.start = 0;
    state.end = 0;
    state.converting = false;
    gifBox.hidden = true;
    clearGif();
  }

  function applyTyped(source, input) {
    const value = Number.parseFloat(input.value);
    if (!Number.isFinite(value)) {
      render();
      return;
    }
    stopPreview();
    if (source === "start") setSelection(value, state.end, "start");
    else setSelection(state.start, value, "end");
    showFrame(source === "start" ? state.start : state.end);
  }

  function setSelection(start, end, source) {
    const max = state.duration;
    if (!max) return;
    let nextStart = clamp(start, 0, max);
    let nextEnd = clamp(end, 0, max);
    const gap = Math.min(0.1, max);
    if (nextEnd - nextStart < gap) {
      if (source === "end") nextStart = clamp(nextEnd - gap, 0, max);
      else nextEnd = clamp(nextStart + gap, 0, max);
      if (nextEnd - nextStart < gap) {
        nextStart = 0;
        nextEnd = max;
      }
    }
    state.start = clamp(round1(nextStart), 0, max);
    state.end = clamp(round1(nextEnd), 0, max);
    if (state.end < state.start) state.end = clamp(state.start + gap, 0, max);
    render();
  }

  function render() {
    gifStartRange.value = String(state.start);
    gifEndRange.value = String(state.end);
    gifStartNum.value = state.start.toFixed(1);
    gifEndNum.value = state.end.toFixed(1);
    const span = state.end - state.start;
    const tooLong = span > MAX_GIF_SPAN + 0.05;
    gifSpan.textContent = `Tramo de ${span.toFixed(1)} s`;
    gifSpan.classList.toggle("is-bad", tooLong);
    gifLimit.hidden = !tooLong;
    const locked = state.converting;
    gifConvertBtn.disabled = locked || tooLong || span <= 0;
    gifPreviewBtn.disabled = locked || span <= 0;
    gifStartRange.disabled = locked;
    gifEndRange.disabled = locked;
    gifStartNum.disabled = locked;
    gifEndNum.disabled = locked;
  }

  function showFrame(time) {
    if (state.converting || !state.duration) return;
    cancelAnimationFrame(frameSeek);
    frameSeek = requestAnimationFrame(() => {
      if (Math.abs(video.currentTime - time) > 0.04) video.currentTime = time;
    });
  }

  async function playSegment() {
    if (state.converting || state.end <= state.start) return;
    stopPreview();
    state.previewing = true;
    gifPreviewBtn.textContent = "Viendo…";
    try {
      await seekTo(state.start);
      if (!state.previewing) return;
      await video.play();
    } catch {
      stopPreview();
      setStatus("No se pudo reproducir ese tramo.", "error");
      return;
    }
    const ms = Math.max(80, (state.end - state.start) * 1000 + 60);
    previewTimer = window.setTimeout(stopPreview, ms);
  }

  function stopPreview() {
    state.previewing = false;
    window.clearTimeout(previewTimer);
    if (!video.paused) video.pause();
    gifPreviewBtn.textContent = "Ver tramo";
  }

  async function convert() {
    const span = state.end - state.start;
    if (state.converting || span <= 0 || span > MAX_GIF_SPAN + 0.05) return;
    const current = token;
    const start = state.start;
    const end = state.end;
    state.converting = true;
    stopPreview();
    clearGif();
    setProgress(0, true);
    setStatus("Preparando los fotogramas…");
    render();
    const wasMuted = video.muted;
    video.muted = true;
    video.pause();

    try {
      const blob = await encodeClip(current, start, end);
      if (current !== token) return;
      state.blob = blob;
      state.url = URL.createObjectURL(blob);
      state.name = String(nombre() || "video.mp4").replace(/\.mp4$/i, "") + ".gif";
      gifImg.src = state.url;
      gifResult.hidden = false;
      gifShareBtn.hidden = false;
      setProgress(1, false);
      setStatus("Listo para copiar, compartir o descargar.", "ok");
    } catch (error) {
      if (current !== token) return;
      setProgress(0, false);
      setStatus(error.message || "No se pudo convertir el video.", "error");
    } finally {
      video.muted = wasMuted;
      if (current === token) {
        state.converting = false;
        render();
      }
    }
  }

  async function encodeClip(current, start, end) {
    const span = end - start;
    const frameCount = Math.max(1, Math.round(span * FPS));
    const delay = Math.max(20, Math.round((span / frameCount) * 1000));
    const { w, h } = fit(video.videoWidth, video.videoHeight, MAX_GIF_WIDTH);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    const gif = GIFEncoder();

    for (let index = 0; index < frameCount; index += 1) {
      if (current !== token) throw new Error("Se canceló la conversión.");
      const time = start + ((index + 0.5) * span) / frameCount;
      await seekTo(Math.min(time, Math.max(start, end - 0.04)));
      await paintedFrame();
      context.drawImage(video, 0, 0, w, h);
      const { data } = context.getImageData(0, 0, w, h);
      const palette = quantize(data, 256);
      const indexed = applyPalette(data, palette);
      gif.writeFrame(indexed, w, h, { palette, delay, dispose: 1 });
      setProgress((index + 1) / frameCount, true);
      setStatus(`Armando fotograma ${index + 1} de ${frameCount}`);
      await yieldToUi();
    }

    gif.finish();
    return new Blob([gif.bytes()], { type: "image/gif" });
  }

  function seekTo(time) {
    const current = ++seekToken;
    const target = clamp(time, 0, Math.max(0, (video.duration || 0) - 0.001));
    if (Math.abs(video.currentTime - target) < 0.02 && video.readyState >= 2) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("Tardó demasiado en leer un fotograma."));
      }, 8000);
      const onSeeked = () => {
        if (current !== seekToken) return;
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("No se pudo leer el video en ese segundo."));
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        video.removeEventListener("seeked", onSeeked);
        video.removeEventListener("error", onError);
      };
      video.addEventListener("seeked", onSeeked);
      video.addEventListener("error", onError);
      try {
        video.currentTime = target;
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }

  function paintedFrame() {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const timer = window.setTimeout(finish, 90);
      if (typeof video.requestVideoFrameCallback === "function") {
        video.requestVideoFrameCallback(() => {
          window.clearTimeout(timer);
          finish();
        });
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        window.clearTimeout(timer);
        finish();
      }));
    });
  }

  async function copyGif() {
    if (!state.blob) return;
    let supports = true;
    if (typeof ClipboardItem !== "undefined" && typeof ClipboardItem.supports === "function") {
      try {
        supports = ClipboardItem.supports("image/gif");
      } catch {
        supports = true;
      }
    }
    if (!navigator.clipboard || typeof ClipboardItem === "undefined" || !supports) {
      setStatus("Este navegador no puede copiar un gif animado. Usá Compartir o Descargar.", "error");
      return;
    }
    try {
      const item = new ClipboardItem({ "image/gif": Promise.resolve(state.blob) });
      await navigator.clipboard.write([item]);
      setStatus("Copiado. Pegalo en WhatsApp u otro lado.", "ok");
    } catch {
      setStatus("No se pudo copiar el gif animado. Probá Compartir o Descargar.", "error");
    }
  }

  async function shareGif() {
    if (!state.blob || !navigator.share) {
      setStatus("Este navegador no abre el menú para compartir. Probá Descargar.", "error");
      return;
    }
    try {
      await navigator.share({
        files: [new File([state.blob], state.name, { type: "image/gif" })],
        title: state.name,
      });
      setStatus("Listo para compartir.", "ok");
    } catch (error) {
      if (error?.name === "AbortError") return;
      setStatus("No se pudo abrir el menú para compartir. Probá Descargar.", "error");
    }
  }

  function downloadGif() {
    if (!state.url) return;
    const link = document.createElement("a");
    link.href = state.url;
    link.download = state.name;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function clearGif() {
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = "";
    state.blob = null;
    state.name = "";
    gifImg.removeAttribute("src");
    gifResult.hidden = true;
    gifShareBtn.hidden = true;
    setStatus("");
    setProgress(0, false);
  }

  function setProgress(value, visible) {
    gifMeter.hidden = !visible;
    const percent = Math.round(clamp(value, 0, 1) * 100);
    gifMeter.setAttribute("aria-valuenow", String(percent));
    gifMeterFill.style.width = `${percent}%`;
  }

  function setStatus(text, kind) {
    gifStatus.textContent = text;
    gifStatus.hidden = !text;
    gifStatus.classList.toggle("is-error", kind === "error");
    gifStatus.classList.toggle("is-ok", kind === "ok");
  }
}

export async function achicarVideo(video, fileName, onProgress) {
  if (!mimeLiviano(false)) {
    throw new Error("Este navegador no arma un MP4 liviano. El archivo original sigue listo para descargar.");
  }
  const duration = video.duration;
  const width = video.videoWidth;
  const height = video.videoHeight;
  const src = video.currentSrc || video.src;
  if (!src || !Number.isFinite(duration) || duration <= 0 || !width) {
    throw new Error("Todavía no se puede achicar este video.");
  }

  const worker = document.createElement("video");
  worker.playsInline = true;
  worker.preload = "auto";
  worker.src = src;
  let salida = prepararSalida(worker);
  if (salida) void salida.ctx.resume();
  worker.muted = !salida;
  const unlock = worker.play();

  try {
    let packed = null;
    try {
      await datosListos(worker);
      await Promise.resolve(unlock).catch(() => {});
      await irAlInicio(worker);
    } catch {
      salida = null;
    }
    if (salida && mimeLiviano(true)) {
      try {
        packed = await grabar(worker, salida, worker.play(), width, height, fileName, onProgress);
      } catch {
        packed = null;
      }
    }
    if (!packed || !(await duraBien(packed.blob, duration))) {
      await reiniciar(worker, true);
      packed = await grabar(worker, null, worker.play(), width, height, fileName, onProgress);
    }
    if (!(await duraBien(packed.blob, duration))) {
      throw new Error("La versión liviana quedó demasiado corta.");
    }
    return packed;
  } finally {
    worker.pause();
    worker.removeAttribute("src");
    worker.load();
    if (salida) salida.ctx.close().catch(() => {});
  }
}

function prepararSalida(video) {
  if (typeof AudioContext === "undefined") return null;
  try {
    const ctx = new AudioContext();
    const node = ctx.createMediaElementSource(video);
    const dest = ctx.createMediaStreamDestination();
    const quiet = ctx.createGain();
    quiet.gain.value = 0;
    node.connect(dest);
    node.connect(quiet);
    quiet.connect(ctx.destination);
    return { ctx, dest };
  } catch {
    return null;
  }
}

async function reiniciar(video, muted) {
  const src = video.currentSrc || video.src;
  video.pause();
  video.muted = muted;
  if (video.error && src) {
    video.removeAttribute("src");
    video.load();
    video.src = src;
    await datosListos(video);
  }
  await irAlInicio(video);
}

function irAlInicio(video) {
  video.pause();
  if (video.currentTime < 0.05) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, 1500);
    video.addEventListener("seeked", () => {
      window.clearTimeout(timer);
      resolve();
    }, { once: true });
    try {
      video.currentTime = 0;
    } catch {
      window.clearTimeout(timer);
      resolve();
    }
  });
}

async function grabar(video, salida, playback, width, height, fileName, onProgress) {
  const { w, h } = fit(width, height, LIGHT_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { alpha: false });
  const stream = canvas.captureStream(24);
  if (salida) {
    const audio = salida.dest.stream.getAudioTracks().find((track) => track.readyState === "live");
    if (audio) stream.addTrack(audio);
  }
  const mime = mimeLiviano(stream.getAudioTracks().length > 0);
  if (!mime) throw new Error("Este navegador no arma un MP4 liviano. El archivo original sigue listo para descargar.");

  const recorder = new MediaRecorder(stream, {
    mimeType: mime,
    videoBitsPerSecond: 700000,
    audioBitsPerSecond: 64000,
  });
  const chunks = [];
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });
  let settle = null;
  const stopped = new Promise((resolve, reject) => {
    settle = { resolve, reject };
    recorder.addEventListener("stop", () => resolve(new Blob(chunks, { type: "video/mp4" })), { once: true });
    recorder.addEventListener("error", () => reject(new Error("No se pudo achicar el video.")), { once: true });
  });
  recorder.start(250);
  let frame = 0;
  const draw = () => {
    if (video.readyState >= 2) context.drawImage(video, 0, 0, w, h);
    if (onProgress && video.duration) onProgress(Math.min(1, video.currentTime / video.duration));
    if (!video.ended && !video.error) frame = requestAnimationFrame(draw);
  };
  draw();

  try {
    await verReproduccion(video, playback);
    await endedSoon(video);
    if (recorder.state !== "inactive") recorder.stop();
    const blob = await stopped;
    if (!blob.size) throw new Error("La versión liviana quedó vacía.");
    return { blob, name: lightName(fileName) };
  } catch (error) {
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      // El grabador ya se había cerrado.
    }
    settle?.reject?.(error);
    throw error;
  } finally {
    cancelAnimationFrame(frame);
    stream.getVideoTracks().forEach((track) => track.stop());
    if (!video.paused) video.pause();
  }
}

function datosListos(video) {
  if (video.readyState >= 2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => fail(new Error("Todavía no se puede achicar este video.")), 8000);
    const onReady = () => done();
    const onError = () => fail(new Error("No se pudo reproducir el video para achicarlo."));
    function done() {
      cleanup();
      resolve();
    }
    function fail(error) {
      cleanup();
      reject(error);
    }
    function cleanup() {
      window.clearTimeout(timer);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("error", onError);
    }
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("error", onError);
  });
}

function verReproduccion(video, playback) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => fail(new Error("No se pudo reproducir el video para achicarlo.")), 8000);
    const onError = () => fail(new Error("No se pudo reproducir el video para achicarlo."));
    video.addEventListener("error", onError);
    function fail(error) {
      window.clearTimeout(timer);
      video.removeEventListener("error", onError);
      reject(error);
    }
    Promise.resolve(playback).then(() => {
      window.clearTimeout(timer);
      video.removeEventListener("error", onError);
      resolve();
    }, () => fail(new Error("No se pudo reproducir el video para achicarlo.")));
  });
}

function mimeLiviano(conAudio) {
  if (typeof MediaRecorder === "undefined") return "";
  const types = conAudio
    ? ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4"]
    : ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4"];
  return types.find((type) => MediaRecorder.isTypeSupported(type)) || "";
}

function endedSoon(video) {
  if (video.ended) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => fail(new Error("Tardó demasiado en achicar el video.")), Math.max(8000, video.duration * 1000 + 6000));
    let last = video.currentTime;
    let quiet = 0;
    const watch = window.setInterval(() => {
      if (video.error) {
        fail(new Error("No se pudo reproducir el video para achicarlo."));
        return;
      }
      if (video.ended) {
        ok();
        return;
      }
      if (Math.abs(video.currentTime - last) < 0.05) {
        quiet += 300;
        if (quiet > 4000) fail(new Error("La reproducción se frenó antes de terminar."));
      } else {
        quiet = 0;
        last = video.currentTime;
      }
    }, 300);
    const onEnded = () => ok();
    video.addEventListener("ended", onEnded);
    function ok() {
      cleanup();
      resolve();
    }
    function fail(error) {
      cleanup();
      reject(error);
    }
    function cleanup() {
      window.clearTimeout(timer);
      window.clearInterval(watch);
      video.removeEventListener("ended", onEnded);
    }
  });
}

function duraBien(blob, duration) {
  return new Promise((resolve) => {
    const probe = document.createElement("video");
    const url = URL.createObjectURL(blob);
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    const timer = window.setTimeout(() => finish(false), 5000);
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => {
      window.clearTimeout(timer);
      finish(probe.videoWidth > 0 && probe.duration > duration * 0.6);
    }, { once: true });
    probe.addEventListener("error", () => {
      window.clearTimeout(timer);
      finish(false);
    }, { once: true });
    probe.src = url;
  });
}

function lightName(fileName) {
  const base = String(fileName || "video.mp4").replace(/\.mp4$/i, "");
  return `${base}_liviano.mp4`;
}

function fit(width, height, maxEdge) {
  const longest = Math.max(width, height) || maxEdge;
  const scale = Math.min(1, maxEdge / longest);
  let w = Math.max(2, Math.round(width * scale));
  let h = Math.max(2, Math.round(height * scale));
  if (w % 2) w -= 1;
  if (h % 2) h -= 1;
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

function waitForMeta(element) {
  if (element.readyState >= 1 && Number.isFinite(element.duration) && element.duration > 0) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("meta"));
    }, 15000);
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("meta"));
    };
    const cleanup = () => {
      window.clearTimeout(timer);
      element.removeEventListener("loadedmetadata", onReady);
      element.removeEventListener("error", onError);
    };
    element.addEventListener("loadedmetadata", onReady);
    element.addEventListener("error", onError);
  });
}

function yieldToUi() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
