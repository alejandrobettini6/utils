import { abrir, ejecutar } from "./uso.js";

const { PDFDocument, StandardFonts, rgb } = globalThis.PDFLib;
const mammoth = globalThis.mammoth;

abrir("pdf");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const HEAVY_BYTES = 15 * 1024 * 1024;

const BLOCK_STYLE = {
  h1: { size: 22, bold: true, before: 4, after: 10 },
  h2: { size: 16, bold: true, before: 12, after: 8 },
  h3: { size: 14, bold: true, before: 10, after: 6 },
  h4: { size: 13, bold: true, before: 8, after: 6 },
  h5: { size: 12, bold: true, before: 8, after: 4 },
  h6: { size: 12, bold: true, before: 8, after: 4 },
  p: { size: 12, bold: false, before: 0, after: 8 },
  li: { size: 12, bold: false, before: 0, after: 4 },
};

const CHAR_MAP = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201C": '"',
  "\u201D": '"',
  "\u2013": "-",
  "\u2014": "-",
  "\u2026": "...",
  "\u00A0": " ",
  "\u2022": "-",
  "\u00B7": "-",
};

const dropzone = document.querySelector("#dropzone");
const fileInput = document.querySelector("#file");
const dropTitle = document.querySelector("#drop-title");
const dropHelp = document.querySelector("#drop-help");
const heavyNote = document.querySelector("#heavy-note");
const statusEl = document.querySelector("#status");
const editor = document.querySelector("#editor");
const fileMeta = document.querySelector("#file-meta");
const docPreview = document.querySelector("#doc-preview");
const convertBtn = document.querySelector("#convert");
const result = document.querySelector("#result");
const pdfPreview = document.querySelector("#pdf-preview");
const downloadBtn = document.querySelector("#download");

const state = {
  name: "",
  html: "",
  pdfUrl: "",
  pdfName: "documento.pdf",
  busy: false,
};

let loadToken = 0;

if (!mammoth || !PDFDocument) {
  setStatus("No se pudo cargar el conversor.", "error");
}

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());
dropzone.addEventListener("dragover", () => dropzone.classList.add("is-hot"));
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("is-hot"));
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  event.stopPropagation();
  dropzone.classList.remove("is-hot");
  const file = event.dataTransfer?.files?.[0];
  if (file) loadFile(file);
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) loadFile(file);
});
convertBtn.addEventListener("click", convert);
downloadBtn.addEventListener("click", downloadPdf);

async function loadFile(file) {
  const token = ++loadToken;
  if (isOldDoc(file)) {
    setStatus("Ese formato es un .doc viejo. Guardalo como .docx y volvé a subirlo.", "error");
    return;
  }
  if (!isDocx(file)) {
    setStatus("Elegí un archivo .docx.", "error");
    return;
  }

  state.busy = true;
  state.name = file.name;
  clearPdf();
  result.hidden = true;
  heavyNote.hidden = file.size <= HEAVY_BYTES;
  setStatus("Leyendo el Word…");
  dropzone.classList.add("is-compact");
  dropTitle.textContent = file.name;
  dropHelp.textContent = "Tocá o soltá otro .docx para cambiarlo";
  convertBtn.disabled = true;

  try {
    const arrayBuffer = await file.arrayBuffer();
    if (token !== loadToken) return;
    const converted = await mammoth.convertToHtml({ arrayBuffer }, {
      convertImage: mammoth.images.imgElement((image) => image.read("base64").then((buffer) => ({
        src: `data:${image.contentType};base64,${buffer}`,
      }))),
    });
    if (token !== loadToken) return;
    state.html = sanitizeHtml(converted.value);
    const blocks = blocksFromHtml(state.html);
    if (!blocks.length) {
      editor.hidden = true;
      setStatus("Ese Word no tiene contenido para convertir.", "error");
      return;
    }
    docPreview.innerHTML = state.html;
    fileMeta.textContent = `${file.name} · ${formatBytes(file.size)}`;
    editor.hidden = false;
    convertBtn.disabled = false;
    const partial = converted.messages?.length
      ? "Algunas partes no se pudieron leer tal cual. Igual podés convertirlo."
      : "";
    setStatus(partial);
  } catch {
    if (token !== loadToken) return;
    editor.hidden = true;
    setStatus("No se pudo leer ese Word. Tiene que ser un .docx.", "error");
  } finally {
    if (token === loadToken) state.busy = false;
  }
}

async function convert() {
  if (state.busy || !state.html) return;
  const token = loadToken;
  state.busy = true;
  convertBtn.disabled = true;
  result.hidden = true;
  clearPdf();
  setStatus("Armando el PDF…");
  try {
    const blocks = blocksFromHtml(state.html);
    const bytes = await renderPdf(blocks, state.name);
    if (token !== loadToken) return;
    const blob = new Blob([bytes], { type: "application/pdf" });
    state.pdfUrl = URL.createObjectURL(blob);
    state.pdfName = toPdfName(state.name);
    pdfPreview.src = state.pdfUrl;
    result.hidden = false;
    setStatus("Listo para descargar.", "ok");
    ejecutar("pdf");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    result.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "nearest" });
  } catch {
    if (token !== loadToken) return;
    setStatus("No se pudo armar el PDF.", "error");
  } finally {
    if (token === loadToken) {
      state.busy = false;
      convertBtn.disabled = !state.html;
    }
  }
}

function downloadPdf() {
  if (!state.pdfUrl) return;
  const link = document.createElement("a");
  link.href = state.pdfUrl;
  link.download = state.pdfName;
  document.body.append(link);
  link.click();
  link.remove();
}

async function renderPdf(blocks, title) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(toPdfName(title).replace(/\.pdf$/i, ""));
  pdf.setCreator("utiles");
  const fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
    italic: await pdf.embedFont(StandardFonts.HelveticaOblique),
    boldItalic: await pdf.embedFont(StandardFonts.HelveticaBoldOblique),
  };
  const layout = {
    pdf,
    fonts,
    page: null,
    cursor: 0,
  };
  addPage(layout);

  for (const block of blocks) {
    if (block.type === "image") await drawImage(layout, block.src);
    else if (block.type === "table") drawTable(layout, block);
    else drawTextBlock(layout, block);
  }

  return pdf.save();
}

function addPage(layout) {
  layout.page = layout.pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  layout.cursor = PAGE_HEIGHT - MARGIN;
}

function ensure(layout, height) {
  if (layout.cursor - height < MARGIN) addPage(layout);
}

function drawTextBlock(layout, block) {
  const spec = BLOCK_STYLE[block.type] || BLOCK_STYLE.p;
  const runs = block.runs.map((run) => ({ ...run, bold: run.bold || spec.bold }));
  const indent = block.indent || 0;
  const marker = block.type === "li" ? (block.ordered ? `${block.index}. ` : "- ") : "";
  const markerWidth = marker
    ? layout.fonts.regular.widthOfTextAtSize(encode(layout.fonts.regular, marker, spec.size), spec.size)
    : 0;
  const textIndent = indent + (marker ? Math.max(16, markerWidth) : 0);
  const lines = wrapRuns(layout.fonts, runs, CONTENT_WIDTH - textIndent, spec.size);
  if (!lines.length && !marker) return;
  const lineHeight = spec.size * 1.35;
  const atTop = layout.cursor >= PAGE_HEIGHT - MARGIN - 0.5;
  if (!atTop && spec.before) layout.cursor -= spec.before;

  const drawn = lines.length ? lines : [[]];
  drawn.forEach((line, index) => {
    ensure(layout, lineHeight);
    const baseline = layout.cursor - spec.size;
    if (marker && index === 0) {
      layout.page.drawText(encode(layout.fonts.regular, marker, spec.size), {
        x: MARGIN + indent,
        y: baseline,
        size: spec.size,
        font: layout.fonts.regular,
        color: rgb(0.14, 0.11, 0.08),
      });
    }
    let x = MARGIN + textIndent;
    for (const piece of line) {
      layout.page.drawText(piece.text, {
        x,
        y: baseline,
        size: spec.size,
        font: piece.font,
        color: rgb(0.14, 0.11, 0.08),
      });
      const width = piece.font.widthOfTextAtSize(piece.text, spec.size);
      if (piece.underline) {
        layout.page.drawLine({
          start: { x, y: baseline - 1.5 },
          end: { x: x + width, y: baseline - 1.5 },
          thickness: 0.6,
          color: rgb(0.14, 0.11, 0.08),
        });
      }
      x += width;
    }
    layout.cursor -= lineHeight;
  });
  layout.cursor -= spec.after;
}

function drawTable(layout, table) {
  const cols = Math.max(1, ...table.rows.map((row) => row.length));
  const colWidth = CONTENT_WIDTH / cols;
  const size = 11;
  const lineHeight = size * 1.3;
  const pad = 4;
  layout.cursor -= 4;
  for (const row of table.rows) {
    const cellLines = Array.from({ length: cols }, (_, index) => {
      const cell = row[index];
      return cell ? wrapRuns(layout.fonts, cell.runs, colWidth - pad * 2, size) : [];
    });
    const rowCount = Math.max(1, ...cellLines.map((lines) => lines.length));
    const rowHeight = rowCount * lineHeight + pad * 2;
    ensure(layout, rowHeight);
    const top = layout.cursor;
    for (let index = 0; index < cols; index += 1) {
      const x = MARGIN + index * colWidth;
      layout.page.drawRectangle({
        x,
        y: top - rowHeight,
        width: colWidth,
        height: rowHeight,
        borderWidth: 0.8,
        borderColor: rgb(0.14, 0.11, 0.08),
        color: rgb(1, 1, 1),
      });
      let y = top - pad;
      for (const line of cellLines[index]) {
        const baseline = y - size;
        let textX = x + pad;
        for (const piece of line) {
          layout.page.drawText(piece.text, {
            x: textX,
            y: baseline,
            size,
            font: piece.font,
            color: rgb(0.14, 0.11, 0.08),
          });
          textX += piece.font.widthOfTextAtSize(piece.text, size);
        }
        y -= lineHeight;
      }
    }
    layout.cursor -= rowHeight;
  }
  layout.cursor -= 8;
}

async function drawImage(layout, src) {
  const parsed = parseDataUrl(src);
  if (!parsed) return;
  let image;
  try {
    if (parsed.type.includes("png")) image = await layout.pdf.embedPng(parsed.bytes);
    else if (parsed.type.includes("jpeg") || parsed.type.includes("jpg")) image = await layout.pdf.embedJpg(parsed.bytes);
    else return;
  } catch {
    return;
  }
  const maxHeight = PAGE_HEIGHT - MARGIN * 2;
  const scale = Math.min(1, CONTENT_WIDTH / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ensure(layout, height);
  layout.page.drawImage(image, {
    x: MARGIN,
    y: layout.cursor - height,
    width,
    height,
  });
  layout.cursor -= height + 10;
}

function wrapRuns(fonts, runs, maxWidth, size) {
  const lines = [];
  let line = [];
  let width = 0;
  const flush = () => {
    if (line.length) lines.push(line);
    line = [];
    width = 0;
  };
  const pushToken = (token, run) => {
    const font = fontFor(fonts, run);
    const safe = encode(font, token, size);
    if (!safe) return;
    const pieces = breakToWidth(font, safe, size, maxWidth);
    for (const piece of pieces) {
      const pieceWidth = font.widthOfTextAtSize(piece, size);
      const space = /^\s+$/.test(piece);
      if (width > 0 && width + pieceWidth > maxWidth && !space) flush();
      if (space && width === 0) continue;
      line.push({ text: piece, font, underline: run.underline });
      width += pieceWidth;
    }
  };

  for (const run of runs) {
    const chunks = run.text.split("\n");
    chunks.forEach((chunk, index) => {
      for (const token of chunk.split(/(\s+)/).filter(Boolean)) pushToken(token, run);
      if (index < chunks.length - 1) flush();
    });
  }
  flush();
  return lines;
}

function breakToWidth(font, text, size, maxWidth) {
  if (maxWidth <= 0 || font.widthOfTextAtSize(text, size) <= maxWidth) return [text];
  const parts = [];
  let current = "";
  for (const char of text) {
    const next = current + char;
    if (current && font.widthOfTextAtSize(next, size) > maxWidth) {
      parts.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts.length ? parts : [text];
}

function fontFor(fonts, run) {
  if (run.bold && run.italic) return fonts.boldItalic;
  if (run.bold) return fonts.bold;
  if (run.italic) return fonts.italic;
  return fonts.regular;
}

function encode(font, text, size) {
  let mapped = "";
  for (const char of text) mapped += CHAR_MAP[char] ?? char;
  try {
    font.widthOfTextAtSize(mapped, size);
    return mapped;
  } catch {
    let out = "";
    for (const char of mapped) {
      try {
        font.widthOfTextAtSize(char, size);
        out += char;
      } catch {
        out += "?";
      }
    }
    return out;
  }
}

function blocksFromHtml(html) {
  const documentHtml = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  return readBlocks(documentHtml.body, 0).filter(hasContent);
}

function readBlocks(element, indent) {
  const blocks = [];
  for (const child of element.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent.trim()) {
        blocks.push({ type: "p", indent, runs: [plainRun(child.textContent.trim())] });
      }
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag) || tag === "p" || tag === "blockquote") {
      const runs = inlineRuns(child);
      if (runs.some((run) => run.text.trim())) blocks.push({ type: tag === "blockquote" ? "p" : tag, indent, runs });
      for (const image of child.querySelectorAll("img")) {
        blocks.push({ type: "image", src: image.getAttribute("src") || "" });
      }
    } else if (tag === "ul" || tag === "ol") {
      blocks.push(...readList(child, indent));
    } else if (tag === "table") {
      for (const image of child.querySelectorAll("img")) {
        blocks.push({ type: "image", src: image.getAttribute("src") || "" });
      }
      const table = readTable(child);
      if (table.rows.length) blocks.push(table);
    } else if (tag === "img") {
      blocks.push({ type: "image", src: child.getAttribute("src") || "" });
    } else if (tag === "div" || tag === "section" || tag === "article") {
      blocks.push(...readBlocks(child, indent));
    } else {
      const runs = inlineRuns(child);
      if (runs.some((run) => run.text.trim())) blocks.push({ type: "p", indent, runs });
    }
  }
  return blocks;
}

function readList(list, indent) {
  const ordered = list.tagName.toLowerCase() === "ol";
  const blocks = [];
  let index = 1;
  for (const item of list.children) {
    if (item.tagName.toLowerCase() !== "li") continue;
    const clone = item.cloneNode(true);
    clone.querySelectorAll("ul, ol, table").forEach((node) => node.remove());
    blocks.push({
      type: "li",
      indent,
      ordered,
      index: index++,
      runs: inlineRuns(clone),
    });
    for (const image of item.querySelectorAll("img")) {
      if (image.closest("li") === item) {
        blocks.push({ type: "image", src: image.getAttribute("src") || "" });
      }
    }
    for (const child of item.children) {
      const tag = child.tagName.toLowerCase();
      if (tag === "ul" || tag === "ol") blocks.push(...readList(child, indent + 16));
      else if (tag === "table") {
        const table = readTable(child);
        if (table.rows.length) blocks.push(table);
      }
    }
  }
  return blocks;
}

function readTable(table) {
  const rows = [];
  for (const row of table.rows) {
    const cells = [];
    for (const cell of row.children) {
      const tag = cell.tagName.toLowerCase();
      if (tag !== "td" && tag !== "th") continue;
      const runs = inlineRuns(cell).map((run) => ({ ...run, bold: run.bold || tag === "th" }));
      cells.push({ runs });
    }
    if (cells.length) rows.push(cells);
  }
  return { type: "table", rows };
}

function inlineRuns(element) {
  const runs = [];
  walk(element, { bold: false, italic: false, underline: false });
  return runs.filter((run) => run.text.length);

  function walk(node, style) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!node.textContent.trim() && !node.textContent.includes(" ")) return;
      const text = node.textContent.replace(/[ \t\r\f\v]+/g, " ").replace(/\n+/g, "\n");
      if (text.trim() || text === " ") runs.push({ text, ...style });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      runs.push({ text: "\n", ...style });
      return;
    }
    if (tag === "img" || tag === "ul" || tag === "ol" || tag === "table" || tag === "script") return;
    const next = { ...style };
    if (tag === "strong" || tag === "b") next.bold = true;
    if (tag === "em" || tag === "i") next.italic = true;
    if (tag === "u") next.underline = true;
    for (const child of node.childNodes) walk(child, next);
  }
}

function hasContent(block) {
  if (block.type === "image") return Boolean(block.src);
  if (block.type === "table") return block.rows.some((row) => row.some((cell) => cell.runs.some((run) => run.text.trim())));
  return block.runs?.some((run) => run.text.trim());
}

function plainRun(text) {
  return { text, bold: false, italic: false, underline: false };
}

function sanitizeHtml(html) {
  const template = document.createElement("template");
  template.innerHTML = html;
  template.content.querySelectorAll("script, iframe, object, embed, link").forEach((node) => node.remove());
  return template.innerHTML;
}

function parseDataUrl(src) {
  const match = /^data:([^;,]+);base64,([\s\S]+)$/.exec(src || "");
  if (!match) return null;
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return { type: match[1], bytes };
}

function isDocx(file) {
  return /\.docx$/i.test(file.name) || file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

function isOldDoc(file) {
  return /\.doc$/i.test(file.name) && !/\.docx$/i.test(file.name);
}

function toPdfName(name) {
  const base = name.replace(/\.docx$/i, "").trim() || "documento";
  return `${base}.pdf`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clearPdf() {
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = "";
  pdfPreview.removeAttribute("src");
}

function setStatus(text, kind) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.classList.toggle("is-error", kind === "error");
  statusEl.classList.toggle("is-ok", kind === "ok");
}
