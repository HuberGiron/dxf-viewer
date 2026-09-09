import { createViewer } from "./viewer.js";
import { wireUI } from "./ui.js";
import { createCadEditor } from "./cad-beta.js";
import { geometryToDxfR12, geometryToSvg, geometryToPdfBytes, sanitizeBaseName } from "./vector-utils.js";

const $ = (id) => document.getElementById(id);

const dom = {
  dxfFileInput: $("dxfFile"),
  btnPickDxf: $("btnPickDxf"),
  btnDownload: $("btnDownload"),
  downloadFormatEl: $("downloadFormat"),
  btnReset: $("btnReset"),
  btnZoomIn: $("btnZoomIn"),
  btnZoomOut: $("btnZoomOut"),
  rulerStatus: $("rulerStatus"),
  fileStatus: $("fileStatus"),
  btnRuler: $("btnRuler"),
  viewerEl: $("viewer"),
  canvas: $("dxfCanvas"),
  layersEl: $("layers"),
  infoFile: $("infoFile"),
  infoEnt: $("infoEnt"),
  infoPts: $("infoPts"),
  infoLay: $("infoLay"),
  infoUnits: $("infoUnits"),
  unitsOverride: $("unitsOverride"),
  curveQuality: $("curveQuality"),
  joinContinuous: $("joinContinuous"),
  unitsNote: $("unitsNote"),
  infoDims: $("infoDims"),
  infoRuler: $("infoRuler"),
};

function setDownloadEnabled(on) {
  if (dom.btnDownload) dom.btnDownload.disabled = !on;
  if (dom.downloadFormatEl) dom.downloadFormatEl.disabled = !on;
}

function downloadPayload(payload) {
  if (!payload?.data) return;
  const blob = new Blob([payload.data], { type: payload.mime || "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = payload.name || "export";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}


function pointDist(a, b) {
  return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function sameStitchGroup(a, b) {
  // Nunca unir automáticamente capas distintas.
  return String(a?.layer || "0") === String(b?.layer || "0");
}

function safeStitchPolys(polys, toleranceMm = 0) {
  const tol = Math.max(0, Number(toleranceMm) || 0);
  const input = (polys || [])
    .filter(p => Array.isArray(p?.pts) && p.pts.length >= 2)
    .map(p => ({ ...p, pts: p.pts.map(q => ({ x: Number(q.x), y: Number(q.y) })) }));

  if (tol <= 0) return input;

  const used = new Array(input.length).fill(false);
  const out = [];
  const reversed = p => ({ ...p, pts: p.pts.slice().reverse() });

  for (let i = 0; i < input.length; i++) {
    if (used[i]) continue;

    let a = { ...input[i], pts: input[i].pts.slice() };
    used[i] = true;

    if (a.closed) {
      out.push(a);
      continue;
    }

    let changed = true;
    while (changed && !a.closed) {
      changed = false;

      for (let j = 0; j < input.length; j++) {
        if (used[j]) continue;
        const rawB = input[j];
        if (rawB.closed || !sameStitchGroup(a, rawB)) continue;

        const a0 = a.pts[0];
        const a1 = a.pts[a.pts.length - 1];
        const b0 = rawB.pts[0];
        const b1 = rawB.pts[rawB.pts.length - 1];

        const cases = [
          { d: pointDist(a1, b0), kind: "a1-b0" },
          { d: pointDist(a1, b1), kind: "a1-b1" },
          { d: pointDist(a0, b1), kind: "a0-b1" },
          { d: pointDist(a0, b0), kind: "a0-b0" },
        ].sort((x, y) => x.d - y.d);

        const best = cases[0];
        if (!best || best.d > tol) continue;

        let b = { ...rawB, pts: rawB.pts.slice() };
        let pts;

        // Los cuatro casos conservan TODOS los puntos no coincidentes.
        if (best.kind === "a1-b0") {
          pts = a.pts.concat(b.pts.slice(1));
        } else if (best.kind === "a1-b1") {
          b = reversed(b);
          pts = a.pts.concat(b.pts.slice(1));
        } else if (best.kind === "a0-b1") {
          pts = b.pts.concat(a.pts.slice(1));
        } else { // a0-b0
          b = reversed(b);
          pts = b.pts.concat(a.pts.slice(1));
        }

        a = { ...a, pts, closed: false };
        used[j] = true;
        changed = true;

        // Si el nuevo trazo se cerró, marcarlo como cerrado sin perder vértices.
        if (a.pts.length >= 3 && pointDist(a.pts[0], a.pts[a.pts.length - 1]) <= tol) {
          a.pts[a.pts.length - 1] = { ...a.pts[0] };
          a.closed = true;
        }
        break;
      }
    }

    out.push(a);
  }

  return out;
}

function geometryWithSafeStitch(geometry, toleranceMm = 0) {
  const polys = safeStitchPolys(geometry?.polys || [], toleranceMm);
  return { ...geometry, polys };
}

function exportViewerGeometry(viewer, format, exportOptions = {}) {
  const geometry = viewer.getCurrentGeometry({ visibleOnly: !!exportOptions.visibleOnly });
  if (!geometry?.polys?.length) return null;

  const stitched = geometryWithSafeStitch(geometry, exportOptions.stitchToleranceMm);
  // Las funciones de vector-utils reciben 0 para evitar ejecutar el stitch antiguo una segunda vez.
  const options = { ...exportOptions, stitchToleranceMm: 0 };
  const base = sanitizeBaseName(dom.infoFile?.textContent || "export");
  const f = String(format || "dxf").toLowerCase();

  if (f === "svg") {
    return { data: geometryToSvg(stitched, options), name: `${base}.svg`, mime: "image/svg+xml" };
  }
  if (f === "pdf") {
    return { data: geometryToPdfBytes(stitched, options), name: `${base}.pdf`, mime: "application/pdf" };
  }
  return {
    data: geometryToDxfR12(stitched, { ...options, insunits: Number(options.insunits ?? 4) }),
    name: `${base}.dxf`,
    mime: "application/dxf",
  };
}

const viewer = createViewer(dom);
wireUI({ dom, viewer, setDownloadEnabled });

dom.btnDownload?.addEventListener("click", () => {
  try {
    const format = dom.downloadFormatEl?.value || "dxf";
    const exportOptions = viewer.getExportOptions({
      insunits: 4,
      visibleOnly: $("exportVisible").checked,
    });
    const payload = exportViewerGeometry(viewer, format, exportOptions);
    if (!payload) throw new Error("No hay trazos para exportar. Revisa las capas visibles.");
    downloadPayload(payload);
    dom.fileStatus.textContent = "Archivo exportado: " + payload.name;
  } catch (err) {
    dom.fileStatus.textContent = err.message || String(err);
  }
});

setDownloadEnabled(false);

const cad = createCadEditor({
  canvas: $("cadCanvas"),
  statusEl: $("cadStatus"),
  cursorEl: $("cadCursor"),
  propertiesEl: $("cadProperties"),
  contextFieldsEl: $("cadContextFields"),
  entityCountEl: $("cadEntityCount"),
  dimensionCountEl: $("cadDimensionCount"),
  constraintCountEl: $("cadConstraintCount"),
  underCountEl: $("cadUnderCount"),
  fullCountEl: $("cadFullCount"),
  conflictCountEl: $("cadConflictCount"),
  sketchSummaryEl: $("cadSketchSummary"),
  originInfoEl: $("cadOriginInfo"),
  fileNameEl: $("cadFileName"),
  snapControls: {
    endpoint: $("snapEndpoint"),
    midpoint: $("snapMidpoint"),
    center: $("snapCenter"),
    intersection: $("snapIntersection"),
    grid: $("snapGrid"),
  },
  onDownload: downloadPayload,
});

const viewerMode = $("viewerMode");
const cadMode = $("cadMode");
const viewerActions = $("viewerActions");
const cadActions = $("cadActions");
const tabViewer = $("tabViewer");
const tabCad = $("tabCad");

function setMode(mode) {
  const isCad = mode === "cad";
  viewerMode.classList.toggle("hidden", isCad);
  cadMode.classList.toggle("hidden", !isCad);
  viewerActions.classList.toggle("hidden", isCad);
  cadActions.classList.toggle("hidden", !isCad);
  tabViewer.classList.toggle("active", !isCad);
  tabCad.classList.toggle("active", isCad);
  tabViewer.setAttribute("aria-selected", String(!isCad));
  tabCad.setAttribute("aria-selected", String(isCad));
  if (isCad) cad.resize();
  else viewer.resize?.();
}

tabViewer?.addEventListener("click", () => setMode("viewer"));
tabCad?.addEventListener("click", () => setMode("cad"));

document.querySelectorAll(".cad-tool, .cad-primary-tool").forEach(btn => {
  btn.addEventListener("click", () => cad.setTool(btn.dataset.tool));
});
document.querySelectorAll(".cad-constraint-action[data-constraint]").forEach(btn => {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    cad.applyConstraint(btn.dataset.constraint);
  });
});
$("cadNew")?.addEventListener("click", () => cad.newDocument());
$("cadOpen")?.addEventListener("click", () => $("cadFile")?.click());
$("cadFile")?.addEventListener("change", e => {
  const file = e.target.files?.[0];
  if (file) cad.importFile(file);
  e.target.value = "";
});
$("cadUndo")?.addEventListener("click", () => cad.undo());
$("cadRedo")?.addEventListener("click", () => cad.redo());
$("cadZoomIn")?.addEventListener("click", () => cad.zoomBy(1.25));
$("cadZoomOut")?.addEventListener("click", () => cad.zoomBy(0.8));
$("cadFit")?.addEventListener("click", () => cad.fitView());
$("cadExport")?.addEventListener("click", () => cad.exportDocument($("cadExportFormat")?.value || "json"));

window.addEventListener("resize", () => {
  if (!cadMode.classList.contains("hidden")) cad.resize();
});
