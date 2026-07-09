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

  dom.dxfFileInput?.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;

    resetAll();

    try {
      await viewer.loadFromFile(f);
      setDownloadEnabled?.(true);
    } catch (err) {
      console.error(err);
      dom.unitsNote.textContent = err?.message || String(err);
      setDownloadEnabled?.(false);
    } finally {
      dom.dxfFileInput.value = "";
    }
  });
}
