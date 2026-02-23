import { createViewer } from "./viewer.js";
import { createConverter } from "./converter.js";
import { wireUI } from "./ui.js";

const $ = (id) => document.getElementById(id);

const dom = {
  // mode
  modeViewBtn: $("modeView"),
  modeConvertBtn: $("modeConvert"),

  // inputs + buttons top
  dxfFileInput: $("dxfFile"),
  svgFileInput: $("svgFile"),
  btnPickDxf: $("btnPickDxf"),
  btnPickSvg: $("btnPickSvg"),
  btnDownload: $("btnDownloadDxf"),
  btnReset: $("btnReset"),
  btnRuler: $("btnRuler"),

  // viewer
  viewerEl: $("viewer"),
  canvas: $("dxfCanvas"),
  layersEl: $("layers"),

  // info
  infoFile: $("infoFile"),
  infoEnt: $("infoEnt"),
  infoLay: $("infoLay"),
  infoUnits: $("infoUnits"),
  unitsOverride: $("unitsOverride"),
  unitsNote: $("unitsNote"),
  infoDims: $("infoDims"),
  infoRuler: $("infoRuler"),

  // convert panel
  convertPanel: $("convertPanel"),
  svgDrop: $("svgDrop"),
  svgScaleEl: $("svgScale"),
  svgQualityEl: $("svgQuality"),
  svgStitchEl: $("svgStitch"),
  svgOutUnitsEl: $("svgOutUnits"),
  btnConvert: $("btnConvert"),
  btnClear: $("btnClear"),
  convertStatus: $("convertStatus"),
  svgPreviewBlock: $("svgPreviewBlock"),
  svgPreview: $("svgPreview"),
  svgOpenInfo: $("svgOpenInfo"),
};

// Viewer
const viewer = createViewer(dom);

// Converter (al convertir, carga el DXF en el viewer)
const converter = createConverter(dom, {
  onConverted: async ({ dxfText, dxfName }) => {
    await viewer.loadFromText(dxfText, dxfName);

    // habilitar descarga y destacar si viene de conversión
    dom.btnDownload.disabled = false;
    dom.btnDownload.classList.add("hot");
  },
});

// UI Wiring
wireUI({ dom, viewer, converter });

// descarga DXF actual
dom.btnDownload.addEventListener("click", () => {
  const payload = viewer.getCurrentDxf();
  if (!payload?.text) return;

  const blob = new Blob([payload.text], { type: "application/dxf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = payload.name || "export.dxf";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});