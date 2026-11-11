import { GIFEncoder, quantize, applyPalette } from "./vendor/gifenc.js";
import { abrir, ejecutar } from "./uso.js";

abrir("twitter");

const FPS = 10;
const MAX_GIF_WIDTH = 480;
const MAX_GIF_SPAN = 15;

const form = document.querySelector("#form");
const linkInput = document.querySelector("#link");
const fetchBtn = document.querySelector("#fetch");
const statusEl = document.querySelector("#status");
const directActions = document.querySelector("#direct-actions");
const directLink = document.querySelector("#direct");
const result = document.querySelector("#result");
const video = document.querySelector("#video");
const fileMeta = document.querySelector("#file-meta");
const shareBtn = document.querySelector("#share");
const downloadBtn = document.querySelector("#download");
const copyStatus = document.querySelector("#copy-status");
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

const HOSTS = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
  "fxtwitter.com",
  "www.fxtwitter.com",
  "vxtwitter.com",
  "www.vxtwitter.com",
]);

const state = {
  blob: null,
  url: "",
  name: "",
  duration: 0,
  start: 0,
  end: 0,
  converting: false,
  previewing: false,
  gifBlob: null,
  gifUrl: "",
  gifName: "",
};

let runToken = 0;
let seekToken = 0;
let previewTimer = 0;
let frameSeek = 0;

form.addEventListener("submit", (event) => {
  event.preventDefault();
  downloadFromLink();
});

shareBtn.addEventListener("click", shareVideo);
downloadBtn.addEventListener("click", downloadVideo);
gifStartRange.addEventListener("input", () => {
  stopGifPreview();
  setGifSelection(Number(gifStartRange.value), state.end, "start");
  showGifFrame(state.start);
});
gifEndRange.addEventListener("input", () => {
  stopGifPreview();
  setGifSelection(state.start, Number(gifEndRange.value), "end");
  showGifFrame(state.end);
});
gifStartNum.addEventListener("change", () => applyGifTyped("start", gifStartNum));
gifEndNum.addEventListener("change", () => applyGifTyped("end", gifEndNum));
gifPreviewBtn.addEventListener("click", playGifSegment);
gifConvertBtn.addEventListener("click", convertToGif);
gifCopyBtn.addEventListener("click", copyGif);
gifShareBtn.addEventListener("click", shareGif);
gifDownloadBtn.addEventListener("click", downloadGif);
video.addEventListener("timeupdate", () => {
  if (!state.previewing) return;
  if (video.currentTime >= state.end - 0.03) stopGifPreview();
});

async function downloadFromLink() {
  runToken += 1;
  clearResult();
  hideDirect();
  setCopyStatus("");

  const id = parseTweetId(linkInput.value);
  if (!id) {
    setStatus("Ese link no es un tuit.", "error");
    return;
  }

  fetchBtn.disabled = true;
  setStatus("Buscando el video…");

  try {
    const found = await resolveTweet(id);
    if (found.network) {
      setStatus("No se pudo consultar el tuit. Probá de nuevo.", "error");
      return;
    }
    if (!found.tweet) {
      setStatus("X no devolvió este tuit. Puede estar privado, borrado o con restricción de edad.", "error");
      return;
    }

    const clip = pickMp4(found.tweet.clips);
    if (!clip) {
      setStatus(
        found.tweet.sawStream
          ? "Hay video, pero solo llega como HLS, sin un MP4 para bajar."
          : "Este tuit no tiene video.",
        "error",
      );
      return;
    }

    let blob;
    try {
      blob = await readMp4(clip.url);
    } catch {
      setStatus("El video está en X, pero este navegador no pudo leer el archivo.", "error");
      showDirect(clip.url);
      return;
    }

    const name = fileName(found.tweet.user, found.tweet.id || id);
    state.blob = blob;
    state.name = name;
    state.url = URL.createObjectURL(blob);
    video.src = state.url;
    fileMeta.textContent = metaLine(found.tweet.user, clip);
    result.hidden = false;
    updateShareButton();
    setStatus("Video listo.", "ok");
    ejecutar("twitter");
    prepareGif();
  } finally {
    fetchBtn.disabled = false;
  }
}

function parseTweetId(raw) {
  let text = raw.trim();
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }

  if (!HOSTS.has(url.hostname.toLowerCase())) return "";
  const parts = url.pathname.split("/").filter(Boolean);
  const statusAt = parts.findIndex((part) => part === "status" || part === "statuses");
  if (statusAt === -1) return "";
  const match = (parts[statusAt + 1] || "").match(/^\d+/);
  return match ? match[0] : "";
}

async function resolveTweet(id) {
  const fx = await fetchJson(`https://api.fxtwitter.com/status/${id}`);
  if (fx.network) {
    const vx = await fetchJson(`https://api.vxtwitter.com/Twitter/status/${id}`);
    if (vx.network) return { network: true, tweet: null };
    return { network: false, tweet: vx.body ? fromVx(vx.body, id) : null };
  }
  const tweet = fx.body ? fromFx(fx.body, id) : null;
  if (tweet) return { network: false, tweet };

  const vx = await fetchJson(`https://api.vxtwitter.com/Twitter/status/${id}`);
  if (vx.body) {
    const fallback = fromVx(vx.body, id);
    if (fallback) return { network: false, tweet: fallback };
  }
  return { network: Boolean(vx.network && !fx.body), tweet: null };
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, { referrerPolicy: "no-referrer" });
    const type = response.headers.get("content-type") || "";
    if (!type.includes("json")) return { network: false, body: null };
    const body = await response.json().catch(() => null);
    return { network: false, body };
  } catch {
    return { network: true, body: null };
  }
}

function fromFx(body, id) {
  if (body.code !== 200 || !body.tweet) return null;
  const tweet = body.tweet;
  const clips = [];
  let sawStream = false;
  const media = tweet.media || {};
  const items = [...(media.videos || []), ...(media.all || [])];
  for (const item of items) {
    const picked = clipsFromItem(item);
    clips.push(...picked.clips);
    sawStream = sawStream || picked.sawStream;
  }
  return {
    user: tweet.author?.screen_name || "twitter",
    id: String(tweet.id || id),
    clips: uniqueClips(clips),
    sawStream,
  };
}

function fromVx(body, id) {
  if (!body || typeof body.tweetID === "undefined") return null;

  const clips = [];
  let sawStream = false;
  const extended = Array.isArray(body.media_extended) ? body.media_extended : [];
  for (const item of extended) {
    const kind = String(item.type || "").toLowerCase();
    if (kind && kind !== "video" && kind !== "gif") continue;
    const picked = clipsFromItem({
      url: item.url,
      width: item.size?.width || item.width,
      height: item.size?.height || item.height,
      formats: item.formats,
      variants: item.variants,
    });
    clips.push(...picked.clips);
    sawStream = sawStream || picked.sawStream;
  }

  if (!clips.length && !sawStream && Array.isArray(body.mediaURLs)) {
    for (const url of body.mediaURLs) {
      const picked = clipsFromItem({ url });
      clips.push(...picked.clips);
      sawStream = sawStream || picked.sawStream;
    }
  }

  return {
    user: body.user_screen_name || body.user_name || "twitter",
    id: String(body.tweetID || id),
    clips: uniqueClips(clips),
    sawStream,
  };
}

function clipsFromItem(item) {
  const clips = [];
  let sawStream = false;
  const width = numberOrZero(item.width);
  const height = numberOrZero(item.height);
  const formats = [
    ...(Array.isArray(item.formats) ? item.formats : []),
    ...(Array.isArray(item.variants) ? item.variants : []),
  ];

  if (formats.length) {
    for (const format of formats) {
      const url = format.url || "";
      const kind = `${format.container || ""} ${format.content_type || ""}`.toLowerCase();
      if (isStream(url, kind)) {
        sawStream = true;
        continue;
      }
      if (!isMp4(url, kind)) continue;
      const fromUrl = sizeFromUrl(url);
      clips.push({
        url,
        width: numberOrZero(format.width) || fromUrl.width || width,
        height: numberOrZero(format.height) || fromUrl.height || height,
        bitrate: numberOrZero(format.bitrate),
      });
    }
    if (!clips.length && isMp4(item.url || "", item.format || "")) {
      clips.push({ url: item.url, width, height, bitrate: numberOrZero(item.bitrate) });
    }
    return { clips, sawStream };
  }

  const url = item.url || "";
  if (isStream(url, item.format || "")) sawStream = true;
  else if (isMp4(url, item.format || "")) {
    const fromUrl = sizeFromUrl(url);
    clips.push({
      url,
      width: fromUrl.width || width,
      height: fromUrl.height || height,
      bitrate: numberOrZero(item.bitrate),
    });
  }
  return { clips, sawStream };
}

function isMp4(url, kind) {
  const path = stripQuery(url);
  const label = kind.toLowerCase();
  if (isStream(url, kind)) return false;
  return path.endsWith(".mp4") || label.includes("mp4");
}

function isStream(url, kind) {
  const path = stripQuery(url);
  const label = kind.toLowerCase();
  return path.endsWith(".m3u8") || label.includes("m3u8") || label.includes("mpegurl");
}

function stripQuery(url) {
  return String(url || "").split("?")[0].split("#")[0].toLowerCase();
}

function sizeFromUrl(url) {
  const match = String(url || "").match(/(\d{2,5})x(\d{2,5})/);
  if (!match) return { width: 0, height: 0 };
  return { width: Number(match[1]), height: Number(match[2]) };
}

function uniqueClips(clips) {
  const seen = new Set();
  const unique = [];
  for (const clip of clips) {
    if (!clip.url || seen.has(clip.url)) continue;
    seen.add(clip.url);
    unique.push(clip);
  }
  return unique;
}

function pickMp4(clips) {
  if (!clips.length) return null;
  return clips.slice().sort((a, b) => score(b) - score(a))[0];
}

function score(clip) {
  return clip.width * clip.height * 100000 + clip.bitrate;
}

async function readMp4(url) {
  const response = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("read");
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/html")) throw new Error("read");
  const blob = await response.blob();
  if (!blob.size) throw new Error("read");
  const videoType = type.startsWith("video/") ? type.split(";")[0] : "video/mp4";
  return new Blob([blob], { type: videoType });
}

function fileName(user, id) {
  const safe = String(user || "twitter").replace(/[^\w.-]+/g, "").replace(/^\.+/, "") || "twitter";
  return `${safe}_${id}.mp4`;
}

function metaLine(user, clip) {
  const handle = user ? `@${user}` : "Twitter";
  if (clip.width && clip.height) return `${handle} · ${clip.width}×${clip.height}`;
  return handle;
}

function updateShareButton() {
  shareBtn.hidden = !state.blob;
}

async function shareVideo() {
  const file = videoFile();
  if (!file || !navigator.share) {
    setCopyStatus("Este navegador no abre el menú para compartir. Probá Descargar.", "error");
    return;
  }
  try {
    await navigator.share({ files: [file], title: state.name });
    setCopyStatus("Listo para compartir.", "ok");
  } catch (error) {
    if (error?.name === "AbortError") return;
    setCopyStatus("No se pudo abrir el menú para compartir. Probá Descargar.", "error");
  }
}

function downloadVideo() {
  if (!state.url) return;
  const link = document.createElement("a");
  link.href = state.url;
  link.download = state.name;
  document.body.append(link);
  link.click();
  link.remove();
}

function videoFile() {
  if (!state.blob) return null;
  return new File([state.blob], state.name, { type: state.blob.type || "video/mp4" });
}

function clearResult() {
  stopGifPreview();
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = "";
  state.blob = null;
  state.name = "";
  state.duration = 0;
  state.start = 0;
  state.end = 0;
  state.converting = false;
  video.removeAttribute("src");
  video.load();
  fileMeta.textContent = "";
  result.hidden = true;
  shareBtn.hidden = true;
  gifBox.hidden = true;
  clearGif();
}

function showDirect(url) {
  directLink.href = url;
  directActions.hidden = false;
}

function hideDirect() {
  directLink.href = "";
  directActions.hidden = true;
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.classList.toggle("is-error", kind === "error");
  statusEl.classList.toggle("is-ok", kind === "ok");
}

function setCopyStatus(text, kind) {
  copyStatus.textContent = text;
  copyStatus.hidden = !text;
  copyStatus.classList.toggle("is-error", kind === "error");
  copyStatus.classList.toggle("is-ok", kind === "ok");
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

async function prepareGif() {
  const token = runToken;
  gifBox.hidden = true;
  try {
    await waitForMeta(video);
  } catch {
    if (token !== runToken) return;
    setCopyStatus("El video está listo. No se pudo leer la duración para armar el gif.", "error");
    return;
  }
  if (token !== runToken) return;
  if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth) {
    setCopyStatus("El video está listo. No se pudo leer la duración para armar el gif.", "error");
    return;
  }
  state.duration = video.duration;
  for (const input of [gifStartRange, gifEndRange, gifStartNum, gifEndNum]) {
    input.max = String(state.duration);
  }
  setGifSelection(0, Math.min(state.duration, MAX_GIF_SPAN), "end");
  gifBox.hidden = false;
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

function applyGifTyped(source, input) {
  const value = Number.parseFloat(input.value);
  if (!Number.isFinite(value)) {
    renderGifSelection();
    return;
  }
  stopGifPreview();
  if (source === "start") setGifSelection(value, state.end, "start");
  else setGifSelection(state.start, value, "end");
  showGifFrame(source === "start" ? state.start : state.end);
}

function setGifSelection(start, end, source) {
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
  renderGifSelection();
}

function renderGifSelection() {
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

function showGifFrame(time) {
  if (state.converting || !state.duration) return;
  cancelAnimationFrame(frameSeek);
  frameSeek = requestAnimationFrame(() => {
    if (Math.abs(video.currentTime - time) > 0.04) video.currentTime = time;
  });
}

async function playGifSegment() {
  if (state.converting || state.end <= state.start) return;
  stopGifPreview();
  state.previewing = true;
  gifPreviewBtn.textContent = "Viendo…";
  try {
    await seekTo(state.start);
    if (!state.previewing) return;
    await video.play();
  } catch {
    stopGifPreview();
    setGifStatus("No se pudo reproducir ese tramo.", "error");
    return;
  }
  const ms = Math.max(80, (state.end - state.start) * 1000 + 60);
  previewTimer = window.setTimeout(stopGifPreview, ms);
}

function stopGifPreview() {
  state.previewing = false;
  window.clearTimeout(previewTimer);
  if (!video.paused) video.pause();
  gifPreviewBtn.textContent = "Ver tramo";
}

async function convertToGif() {
  const span = state.end - state.start;
  if (state.converting || span <= 0 || span > MAX_GIF_SPAN + 0.05) return;
  const token = runToken;
  const start = state.start;
  const end = state.end;
  state.converting = true;
  stopGifPreview();
  clearGif();
  setGifProgress(0, true);
  setGifStatus("Preparando los fotogramas…");
  renderGifSelection();
  const wasMuted = video.muted;
  video.muted = true;
  video.pause();

  try {
    const blob = await encodeClip(token, start, end);
    if (token !== runToken) return;
    state.gifBlob = blob;
    state.gifUrl = URL.createObjectURL(blob);
    state.gifName = state.name.replace(/\.mp4$/i, "") + ".gif";
    gifImg.src = state.gifUrl;
    gifResult.hidden = false;
    updateGifShare();
    setGifProgress(1, false);
    setGifStatus("Listo para copiar, compartir o descargar.", "ok");
  } catch (error) {
    if (token !== runToken) return;
    setGifProgress(0, false);
    setGifStatus(error.message || "No se pudo convertir el video.", "error");
  } finally {
    video.muted = wasMuted;
    if (token === runToken) {
      state.converting = false;
      renderGifSelection();
    }
  }
}

async function encodeClip(token, start, end) {
  const span = end - start;
  const frameCount = Math.max(1, Math.round(span * FPS));
  const delay = Math.max(20, Math.round((span / frameCount) * 1000));
  const { w, h } = fitGifSize(video.videoWidth, video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const gif = GIFEncoder();

  for (let index = 0; index < frameCount; index += 1) {
    if (token !== runToken) throw new Error("Se canceló la conversión.");
    const time = start + ((index + 0.5) * span) / frameCount;
    await seekTo(Math.min(time, Math.max(start, end - 0.04)));
    await paintedFrame();
    context.drawImage(video, 0, 0, w, h);
    const { data } = context.getImageData(0, 0, w, h);
    const palette = quantize(data, 256);
    const indexed = applyPalette(data, palette);
    gif.writeFrame(indexed, w, h, { palette, delay, dispose: 1 });
    setGifProgress((index + 1) / frameCount, true);
    setGifStatus(`Armando fotograma ${index + 1} de ${frameCount}`);
    await yieldToUi();
  }

  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

function fitGifSize(width, height) {
  const scale = Math.min(1, MAX_GIF_WIDTH / width);
  let w = Math.max(2, Math.round(width * scale));
  let h = Math.max(2, Math.round(height * scale));
  if (w % 2) w -= 1;
  if (h % 2) h -= 1;
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

function seekTo(time) {
  const token = ++seekToken;
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
      if (token !== seekToken) return;
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

function yieldToUi() {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function setGifProgress(value, visible) {
  gifMeter.hidden = !visible;
  const percent = Math.round(clamp(value, 0, 1) * 100);
  gifMeter.setAttribute("aria-valuenow", String(percent));
  gifMeterFill.style.width = `${percent}%`;
}

function updateGifShare() {
  gifShareBtn.hidden = !state.gifBlob;
}

async function copyGif() {
  if (!state.gifBlob) return;
  let supports = true;
  if (typeof ClipboardItem !== "undefined" && typeof ClipboardItem.supports === "function") {
    try {
      supports = ClipboardItem.supports("image/gif");
    } catch {
      supports = true;
    }
  }
  if (!navigator.clipboard || typeof ClipboardItem === "undefined" || !supports) {
    setGifStatus("Este navegador no puede copiar un gif animado. Usá Compartir o Descargar.", "error");
    return;
  }
  try {
    const item = new ClipboardItem({ "image/gif": Promise.resolve(state.gifBlob) });
    await navigator.clipboard.write([item]);
    setGifStatus("Copiado. Pegalo en WhatsApp u otro lado.", "ok");
  } catch {
    setGifStatus("No se pudo copiar el gif animado. Probá Compartir o Descargar.", "error");
  }
}

async function shareGif() {
  const file = gifFile();
  if (!file || !navigator.share) {
    setGifStatus("Este navegador no abre el menú para compartir. Probá Descargar.", "error");
    return;
  }
  try {
    await navigator.share({ files: [file], title: state.gifName });
    setGifStatus("Listo para compartir.", "ok");
  } catch (error) {
    if (error?.name === "AbortError") return;
    setGifStatus("No se pudo abrir el menú para compartir. Probá Descargar.", "error");
  }
}

function downloadGif() {
  if (!state.gifUrl) return;
  const link = document.createElement("a");
  link.href = state.gifUrl;
  link.download = state.gifName;
  document.body.append(link);
  link.click();
  link.remove();
}

function gifFile() {
  if (!state.gifBlob) return null;
  return new File([state.gifBlob], state.gifName, { type: "image/gif" });
}

function clearGif() {
  if (state.gifUrl) URL.revokeObjectURL(state.gifUrl);
  state.gifUrl = "";
  state.gifBlob = null;
  state.gifName = "";
  gifImg.removeAttribute("src");
  gifResult.hidden = true;
  gifShareBtn.hidden = true;
  setGifStatus("");
  setGifProgress(0, false);
}

function setGifStatus(text, kind) {
  gifStatus.textContent = text;
  gifStatus.hidden = !text;
  gifStatus.classList.toggle("is-error", kind === "error");
  gifStatus.classList.toggle("is-ok", kind === "ok");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}
