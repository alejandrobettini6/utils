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
  const file = videoFile();
  let allowed = false;
  try {
    allowed = Boolean(file && navigator.canShare && navigator.canShare({ files: [file] }));
  } catch {
    allowed = false;
  }
  shareBtn.hidden = !allowed;
}

async function shareVideo() {
  const file = videoFile();
  if (!file) return;
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
