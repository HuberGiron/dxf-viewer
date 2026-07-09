import { parseSvgToGeometry, parsePdfToGeometry, geometryBBox, bboxValid } from "./vector-utils.js";

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function getFileFormat(file) {
  const name = (file?.name || "").toLowerCase();
  if (name.endsWith(".dxf")) return "dxf";
  if (name.endsWith(".svg")) return "svg";
  if (name.endsWith(".pdf")) return "pdf";
  return "";
}

function drawPreview(canvas, geometry) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--viewer-bg").trim() || "#ffffff";
  ctx.fillRect(0, 0, W, H);

  const b = geometryBBox(geometry);
  if (!bboxValid(b)) return;
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const s = Math.min((W * 0.9) / (w || 1), (H * 0.9) / (h || 1));
  const ox = (W - w * s) / 2 - b.minX * s;
  const oy = (H - h * s) / 2 + b.maxY * s;

  ctx.lineWidth = 1;
  for (const p of geometry.polys || []) {
    const pts = p.pts || [];
    if (pts.length < 2) continue;
    ctx.strokeStyle = p.color || "#111111";
    ctx.beginPath();
    ctx.moveTo(pts[0].x * s + ox, -pts[0].y * s + oy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * s + ox, -pts[i].y * s + oy);
    if (p.closed) ctx.closePath();
    ctx.stroke();
  }
}

export function createConverter(dom, { viewer, onResult } = {}) {
  const state = {
    lastFile: null,
    lastText: "",
    lastBuffer: null,
    lastFormat: "",
    lastGeometry: null,
  };

  const prevCanvas = dom.svgPreview;
  const prevCtx = prevCanvas.getContext("2d");

  function log(msg) {
    dom.convertStatus.textContent = msg;
  }

  function updateUi() {
    const hasFile = !!state.lastFile;
    dom.svgDrop.style.display = hasFile ? "none" : "";
    dom.svgPreviewBlock.style.display = hasFile ? "" : "none";

    const isConvert = dom.modeConvertBtn.classList.contains("on");
    dom.btnPickSvg.style.display = (isConvert && !hasFile) ? "" : "none";
    dom.svgOpenInfo.textContent = hasFile ? `Archivo: ${state.lastFile.name} (${state.lastFormat.toUpperCase()})` : "Archivo: —";
  }

  async function parseCurrentGeometry() {
    if (!state.lastFile) throw new Error("Primero carga un archivo DXF, SVG o PDF vectorial.");
    const quality = clamp(Number(dom.svgQualityEl.value) || 32, 4, 512);
    const format = state.lastFormat;

    if (format === "svg") {
      const scaleInput = String(dom.svgScaleEl.value || "auto").trim().toLowerCase();
      const mmPerSvgUnit = scaleInput === "auto" ? "auto" : Math.max(0.000001, Number(scaleInput) || 1);
      return parseSvgToGeometry(state.lastText, { quality, mmPerSvgUnit });
    }

    if (format === "pdf") {
      return await parsePdfToGeometry(state.lastBuffer, { quality });
    }

    if (format === "dxf") {
      await viewer.loadFromFile(state.lastFile);
      return viewer.getCurrentGeometry();
    }

    throw new Error("Formato no soportado. Usa DXF, SVG o PDF vectorial.");
  }

  async function loadVectorFile(file) {
    const format = getFileFormat(file);
    if (!format) {
      log("Formato no soportado. Usa .dxf, .svg o .pdf vectorial.");
      return;
    }

    state.lastFile = file;
    state.lastFormat = format;
    state.lastGeometry = null;
    state.lastText = "";
    state.lastBuffer = null;

    if (format === "svg" || format === "dxf") state.lastText = await file.text();
    if (format === "pdf") state.lastBuffer = await file.arrayBuffer();

    log(`${format.toUpperCase()} cargado: ${file.name}`);
    updateUi();

    try {
      if (format === "svg" || format === "pdf") {
        state.lastGeometry = await parseCurrentGeometry();
        drawPreview(prevCanvas, state.lastGeometry);
      } else {
        prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
      }
    } catch (err) {
      console.warn(err);
      log(`${format.toUpperCase()} cargado. La vista previa se generará al convertir. ${err?.message || ""}`.trim());
    }
  }

  dom.svgDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    dom.svgDrop.classList.add("dragover");
  });
  dom.svgDrop.addEventListener("dragleave", () => dom.svgDrop.classList.remove("dragover"));
  dom.svgDrop.addEventListener("drop", async (e) => {
    e.preventDefault();
    dom.svgDrop.classList.remove("dragover");
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    dom.svgFileInput.value = "";
    await loadVectorFile(f);
  });

  dom.svgFileInput.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await loadVectorFile(f);
    dom.svgFileInput.value = "";
  });

  dom.btnClear.addEventListener("click", () => {
    clear();
    updateUi();
  });

  function clear() {
    state.lastFile = null;
    state.lastText = "";
    state.lastBuffer = null;
    state.lastFormat = "";
    state.lastGeometry = null;
    dom.svgFileInput.value = "";
    prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
    log("Listo. Carga un DXF, SVG o PDF vectorial para convertir.");
  }

  dom.btnConvert.addEventListener("click", async () => {
    try {
      const geometry = await parseCurrentGeometry();
      state.lastGeometry = geometry;

      if (state.lastFormat !== "dxf") {
        viewer.loadGeometry(geometry, state.lastFile.name, state.lastFormat);
      }

      const target = dom.convertOutFormatEl?.value || "dxf";
      const outInsunits = Number(dom.svgOutUnitsEl.value || 4);
      const stitchToleranceMm = Math.max(0, Number(dom.svgStitchEl.value) || 0);
      const payload = viewer.exportCurrent(target, { insunits: outInsunits, stitchToleranceMm });
      if (!payload) throw new Error("No hay geometría cargada para exportar.");

      log(`Convertido OK: ${payload.name}`);
      if (typeof onResult === "function") onResult(payload);
    } catch (err) {
      console.error(err);
      log(`Error: ${err?.message || err}`);
    } finally {
      updateUi();
    }
  });

  clear();
  updateUi();

  return {
    clear,
    updateUi,
    hasFile: () => !!state.lastFile,
  };
}
