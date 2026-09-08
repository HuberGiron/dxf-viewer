import { createViewer } from "./viewer.js";
import { wireUI } from "./ui.js";

const $ = (id) => document.getElementById(id);

const dom = {
  // input + buttons top
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

  // viewer
  viewerEl: $("viewer"),
  canvas: $("dxfCanvas"),
  layersEl: $("layers"),

  // info
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

const viewer = createViewer(dom);

wireUI({ dom, viewer, setDownloadEnabled });

// Descarga directa desde el archivo vectorial cargado.
// El formato lo define la lista "Salida".
dom.btnDownload?.addEventListener("click", () => {
  try {
  const format = dom.downloadFormatEl?.value || "dxf";
  const exportOptions = viewer.getExportOptions({ insunits: 4, visibleOnly: $("exportVisible").checked });
  const payload = viewer.exportCurrent(format, exportOptions);
  if (!payload) throw new Error("No hay trazos para exportar. Revisa las capas visibles.");
  downloadPayload(payload);
  dom.fileStatus.textContent = "Archivo exportado: " + payload.name;
  } catch (err) { dom.fileStatus.textContent = err.message || String(err); }
});

setDownloadEnabled(false);
