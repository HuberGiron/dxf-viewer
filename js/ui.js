// js/ui.js
export function wireUI({ dom, viewer, setDownloadEnabled }) {
  function resetAll() {
    viewer.clear();
    viewer.resetView();
    viewer.setRulerActive(false);

    if (dom.dxfFileInput) dom.dxfFileInput.value = "";
    setDownloadEnabled?.(false);
    dom.btnDownload?.classList.remove("hot");
  }

  dom.btnPickDxf?.addEventListener("click", () => dom.dxfFileInput.click());
  dom.btnZoomIn?.addEventListener("click", () => viewer.zoomBy(1.25));
  dom.btnZoomOut?.addEventListener("click", () => viewer.zoomBy(0.8));
  dom.btnReset?.addEventListener("click", () => viewer.resetView());
  dom.btnRuler?.addEventListener("click", () => viewer.setRulerActive(!viewer.isRulerActive()));

  function getAdvancedOptions() {
    return {
      curveQuality: dom.curveQuality?.value || "high",
      joinContinuous: !!dom.joinContinuous?.checked,
    };
  }

  function syncAdvancedOptions() {
    viewer.setAdvancedOptions?.(getAdvancedOptions());
  }

  async function applyAdvancedOptions() {
    if (viewer.applyAdvancedOptions) {
      await viewer.applyAdvancedOptions(getAdvancedOptions());
    } else {
      viewer.setAdvancedOptions?.(getAdvancedOptions());
    }
  }

  syncAdvancedOptions();
  dom.curveQuality?.addEventListener("change", applyAdvancedOptions);
  dom.joinContinuous?.addEventListener("change", applyAdvancedOptions);

  dom.unitsOverride?.addEventListener("change", (e) => viewer.setUnitsOverride(e.target.value));
  dom.viewerEl?.addEventListener("vector-loaded", () => setDownloadEnabled?.(true));

  let loading = false;
  async function openFile(f) {
    if (loading) return;
    if (!f) return;

    loading = true;
    dom.fileStatus.textContent = "Cargando…";
    resetAll();
    dom.unitsOverride.value = "auto";
    viewer.setUnitsOverride("auto");
    for (const control of [dom.btnPickDxf, dom.curveQuality, dom.joinContinuous, dom.unitsOverride]) control.disabled = true;

    try {
      await viewer.loadFromFile(f);
      setDownloadEnabled?.(viewer.getCurrentGeometry().polys.length > 0);
      dom.fileStatus.textContent = viewer.getCurrentGeometry().polys.length
        ? "Archivo cargado. Revisa las dimensiones antes de cortar."
        : "No se encontraron trazos vectoriales compatibles para exportar.";
    } catch (err) {
      console.error(err);
      viewer.clear();
      dom.fileStatus.textContent = err?.message || String(err);
      setDownloadEnabled?.(false);
    } finally {
      dom.dxfFileInput.value = "";
      loading = false;
      for (const control of [dom.btnPickDxf, dom.curveQuality, dom.joinContinuous, dom.unitsOverride]) control.disabled = false;
    }
  }
  dom.dxfFileInput?.addEventListener("change", e => openFile(e.target.files?.[0]));
  dom.viewerEl?.addEventListener("dragover", e => e.preventDefault());
  dom.viewerEl?.addEventListener("drop", e => {
    e.preventDefault();
    openFile(e.dataTransfer?.files?.[0]);
  });
}
