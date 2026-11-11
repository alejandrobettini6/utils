import { createFile, DataStream } from "./vendor/mp4box/mp4box.all.mjs";
import { abrir, ejecutar } from "./uso.js";

abrir("youtube");

const MAX_BYTES = 40 * 1024 * 1024;
const APIS = ["https://rue-cobalt.xenon.zone/"];
const VIDEO_API = "https://yt.chocolatemoo53.com/api/v1/videos/";
const COMPANIONS = [1, 2, 3, 4, 5, 6, 7, 8].map(
  (number) => `https://yt-comp${number}.chocolatemoo53.com/companion/latest_version`,
);

const form = document.querySelector("#form");
const linkInput = document.querySelector("#link");
const fetchBtn = document.querySelector("#fetch");
const statusEl = document.querySelector("#status");
const meter = document.querySelector("#meter");
const meterFill = document.querySelector("#meter-fill");
const directActions = document.querySelector("#direct-actions");
const directLink = document.querySelector("#direct");
const result = document.querySelector("#result");
const video = document.querySelector("#video");
const fileMeta = document.querySelector("#file-meta");
const shareBtn = document.querySelector("#share");
const downloadBtn = document.querySelector("#download");
const copyStatus = document.querySelector("#copy-status");

const state = {
  blob: null,
  url: "",
  name: "",
};

form.addEventListener("submit", (event) => {
  event.preventDefault();
  downloadFromLink();
});
shareBtn.addEventListener("click", shareVideo);
downloadBtn.addEventListener("click", downloadVideo);

async function downloadFromLink() {
  clearResult();
  hideDirect();
  setCopyStatus("");

  const pageUrl = parseYouTubeUrl(linkInput.value);
  if (!pageUrl) {
    setStatus("Ese link no es un video de YouTube.", "error");
    return;
  }

  fetchBtn.disabled = true;
  hideProgress();
  setStatus("Buscando el video…");

  try {
    const found = await resolveYouTube(pageUrl);
    let blob = null;
    let name = "";
    if (found.file) {
      setPhase("Bajando el video…");
      try {
        blob = await readMp4(found.file.url, (got, total) => reportSpan(got, total, 0, 1));
        name = fileName(found.file.filename, pageUrl);
      } catch {
        // El archivo vino vacío o no es un MP4. Se arma desde video y audio por separado.
        hideProgress();
      }
    }

    if (!blob) {
      try {
        const mixed = await downloadMixed(new URL(pageUrl).searchParams.get("v"));
        blob = mixed.blob;
        name = mixed.name;
      } catch (error) {
        hideProgress();
        if (error?.message === "heavy") {
          setStatus("El video pesa más de 40 MB. En el celular no entra entero.", "error");
        } else if (error?.message === "missing") {
          setStatus("YouTube no devolvió este video. Puede estar privado, con restricción de edad o no disponible.", "error");
        } else {
          setStatus("YouTube no entregó el archivo de ese video. Probá de nuevo.", "error");
        }
        return;
      }
    }

    state.blob = blob;
    state.name = name;
    state.url = URL.createObjectURL(blob);
    video.src = state.url;
    fileMeta.textContent = state.name;
    result.hidden = false;
    updateShareButton();
    hideProgress();
    setStatus("Video listo.", "ok");
    ejecutar("youtube");
  } finally {
    hideProgress();
    fetchBtn.disabled = false;
  }
}

function parseYouTubeUrl(raw) {
  let text = raw.trim();
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  let id = "";

  if (host === "youtu.be") {
    id = parts[0] || "";
  } else if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com" || host === "youtube-nocookie.com") {
    if (url.searchParams.get("v")) id = url.searchParams.get("v");
    else if (parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live" || parts[0] === "v") id = parts[1] || "";
  } else {
    return "";
  }

  id = id.split(/[?&#]/)[0];
  if (!/^[\w-]{11}$/.test(id)) return "";
  return `https://www.youtube.com/watch?v=${id}`;
}

async function resolveYouTube(pageUrl) {
  let sawNetwork = true;
  for (const api of APIS) {
    try {
      const response = await fetch(api, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: pageUrl,
          videoQuality: "720",
          youtubeVideoCodec: "h264",
          youtubeVideoContainer: "mp4",
          filenameStyle: "basic",
        }),
      });
      const body = await response.json().catch(() => null);
      sawNetwork = false;
      if (!body) continue;
      if (body.status === "error") return { error: body.error?.code || "error" };
      if (body.status === "local-processing") return { error: "hls" };
      const file = pickFile(body);
      if (file) return { file };
      return { error: "empty" };
    } catch {
      // La instancia no respondió. Se prueba la siguiente.
    }
  }
  return sawNetwork ? { network: true } : { error: "empty" };
}

function pickFile(body) {
  if ((body.status === "tunnel" || body.status === "redirect") && body.url) {
    return { url: body.url, filename: body.filename || "" };
  }
  const picker = Array.isArray(body.picker) ? body.picker : [];
  const videoItem = picker.find((item) => item && item.url && (item.type === "video" || /\.mp4(\?|$)/i.test(item.url)));
  if (videoItem) return { url: videoItem.url, filename: videoItem.filename || body.filename || "" };
  return null;
}

async function downloadMixed(id) {
  const response = await fetch(`${VIDEO_API}${id}`);
  const info = await response.json().catch(() => null);
  if (!response.ok || !info || info.error || !Array.isArray(info.adaptiveFormats)) {
    throw new Error("missing");
  }

  const pair = pickPair(info.adaptiveFormats);
  if (!pair) throw new Error("heavy");

  const videoSize = sizeOf(pair.video);
  const audioSize = sizeOf(pair.audio);
  const total = videoSize + audioSize;
  setPhase("Bajando el video…");
  const videoBytes = await fetchItag(id, pair.video.itag, (got, fileTotal) => {
    reportSpan(got, fileTotal || videoSize, 0, videoSize / total);
  });
  setPhase("Bajando el audio…");
  const audioBytes = await fetchItag(id, pair.audio.itag, (got, fileTotal) => {
    reportSpan(got, fileTotal || audioSize, videoSize / total, 1);
  });
  setPhase("Armando el archivo…");
  setProgress(1);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const bytes = muxMp4(videoBytes, audioBytes);
  return {
    blob: new Blob([bytes], { type: "video/mp4" }),
    name: fileName(info.title, `https://www.youtube.com/watch?v=${id}`),
  };
}

function pickPair(formats) {
  const videos = uniqueItag(formats.filter((item) => isAvc(item) && heightOf(item) > 0))
    .sort((a, b) => heightOf(b) - heightOf(a) || sizeOf(b) - sizeOf(a));
  const audios = uniqueItag(formats.filter((item) => isAac(item)))
    .sort((a, b) => sizeOf(b) - sizeOf(a));
  for (const video of videos) {
    if (heightOf(video) > 720) continue;
    for (const audio of audios) {
      if (sizeOf(video) + sizeOf(audio) <= MAX_BYTES) return { video, audio };
    }
  }
  return null;
}

function uniqueItag(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const itag = String(item.itag || "");
    if (!itag || seen.has(itag)) continue;
    seen.add(itag);
    unique.push(item);
  }
  return unique;
}

function isAvc(item) {
  return String(item.type || "").startsWith("video/mp4") && String(item.type).includes("avc1");
}

function isAac(item) {
  return String(item.type || "").startsWith("audio/mp4") && String(item.type).includes("mp4a");
}

function heightOf(item) {
  const match = String(item.qualityLabel || "").match(/(\d+)p/);
  return match ? Number(match[1]) : 0;
}

function sizeOf(item) {
  const size = Number(item.clen);
  return Number.isFinite(size) && size > 0 ? size : MAX_BYTES;
}

async function fetchItag(id, itag, onProgress) {
  for (const base of COMPANIONS) {
    try {
      const response = await fetch(`${base}?id=${id}&itag=${itag}&local=true`);
      if (!response.ok) continue;
      const blob = response.body ? await readCapped(response, onProgress) : await response.blob();
      if (!blob.size || blob.size > MAX_BYTES) continue;
      if (!(await looksLikeMp4(blob))) continue;
      return new Uint8Array(await blob.arrayBuffer());
    } catch (error) {
      if (error?.message === "heavy") throw error;
    }
  }
  throw new Error("read");
}

function muxMp4(videoBytes, audioBytes) {
  const video = loadTrack(videoBytes);
  const audio = loadTrack(audioBytes);
  const videoEntry = video.file.getTrackById(video.track.id).mdia.minf.stbl.stsd.entries[0];
  const audioEntry = audio.file.getTrackById(audio.track.id).mdia.minf.stbl.stsd.entries[0];
  const out = createFile();
  const videoId = out.addTrack({
    type: "avc1",
    hdlr: "vide",
    timescale: video.track.timescale,
    width: video.track.video.width,
    height: video.track.video.height,
    avcDecoderConfigRecord: boxBody(videoEntry.boxes.find((box) => box.type === "avcC")),
    language: "und",
  });
  const audioId = out.addTrack({
    type: "mp4a",
    hdlr: "soun",
    timescale: audio.track.timescale,
    samplerate: audio.track.audio.sample_rate << 16,
    channel_count: audio.track.audio.channel_count,
    samplesize: 16,
    description: audioEntry.boxes.find((box) => box.type === "esds"),
    language: "und",
  });
  for (const sample of video.samples) {
    out.addSample(videoId, sample.data, {
      duration: sample.duration,
      dts: sample.dts,
      cts: sample.cts,
      is_sync: sample.is_sync,
    });
  }
  for (const sample of audio.samples) {
    out.addSample(audioId, sample.data, {
      duration: sample.duration,
      dts: sample.dts,
      cts: sample.cts,
      is_sync: true,
    });
  }
  const stream = new DataStream();
  out.write(stream);
  return new Uint8Array(stream.buffer, 0, stream.position);
}

function loadTrack(bytes) {
  const file = createFile(true);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  copy.fileStart = 0;
  let ready = null;
  file.onError = (error) => {
    throw error;
  };
  file.onReady = (info) => {
    const track = info.tracks[0];
    const samples = [];
    file.onSamples = (_id, _user, list) => samples.push(...list);
    file.setExtractionOptions(track.id, null, { nbSamples: Infinity });
    file.start();
    ready = { track, samples, file };
  };
  file.appendBuffer(copy);
  file.flush();
  if (!ready || !ready.samples.length) throw new Error("read");
  return ready;
}

function boxBody(box) {
  const stream = new DataStream();
  box.write(stream);
  const bytes = new Uint8Array(stream.buffer, 0, stream.position).slice(8);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

async function readMp4(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("read");
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/html")) throw new Error("read");
  const blob = response.body ? await readCapped(response, onProgress) : await response.blob();
  if (!blob.size) throw new Error("read");
  if (!(await looksLikeMp4(blob))) throw new Error("read");
  return new Blob([blob], { type: "video/mp4" });
}

async function readCapped(response, onProgress) {
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  const total = Number(response.headers.get("content-length")) || 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BYTES) {
      await reader.cancel();
      throw new Error("heavy");
    }
    if (onProgress) onProgress(received, total);
    chunks.push(value);
  }
  return new Blob(chunks);
}

let phase = "";
let shownPercent = -1;

function setPhase(text) {
  phase = text;
  shownPercent = -1;
  setStatus(text);
}

function reportSpan(got, total, from, to) {
  if (!total) {
    setProgress(null);
    return;
  }
  const ratio = from + (Math.min(got, total) / total) * (to - from);
  setProgress(ratio);
}

function setProgress(ratio) {
  meter.hidden = false;
  if (ratio == null) {
    meter.classList.add("is-busy");
    meter.setAttribute("aria-valuenow", "0");
    meterFill.style.width = "";
    return;
  }
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  meter.classList.remove("is-busy");
  meter.setAttribute("aria-valuenow", String(percent));
  meterFill.style.width = `${percent}%`;
  if (percent !== shownPercent) {
    shownPercent = percent;
    setStatus(`${phase} ${percent}%`);
  }
}

function hideProgress() {
  phase = "";
  shownPercent = -1;
  meter.hidden = true;
  meter.classList.remove("is-busy");
  meter.setAttribute("aria-valuenow", "0");
  meterFill.style.width = "0%";
}

async function looksLikeMp4(blob) {
  const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const mark = String.fromCharCode(...bytes);
  return mark.includes("ftyp");
}

function fileName(filename, pageUrl) {
  const id = new URL(pageUrl).searchParams.get("v");
  const cleaned = String(filename || "")
    .replace(/[^\p{L}\p{N}.\- ()]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return `youtube_${id}.mp4`;
  return cleaned.toLowerCase().endsWith(".mp4") ? cleaned : `${cleaned}.mp4`;
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
  return new File([state.blob], state.name, { type: "video/mp4" });
}

function clearResult() {
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = "";
  state.blob = null;
  state.name = "";
  video.removeAttribute("src");
  video.load();
  fileMeta.textContent = "";
  result.hidden = true;
  shareBtn.hidden = true;
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
