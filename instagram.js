import { abrir, ejecutar } from "./uso.js";

abrir("instagram");

const MAX_BYTES = 80 * 1024 * 1024;
const APIS = ["https://rue-cobalt.xenon.zone/"];

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

  const parsed = parseInstagramUrl(linkInput.value);
  if (!parsed) {
    setStatus("Ese link no es un reel, un video o una historia de Instagram.", "error");
    return;
  }

  fetchBtn.disabled = true;
  hideProgress();
  setStatus("Buscando el video…");

  try {
    const found = parsed.story ? await askStory(parsed.url) : await ask(parsed.url, false);
    if (found.network) {
      setStatus(errorText("network", parsed.story), "error");
      return;
    }
    if (!found.file) {
      setStatus(errorText(found.error, parsed.story), "error");
      return;
    }

    let blob = null;
    setPhase("Bajando el video…");
    try {
      blob = await readMp4(found.file.url, (got, total) => reportSpan(got, total));
    } catch (error) {
      hideProgress();
      if (error?.message === "heavy") {
        setStatus(errorText("heavy", parsed.story), "error");
        return;
      }
      const proxied = parsed.story ? { file: null } : await ask(parsed.url, true);
      if (proxied.file && proxied.file.url !== found.file.url) {
        setPhase("Bajando el video…");
        try {
          blob = await readMp4(proxied.file.url, (got, total) => reportSpan(got, total));
          found.file = proxied.file;
        } catch (again) {
          hideProgress();
          if (again?.message === "heavy") {
            setStatus(errorText("heavy", parsed.story), "error");
            return;
          }
        }
      }
    }

    if (!blob) {
      setStatus(errorText("read", parsed.story), "error");
      showDirect(found.file.url);
      return;
    }

    state.blob = blob;
    state.name = found.file.filename;
    state.url = URL.createObjectURL(blob);
    video.src = state.url;
    fileMeta.textContent = metaLine(found.file);
    result.hidden = false;
    updateShareButton();
    hideProgress();
    setStatus(readyText(found.file), "ok");
    ejecutar("instagram");
  } finally {
    hideProgress();
    fetchBtn.disabled = false;
  }
}

function parseInstagramUrl(raw) {
  let text = raw.trim();
  if (!text) return null;
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com" && host !== "m.instagram.com") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "stories" && parts[1] && /^[A-Za-z0-9._]{1,30}$/.test(parts[1])) {
    const mediaId = parts[2] || "";
    if (mediaId && !/^\d{5,25}$/.test(mediaId)) return null;
    const path = mediaId ? `${parts[1]}/${mediaId}` : parts[1];
    return { url: `https://www.instagram.com/stories/${path}/`, story: true };
  }
  if (parts[0] === "s") {
    const code = cleanCode(parts[1] || "");
    if (!code) return null;
    const mediaId = /^\d{5,25}$/.test(url.searchParams.get("story_media_id") || "")
      ? url.searchParams.get("story_media_id")
      : "";
    const query = mediaId ? `?story_media_id=${mediaId}` : "";
    return { url: `https://www.instagram.com/s/${code}${query}`, story: true };
  }

  const kinds = new Set(["reel", "reels", "p", "tv"]);
  for (let index = 0; index < parts.length - 1; index += 1) {
    if (!kinds.has(parts[index])) continue;
    const code = cleanCode(parts[index + 1]);
    if (!code) return null;
    const kind = parts[index] === "reels" ? "reel" : parts[index];
    return { url: `https://www.instagram.com/${kind}/${code}/`, story: false };
  }

  if (parts[0] === "share") {
    const code = cleanCode(parts[1] || "");
    if (code) return { url: `https://www.instagram.com/share/${code}`, story: false };
  }
  return null;
}

function cleanCode(value) {
  const code = String(value || "").split(/[?&#]/)[0];
  return /^[A-Za-z0-9_-]{5,}$/.test(code) ? code : "";
}

async function askStory(pageUrl) {
  try {
    const response = await fetch("/api/historia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: pageUrl }),
    });
    const body = await response.json().catch(() => null);
    if (!body) return { network: !response.ok, error: "empty" };
    if (!response.ok || !body.url) return { error: body.error || "empty" };
    return {
      file: {
        url: body.url,
        filename: body.filename || "instagram_historia.mp4",
        extra: Number(body.extra) || 1,
        story: true,
      },
    };
  } catch {
    return { network: true };
  }
}

async function ask(pageUrl, alwaysProxy) {
  let sawNetwork = true;
  for (const api of APIS) {
    try {
      const response = await fetch(api, {
        method: "POST",
        referrerPolicy: "no-referrer",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: pageUrl,
          videoQuality: "720",
          filenameStyle: "basic",
          downloadMode: "auto",
          ...(alwaysProxy ? { alwaysProxy: true } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      sawNetwork = false;
      if (!body) continue;
      if (body.status === "error") return { error: body.error?.code || "error" };
      if (body.status === "local-processing") return { error: "hls" };
      const file = pickFile(body, pageUrl);
      if (file?.photos) return { error: "photo" };
      if (file) return { file };
      return { error: "empty" };
    } catch {
      // La instancia no respondió. Se prueba la siguiente.
    }
  }
  return sawNetwork ? { network: true } : { error: "empty" };
}

function pickFile(body, pageUrl) {
  const filename = safeName(body.filename, pageUrl);
  if ((body.status === "tunnel" || body.status === "redirect") && body.url) {
    return { url: body.url, filename };
  }
  const picker = Array.isArray(body.picker) ? body.picker : [];
  const videos = picker.filter((item) => item && item.url && (item.type === "video" || item.type === "gif"));
  if (!videos.length && picker.length) return { photos: true };
  if (!videos.length) return null;
  return { url: videos[0].url, filename, extra: videos.length };
}

function safeName(filename, pageUrl) {
  const code = pageUrl.split("/").filter(Boolean).pop() || "video";
  const cleaned = String(filename || "")
    .replace(/[^\p{L}\p{N}._\- ()]+/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return `instagram_${code}.mp4`;
  return cleaned.toLowerCase().endsWith(".mp4") ? cleaned : `${cleaned}.mp4`;
}

function metaLine(file) {
  if (file.extra > 1) return `${file.filename} · 1 de ${file.extra}`;
  return file.filename;
}

async function readMp4(url, onProgress) {
  const response = await fetch(url, { referrerPolicy: "no-referrer" });
  if (!response.ok) throw new Error("read");
  const type = response.headers.get("content-type") || "";
  if (type.includes("text/html")) throw new Error("read");
  const blob = response.body ? await readCapped(response, onProgress) : await response.blob();
  if (!blob.size || blob.size > MAX_BYTES) throw new Error(blob.size > MAX_BYTES ? "heavy" : "read");
  if (!(await looksLikeMp4(blob))) throw new Error("read");
  return new Blob([blob], { type: "video/mp4" });
}

async function readCapped(response, onProgress) {
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  const total = Number(response.headers.get("content-length")) || 0;
  if (total > MAX_BYTES) throw new Error("heavy");
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

function reportSpan(got, total) {
  if (!total) {
    setProgress(null);
    return;
  }
  setProgress(Math.min(got, total) / total);
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

function showDirect(url) {
  directLink.href = url;
  directActions.hidden = false;
}

function readyText(file) {
  if (file.extra > 1 && file.story) return "Video listo. Hay más de una historia en video; esta es una de ellas.";
  if (file.extra > 1) return "Video listo. El post tiene más de uno; este es el primero.";
  return "Video listo.";
}

function errorText(code, story) {
  if (code === "network") return story ? "No se pudo consultar la historia. Probá de nuevo." : "No se pudo consultar el video. Probá de nuevo.";
  if (code === "photo") return story ? "Esta historia no tiene video." : "Este post no tiene video.";
  if (code === "hls") return "Hay video, pero no llega como un MP4 para bajar.";
  if (code === "heavy") return "El video pesa más de 80 MB y no entra entero en el navegador.";
  if (code === "error.api.link.unsupported") return "Ese link no es un reel, un video o una historia de Instagram.";
  if (code === "read") return "El video está en Instagram, pero este navegador no pudo leer el archivo.";
  if (story) return "Esa historia no está disponible. Puede haber vencido o ser privada.";
  return "Instagram no devolvió este video. Puede estar privado, borrado o no disponible.";
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
