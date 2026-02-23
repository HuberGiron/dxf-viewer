// js/ui.js
export function wireUI({ dom, viewer, converter }) {
  const setOn = (btn, on) => {
    btn.classList.toggle("on", !!on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  };

  function resetAll() {
    // Limpia todo para poder abrir “uno nuevo”
    viewer.clear();
    viewer.resetView();
    viewer.setRulerActive(false);

    converter.clear();
    converter.updateUi();

    dom.dxfFileInput.value = "";
    dom.svgFileInput.value = "";

    dom.btnDownload.disabled = true;
    dom.btnDownload.classList.remove("hot");
  }

  function setMode(mode, { reset = true } = {}) {
    const isView = mode === "view";

    setOn(dom.modeViewBtn, isView);
    setOn(dom.modeConvertBtn, !isView);

    // panel convertidor
    dom.convertPanel.style.display = isView ? "none" : "";

    // botones top
    dom.btnPickDxf.style.display = isView ? "" : "none";

    // btnPickSvg lo decide converter.updateUi() (solo se ve en convert y si NO hay SVG cargado)
    if (isView) {
      dom.btnPickSvg.style.display = "none";
    } else {
      converter.updateUi();
    }

    if (reset) resetAll();
    else converter.updateUi();
  }

  // Tabs modo
  dom.modeViewBtn.addEventListener("click", () => setMode("view", { reset: true }));
  dom.modeConvertBtn.addEventListener("click", () => setMode("convert", { reset: true }));

  // Reset view / Ruler
  dom.btnReset.addEventListener("click", () => viewer.resetView());
  dom.btnRuler.addEventListener("click", () => viewer.setRulerActive(!viewer.isRulerActive()));

  // Units override
  dom.unitsOverride.addEventListener("change", (e) => viewer.setUnitsOverride(e.target.value));

  // Cargar DXF (input hidden)
  dom.dxfFileInput.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    // Fuerza modo visor y limpia antes de cargar
    setMode("view", { reset: true });

    try {
      await viewer.loadFromFile(f);
      dom.btnDownload.disabled = false;       // permitir bajar el DXF cargado también
      dom.btnDownload.classList.remove("hot");// “hot” solo para convertido
    } catch (err) {
      console.error(err);
    } finally {
      // permitir volver a seleccionar el mismo archivo
      dom.dxfFileInput.value = "";
    }
  });

  // Estado inicial
  setMode("view", { reset: false });
  converter.clear();
  converter.updateUi();
}