function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function fmt(n, d = 3) {
  if (!isFinite(n)) return "—";
  return Number(n).toFixed(d);
}

function dist(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function hashColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const r = 80 + (h & 127);
  const g = 80 + ((h >> 7) & 127);
  const b = 80 + ((h >> 14) & 127);
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}

// DXF trueColor viene como 0xRRGGBB; pero ACI 1..255 NO debe tratarse como trueColor
function hexFromTrueColor(n) {
  if (typeof n !== "number" || !isFinite(n)) return null;
  if (n >= 0 && n <= 255) return null; // evitar ACI “7 -> #000007”
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `#${r.toString(16).padStart(2,"0")}${g.toString(16).padStart(2,"0")}${b.toString(16).padStart(2,"0")}`;
}

function getCssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function aciToCss(aci) {
  const a = Math.abs(Number(aci) || 0);
  const text = getCssVar("--text", "#e6edf3");
  const pal = {
    0: text,
    1: "#ff3b30",
    2: "#ffd60a",
    3: "#34c759",
    4: "#5ac8fa",
    5: "#0a84ff",
    6: "#ff2d55",
    7: text,         // clave: visible en tema oscuro
    8: "#8e8e93",
    9: "#c7c7cc",
  };
  return pal[a] || null;
}

function unitsFromInsunits(ins) {
  const map = {
    0: { label: "unitless", mm: 1 },
    1: { label: "in", mm: 25.4 },
    2: { label: "ft", mm: 304.8 },
    4: { label: "mm", mm: 1 },
    5: { label: "cm", mm: 10 },
    6: { label: "m", mm: 1000 },
  };
  return map[ins] || { label: `insunits:${ins}`, mm: 1 };
}

function extractInsunits(dxfObj, rawText) {
  // 1) header parseado
  try {
    const h = dxfObj?.header;
    if (h && typeof h.$INSUNITS !== "undefined") {
      const v = (typeof h.$INSUNITS === "object" && h.$INSUNITS !== null) ? h.$INSUNITS.value : h.$INSUNITS;
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  } catch {}

  // 2) fallback en texto: tolera espacios y CRLF
  const m = rawText.match(/(?:^|\r?\n)\s*9\s*\r?\n\s*\$INSUNITS\s*\r?\n\s*70\s*\r?\n\s*(-?\d+)\s*(?:\r?\n|$)/i);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function extractExtents(dxfObj, rawText) {
  // 1) header parseado
  try {
    const h = dxfObj?.header;
    const a = h?.$EXTMIN;
    const b = h?.$EXTMAX;

    const ax = Number(a?.x ?? a?.value?.x);
    const ay = Number(a?.y ?? a?.value?.y);
    const bx = Number(b?.x ?? b?.value?.x);
    const by = Number(b?.y ?? b?.value?.y);

    if ([ax, ay, bx, by].every(Number.isFinite)) {
      return { minX: ax, minY: ay, maxX: bx, maxY: by };
    }
  } catch {}

  // 2) fallback en texto (tolera CRLF/LF)
  const m1 = rawText?.match(/(?:^|\r?\n)\s*9\s*\r?\n\s*\$EXTMIN\s*\r?\n\s*10\s*\r?\n\s*([-+0-9.eE]+)\s*\r?\n\s*20\s*\r?\n\s*([-+0-9.eE]+)/i);
  const m2 = rawText?.match(/(?:^|\r?\n)\s*9\s*\r?\n\s*\$EXTMAX\s*\r?\n\s*10\s*\r?\n\s*([-+0-9.eE]+)\s*\r?\n\s*20\s*\r?\n\s*([-+0-9.eE]+)/i);

  if (m1 && m2) {
    const minX = Number(m1[1]);
    const minY = Number(m1[2]);
    const maxX = Number(m2[1]);
    const maxY = Number(m2[2]);
    if ([minX, minY, maxX, maxY].every(Number.isFinite)) {
      return { minX, minY, maxX, maxY };
    }
  }

  return null;
}

function bboxInit() {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}
function bboxAdd(b, x, y) {
  b.minX = Math.min(b.minX, x);
  b.minY = Math.min(b.minY, y);
  b.maxX = Math.max(b.maxX, x);
  b.maxY = Math.max(b.maxY, y);
}
function bboxValid(b) {
  return isFinite(b.minX) && isFinite(b.minY) && isFinite(b.maxX) && isFinite(b.maxY);
}

const TAU = Math.PI * 2;

function matI() { return [1, 0, 0, 1, 0, 0]; }
function matT(tx, ty) { return [1, 0, 0, 1, tx, ty]; }
function matS(sx, sy) { return [sx, 0, 0, sy, 0, 0]; }
function matRdeg(deg) {
  const r = (Number(deg) || 0) * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
}
function matMul2(A, B) {
  return [
    A[0]*B[0] + A[2]*B[1],
    A[1]*B[0] + A[3]*B[1],
    A[0]*B[2] + A[2]*B[3],
    A[1]*B[2] + A[3]*B[3],
    A[0]*B[4] + A[2]*B[5] + A[4],
    A[1]*B[4] + A[3]*B[5] + A[5],
  ];
}
function matApply2(M, p) {
  return {
    x: M[0] * p.x + M[2] * p.y + M[4],
    y: M[1] * p.x + M[3] * p.y + M[5],
  };
}

export function createViewer(dom) {
  const canvas = dom.canvas;
  const ctx = canvas.getContext("2d");

  const state = {
    dxfText: "",
    dxfName: "",
    dxfObj: null,

    // drawing
    pathsByLayer: new Map(), // layer -> [ {pts, closed} ]
    layers: new Map(),       // layer -> { visible, color, count }

    // metrics
    bbox: bboxInit(),
    entCount: 0,

    // view
    view: { scale: 1, panX: 0, panY: 0, cx: 0, cy: 0 },

    // units
    insunits: 0,
    unitsOverride: "auto",

    // ruler
    ruler: { active: false, p0: null, p1: null, drawing: false },

    // interaction
    dragging: false,
    lastMouse: { x: 0, y: 0 },
  };

  // --------- canvas sizing ---------
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }

  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // --------- transforms ---------
  function worldToScreen(p) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const s = state.view.scale;
    // y up in world; y down on screen
    return {
      x: (p.x - state.view.cx) * s + w / 2 + state.view.panX,
      y: (-(p.y - state.view.cy)) * s + h / 2 + state.view.panY,
    };
  }

  function screenToWorld(x, y) {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const s = state.view.scale;
    return {
      x: (x - w / 2 - state.view.panX) / s + state.view.cx,
      y: -((y - h / 2 - state.view.panY) / s) + state.view.cy,
    };
  }

  // --------- units ---------
  function getEffectiveUnits() {
    const override = state.unitsOverride;
    if (override && override !== "auto") {
      const ins = Number(override);
      return { ins, ...unitsFromInsunits(ins), overridden: true };
    }
    const ins = state.insunits;
    return { ins, ...unitsFromInsunits(ins), overridden: false };
  }

  function updateUnitsUI() {
    const eff = getEffectiveUnits();
    dom.infoUnits.textContent = `${eff.label} (INSUNITS=${eff.ins}${eff.overridden ? ", override" : ""})`;

    if (eff.ins === 0 && state.unitsOverride === "auto") {
      dom.unitsNote.textContent = "DXF sin unidades (INSUNITS=0 o ausente). Usa override para mm correctos.";
    } else {
      dom.unitsNote.textContent = "";
    }
  }

  function updateDimsUI() {
    if (!bboxValid(state.bbox)) {
      dom.infoDims.textContent = "—";
      return;
    }
    const w = state.bbox.maxX - state.bbox.minX;
    const h = state.bbox.maxY - state.bbox.minY;

    const eff = getEffectiveUnits();
    const wmm = w * eff.mm;
    const hmm = h * eff.mm;

    dom.infoDims.textContent = `${fmt(wmm, 3)} × ${fmt(hmm, 3)} mm`;
  }

  // --------- layers UI ---------
  function renderLayersUI() {
    dom.layersEl.innerHTML = "";
    const entries = [...state.layers.entries()].sort((a, b) => a[0].localeCompare(b[0]));

    for (const [name, L] of entries) {
      const row = document.createElement("div");
      row.className = "layer-row";

      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = !!L.visible;
      chk.addEventListener("change", () => {
        L.visible = chk.checked;
        redraw();
      });

      const dot = document.createElement("span");
      dot.className = "layer-dot";
      dot.style.background = L.color;

      const label = document.createElement("span");
      label.className = "layer-name";
      label.textContent = name;

      const count = document.createElement("span");
      count.className = "layer-count";
      count.textContent = String(L.count || 0);

      row.appendChild(chk);
      row.appendChild(dot);
      row.appendChild(label);
      row.appendChild(count);

      dom.layersEl.appendChild(row);
    }
  }

  // --------- DXF to primitives ---------
  function addPolyline(layer, pts, closed) {
    if (!pts || pts.length < 2) return;
    if (!state.pathsByLayer.has(layer)) state.pathsByLayer.set(layer, []);
    state.pathsByLayer.get(layer).push({ pts, closed: !!closed });
    for (const p of pts) bboxAdd(state.bbox, p.x, p.y);
  }

  function addCircleAsPoly(layer, cx, cy, r, seg = 64) {
    if (!isFinite(cx) || !isFinite(cy) || !isFinite(r) || r <= 0) return;
    const pts = [];
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
    addPolyline(layer, pts, true);
  }

  function addArcAsPoly(layer, cx, cy, r, startA, endA, seg = 48) {
    if (!isFinite(cx) || !isFinite(cy) || !isFinite(r) || r <= 0) return;

    let a0 = Number(startA);
    let a1 = Number(endA);
    if (!Number.isFinite(a0) || !Number.isFinite(a1)) return;

    // dxf-parser (ARC) normalmente ya entrega radianes.
    // Pero dejamos autodetección por robustez si llega algo en grados.
    const TAU = Math.PI * 2;
    const looksLikeDegrees =
      Math.abs(a0) > TAU + 1e-6 || Math.abs(a1) > TAU + 1e-6;

    if (looksLikeDegrees) {
      a0 = (a0 * Math.PI) / 180;
      a1 = (a1 * Math.PI) / 180;
    }

    // DXF ARC normalmente va CCW de start a end
    while (a1 < a0) a1 += TAU;

    const span = a1 - a0;
    const n = clamp(Math.ceil(seg * (Math.abs(span) / TAU || 1)), 8, 512);

    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = a0 + (span * i) / n;
      pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }

    addPolyline(layer, pts, false);
  }

  function computeLayerColor(dxfObj, layerName) {
    // try layer table
    const layersTable = dxfObj?.tables?.layer?.layers;
    let layerDef = null;
    if (layersTable && typeof layersTable === "object") {
      layerDef = layersTable[layerName] || null;
    }

    const trueColor = layerDef?.trueColor;
    const colorNumber = layerDef?.colorNumber ?? layerDef?.color;

    return (
      hexFromTrueColor(trueColor) ||
      aciToCss(colorNumber) ||
      hashColor(layerName)
    );
  }

  function ensureLayerEntry(dxfObj, layer) {
    const name = layer || "0";
    if (!state.layers.has(name)) {
      state.layers.set(name, {
        visible: true,
        color: computeLayerColor(dxfObj, name),
        count: 0,
      });
    }
    return state.layers.get(name);
  }

  function toXY(obj, fallback = { x: 0, y: 0 }) {
    const x = Number(obj?.x ?? fallback.x ?? 0);
    const y = Number(obj?.y ?? fallback.y ?? 0);
    return { x, y };
  }

  function addPolylineTransformed(layer, pts, closed, M) {
    if (!pts || pts.length < 2) return;
    const out = (M ? pts.map(p => matApply2(M, p)) : pts);
    addPolyline(layer, out, closed);
  }

  function sampleCirclePts(center, r, seg = 96) {
    const pts = [];
    if (!isFinite(center.x) || !isFinite(center.y) || !isFinite(r) || r <= 0) return pts;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * TAU;
      pts.push({ x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) });
    }
    return pts;
  }

  function sampleArcPts(center, r, startDeg, endDeg, seg = 96) {
    const pts = [];
    if (!isFinite(center.x) || !isFinite(center.y) || !isFinite(r) || r <= 0) return pts;
    let a0 = (Number(startDeg) || 0) * Math.PI / 180;
    let a1 = (Number(endDeg) || 0) * Math.PI / 180;
    while (a1 < a0) a1 += TAU;
    const span = a1 - a0;
    const n = clamp(Math.ceil(seg * (span / TAU)), 8, 512);
    for (let i = 0; i <= n; i++) {
      const t = a0 + (span * i) / n;
      pts.push({ x: center.x + r * Math.cos(t), y: center.y + r * Math.sin(t) });
    }
    return pts;
  }

  function sampleEllipsePts(center, majorEnd, axisRatio = 1, seg = 128) {
    const pts = [];
    const cx = Number(center?.x), cy = Number(center?.y);
    const mx = Number(majorEnd?.x), my = Number(majorEnd?.y);
    const ratio = Number(axisRatio || 1);
    if (![cx, cy, mx, my, ratio].every(Number.isFinite)) return pts;

    const a = Math.hypot(mx, my);
    const b = a * ratio;
    const rot = Math.atan2(my, mx);

    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * TAU;
      const x = a * Math.cos(t);
      const y = b * Math.sin(t);
      const xr = x * Math.cos(rot) - y * Math.sin(rot);
      const yr = x * Math.sin(rot) + y * Math.cos(rot);
      pts.push({ x: cx + xr, y: cy + yr });
    }
    return pts;
  }

  function ingestEntityRecursive(e, parentM = null, depth = 0) {
    if (!e || depth > 12) return;

    const layer = e.layer || "0";
    ensureLayer(layer).count++;

    switch (e.type) {
      case "LINE": {
        const p1src =
          e.start ||
          e.startPoint ||
          e.vertices?.[0] ||
          e.p1 ||
          ((Number.isFinite(e.x1) && Number.isFinite(e.y1)) ? { x: e.x1, y: e.y1 } : null);

        const p2src =
          e.end ||
          e.endPoint ||
          e.vertices?.[1] ||
          e.p2 ||
          ((Number.isFinite(e.x2) && Number.isFinite(e.y2)) ? { x: e.x2, y: e.y2 } : null);

        if (p1src && p2src) {
          addPolylineTransformed(layer, [toXY(p1src), toXY(p2src)], false, parentM);
        }
        break;
      }

      case "LWPOLYLINE": {
        const closed = (e.shape === true) || (((e.flags || 0) & 1) === 1);
        addLwPolylineWithBulge(layer, e.vertices || [], closed, parentM);
        break;
      }

      case "POLYLINE": {
        const verts = (e.vertices || []).map(v => ({
          x: Number(v.x),
          y: Number(v.y),
          bulge: Number(v.bulge || 0),
        }));
        const closed = (((e.flags || 0) & 1) === 1);
        addLwPolylineWithBulge(layer, verts, closed, parentM);
        break;
      }

      case "CIRCLE": {
        const cx = Number(e.center?.x ?? e.x);
        const cy = Number(e.center?.y ?? e.y);
        const r = Number(e.radius ?? e.r);

        if (!parentM) {
          addCircleAsPoly(layer, cx, cy, r, 96);
        } else {
          const pts = [];
          const seg = 96;
          for (let i = 0; i <= seg; i++) {
            const t = (i / seg) * TAU;
            pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
          }
          addPolylineTransformed(layer, pts, true, parentM);
        }
        break;
      }

      case "ARC": {
        const cx = Number(e.center?.x ?? e.x);
        const cy = Number(e.center?.y ?? e.y);
        const r = Number(e.radius ?? e.r);

        let a0 = Number(e.startAngle);
        let a1 = Number(e.endAngle);

        if (![cx, cy, r, a0, a1].every(Number.isFinite)) break;

        // dxf-parser suele dar radianes en ARC.
        // Aun así autodetectamos por robustez.
        const looksLikeDegrees =
          Math.abs(a0) > TAU + 1e-6 || Math.abs(a1) > TAU + 1e-6;

        if (!parentM) {
          // addArcAsPoly ya autodetecta rad/grados
          addArcAsPoly(layer, cx, cy, r, a0, a1, 96);
        } else {
          let s = looksLikeDegrees ? (a0 * Math.PI) / 180 : a0;
          let t = looksLikeDegrees ? (a1 * Math.PI) / 180 : a1;

          while (t < s) t += TAU;
          const span = t - s;
          const n = clamp(Math.ceil(96 * ((Math.abs(span) / TAU) || 1)), 8, 512);

          const pts = [];
          for (let i = 0; i <= n; i++) {
            const ang = s + (span * i) / n;
            pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
          }

          addPolylineTransformed(layer, pts, false, parentM);
        }
        break;
      }

      case "ELLIPSE": {
        // Muchas veces son arcos elípticos
        const center = toXY(e.center);
        const major = toXY(
          e.majorAxisEndPoint ||
          e.majorAxisEnd ||
          e.majorEndPoint ||
          e.majorAxis ||
          { x: e.majorAxisEndPointX, y: e.majorAxisEndPointY }
        );
        const ratio = Number(e.axisRatio ?? e.ratio ?? 1);

        // En dxf-parser (ELLIPSE), startAngle/endAngle vienen de códigos 41/42
        // (realmente parámetros de la elipse; suelen venir en radianes).
        const startParam = Number.isFinite(Number(e.startParameter)) ? Number(e.startParameter) :
                          Number.isFinite(Number(e.startAngle)) ? Number(e.startAngle) :
                          Number.isFinite(Number(e.start)) ? Number(e.start) :
                          undefined;

        const endParam = Number.isFinite(Number(e.endParameter)) ? Number(e.endParameter) :
                        Number.isFinite(Number(e.endAngle)) ? Number(e.endAngle) :
                        Number.isFinite(Number(e.end)) ? Number(e.end) :
                        undefined;

        const result = sampleEllipseOrArc(center, major, ratio, startParam, endParam, parentM);
        if (result && Array.isArray(result.pts)) {
          addPolylineSafe(layer, result.pts, !!result.closed);
        }
        break;
      }

      case "SPLINE": {
        const pts = splineToPoints(e);
        addPolylineTransformed(layer, pts, false, parentM);
        break;
      }

      case "INSERT": {
        const blockName = e.name || e.block || e.blockName;
        const blk = getBlockByName(blockName);
        const blkEntities = blk?.entities;
        if (!Array.isArray(blkEntities) || !blkEntities.length) break;

        const insPos = toXY(e.position || e.insertPoint || { x: e.x, y: e.y });
        const rot = Number(e.rotation || 0);
        const sx = Number(e.xScale || e.scaleX || e.scale || 1);
        const sy = Number(e.yScale || e.scaleY || e.scale || 1);

        const base = toXY(blk.position || blk.basePoint || blk.origin || { x: 0, y: 0 });

        // local = T(insert) * R(rot) * S(scale) * T(-base)
        const local = matMul(
          matT(insPos.x, insPos.y),
          matMul(matRdeg(rot), matMul(matS(sx, sy), matT(-base.x, -base.y)))
        );

        const M = parentM ? matMul(parentM, local) : local;

        for (const child of blkEntities) {
          ingestEntityRecursive(child, M, depth + 1);
        }
        break;
      }

      default:
        // TEXT/MTEXT/HATCH/DIMENSION/... por ahora no se dibujan
        break;
    }
  }

  function ingestDxf(dxfObj, rawText) {
    state.dxfObj = dxfObj;
    state.entCount = 0;
    state.pathsByLayer.clear();
    state.layers.clear();
    state.bbox = bboxInit();

    state.insunits = extractInsunits(dxfObj, rawText);

    const ents = dxfObj?.entities || [];
    state.entCount = ents.length;

    // ---------- helpers locales ----------
    const TAU = Math.PI * 2;

    function ensureLayer(layer) {
      const name = layer || "0";
      if (!state.layers.has(name)) {
        state.layers.set(name, {
          visible: true,
          color: computeLayerColor(dxfObj, name),
          count: 0,
        });
      }
      return state.layers.get(name);
    }

    function toXY(obj, fallback = { x: 0, y: 0 }) {
      const x = Number(obj?.x ?? fallback.x ?? 0);
      const y = Number(obj?.y ?? fallback.y ?? 0);
      return { x, y };
    }

    function addPolylineSafe(layer, pts, closed = false) {
      if (!Array.isArray(pts)) return;
      const clean = pts.filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
      if (clean.length < 2) return;
      addPolyline(layer, clean, closed);
    }

    // --- matrices 2D [a,b,c,d,e,f] ---
    function matI() { return [1, 0, 0, 1, 0, 0]; }
    function matT(tx, ty) { return [1, 0, 0, 1, tx, ty]; }
    function matS(sx, sy) { return [sx, 0, 0, sy, 0, 0]; }
    function matRdeg(deg) {
      const r = (Number(deg) || 0) * Math.PI / 180;
      const c = Math.cos(r), s = Math.sin(r);
      return [c, s, -s, c, 0, 0];
    }
    function matMul(A, B) {
      return [
        A[0] * B[0] + A[2] * B[1],
        A[1] * B[0] + A[3] * B[1],
        A[0] * B[2] + A[2] * B[3],
        A[1] * B[2] + A[3] * B[3],
        A[0] * B[4] + A[2] * B[5] + A[4],
        A[1] * B[4] + A[3] * B[5] + A[5],
      ];
    }
    function matApply(M, p) {
      return {
        x: M[0] * p.x + M[2] * p.y + M[4],
        y: M[1] * p.x + M[3] * p.y + M[5],
      };
    }
    function addPolylineTransformed(layer, pts, closed, M) {
      if (!M) return addPolylineSafe(layer, pts, closed);
      addPolylineSafe(layer, pts.map(p => matApply(M, p)), closed);
    }

    // --- geometría de apoyo ---
    function sampleEllipseOrArc(center, majorAxisEnd, axisRatio, startParam, endParam, M = null) {
      const cx = Number(center?.x);
      const cy = Number(center?.y);
      const mx = Number(majorAxisEnd?.x);
      const my = Number(majorAxisEnd?.y);
      const ratio = Number(axisRatio ?? 1);

      if (![cx, cy, mx, my, ratio].every(Number.isFinite)) return [];

      const a = Math.hypot(mx, my);
      if (!Number.isFinite(a) || a <= 0) return [];
      const b = a * ratio;
      const rot = Math.atan2(my, mx);

      let t0 = Number(startParam);
      let t1 = Number(endParam);
      let closed = false;

      if (!Number.isFinite(t0) || !Number.isFinite(t1)) {
        t0 = 0;
        t1 = TAU;
        closed = true;
      } else {
        while (t1 < t0) t1 += TAU;
        const span = t1 - t0;
        if (Math.abs(span - TAU) < 1e-6) closed = true;
      }

      const span = t1 - t0;
      const seg = clamp(Math.ceil(128 * (Math.abs(span) / TAU || 1)), 12, 512);

      const pts = [];
      for (let i = 0; i <= seg; i++) {
        const t = t0 + (span * i) / seg;
        const ex = a * Math.cos(t);
        const ey = b * Math.sin(t);
        const xr = ex * Math.cos(rot) - ey * Math.sin(rot);
        const yr = ex * Math.sin(rot) + ey * Math.cos(rot);
        pts.push({ x: cx + xr, y: cy + yr });
      }

      if (M) return { pts: pts.map(p => matApply(M, p)), closed };
      return { pts, closed };
    }

    // Bulge -> arco (para LWPOLYLINE/POLYLINE)
    function bulgeSegmentPoints(p0, p1, bulge, maxSeg = 48) {
      const b = Number(bulge || 0);
      if (!Number.isFinite(b) || Math.abs(b) < 1e-12) return [p0, p1];

      const x0 = Number(p0.x), y0 = Number(p0.y);
      const x1 = Number(p1.x), y1 = Number(p1.y);
      if (![x0, y0, x1, y1].every(Number.isFinite)) return [p0, p1];

      const dx = x1 - x0, dy = y1 - y0;
      const c = Math.hypot(dx, dy);
      if (!(c > 0)) return [p0, p1];

      // delta = 4 * atan(bulge)
      const delta = 4 * Math.atan(b);
      if (!Number.isFinite(delta) || Math.abs(delta) < 1e-12) return [p0, p1];

      const r = c / (2 * Math.sin(Math.abs(delta) / 2));
      if (!Number.isFinite(r) || r <= 0) return [p0, p1];

      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;

      const ux = dx / c;
      const uy = dy / c;
      const nx = -uy;
      const ny = ux;

      const h = Math.sqrt(Math.max(0, r * r - (c * c) / 4));
      const sign = (b >= 0) ? 1 : -1;

      const cx = mx + sign * nx * h;
      const cy = my + sign * ny * h;

      let a0 = Math.atan2(y0 - cy, x0 - cx);
      let a1 = Math.atan2(y1 - cy, x1 - cx);

      if (delta > 0) {
        while (a1 < a0) a1 += TAU;
      } else {
        while (a1 > a0) a1 -= TAU;
      }

      const span = a1 - a0;
      const n = clamp(Math.ceil(maxSeg * (Math.abs(span) / TAU)), 6, 256);

      const pts = [];
      for (let i = 0; i <= n; i++) {
        const a = a0 + (span * i) / n;
        pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
      }
      return pts;
    }

    function addLwPolylineWithBulge(layer, vertsRaw, closed, M = null) {
      const verts = (vertsRaw || []).map(v => ({
        x: Number(v.x),
        y: Number(v.y),
        bulge: Number(v.bulge || 0),
      })).filter(v => Number.isFinite(v.x) && Number.isFinite(v.y));

      if (verts.length < 2) return;

      const pts = [];
      const segCount = closed ? verts.length : (verts.length - 1);

      for (let i = 0; i < segCount; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        const segPts = bulgeSegmentPoints(a, b, a.bulge || 0, 48);

        if (segPts.length) {
          if (pts.length) pts.pop(); // evitar duplicado entre segmentos
          pts.push(...segPts);
        }
      }

      addPolylineTransformed(layer, pts, closed, M);
    }

    // SPLINE (B-spline / NURBS ligera)
    function findKnotSpan(n, p, u, U) {
      if (u >= U[n + 1]) return n;
      if (u <= U[p]) return p;
      let low = p, high = n + 1;
      let mid = Math.floor((low + high) / 2);
      while (u < U[mid] || u >= U[mid + 1]) {
        if (u < U[mid]) high = mid;
        else low = mid;
        mid = Math.floor((low + high) / 2);
      }
      return mid;
    }

    function deBoorPoint(p, U, ctrl, u, weights = null) {
      const n = ctrl.length - 1;
      if (n < p) return null;
      const k = findKnotSpan(n, p, u, U);

      if (weights && weights.length === ctrl.length) {
        // racional en homogéneas
        const d = [];
        for (let j = 0; j <= p; j++) {
          const idx = k - p + j;
          const w = Number(weights[idx] ?? 1) || 1;
          const x = Number(ctrl[idx].x), y = Number(ctrl[idx].y);
          d[j] = [x * w, y * w, w];
        }

        for (let r = 1; r <= p; r++) {
          for (let j = p; j >= r; j--) {
            const i = k - p + j;
            const den = (U[i + p - r + 1] - U[i]) || 1e-12;
            const alpha = (u - U[i]) / den;
            d[j][0] = (1 - alpha) * d[j - 1][0] + alpha * d[j][0];
            d[j][1] = (1 - alpha) * d[j - 1][1] + alpha * d[j][1];
            d[j][2] = (1 - alpha) * d[j - 1][2] + alpha * d[j][2];
          }
        }

        const w = d[p][2];
        if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
        return { x: d[p][0] / w, y: d[p][1] / w };
      }

      // no racional
      const d = [];
      for (let j = 0; j <= p; j++) {
        const idx = k - p + j;
        d[j] = { x: Number(ctrl[idx].x), y: Number(ctrl[idx].y) };
      }

      for (let r = 1; r <= p; r++) {
        for (let j = p; j >= r; j--) {
          const i = k - p + j;
          const den = (U[i + p - r + 1] - U[i]) || 1e-12;
          const alpha = (u - U[i]) / den;
          d[j] = {
            x: (1 - alpha) * d[j - 1].x + alpha * d[j].x,
            y: (1 - alpha) * d[j - 1].y + alpha * d[j].y,
          };
        }
      }

      return d[p];
    }

    function splineToPoints(e) {
      // Fallbacks sencillos primero (si parser ya trae puntos)
      const fitPts = Array.isArray(e.fitPoints) ? e.fitPoints.map(p => toXY(p)).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
      if (fitPts.length >= 2) return fitPts;

      const ctrl = (e.controlPoints || e.points || []).map(p => toXY(p)).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
      const U = (e.knotValues || e.knots || []).map(Number).filter(Number.isFinite);
      const weights = Array.isArray(e.weights) ? e.weights.map(Number) : null;

      const p = Number(e.degreeOfSplineCurve ?? e.degree ?? 3);
      if (ctrl.length < 2) return [];
      if (!Number.isFinite(p) || p < 1) return ctrl;

      if (!Array.isArray(U) || U.length < ctrl.length + p + 1) {
        // Si no hay knots válidos, al menos conecta puntos de control
        return ctrl;
      }

      const n = ctrl.length - 1;
      if (n < p) return ctrl;

      const u0 = U[p];
      const u1 = U[n + 1];
      if (!Number.isFinite(u0) || !Number.isFinite(u1) || u1 <= u0) return ctrl;

      const samples = clamp(Math.max(64, ctrl.length * 8), 32, 1500);
      const pts = [];

      for (let i = 0; i <= samples; i++) {
        // evitar exacto en borde final por span search
        const t = (i === samples) ? (u1 - 1e-10) : (u0 + (u1 - u0) * (i / samples));
        const pxy = deBoorPoint(p, U, ctrl, t, weights);
        if (pxy && Number.isFinite(pxy.x) && Number.isFinite(pxy.y)) {
          pts.push(pxy);
        }
      }

      // agrega punto final explícito si se puede
      const last = ctrl[ctrl.length - 1];
      if (pts.length && last) {
        const d = Math.hypot(pts[pts.length - 1].x - last.x, pts[pts.length - 1].y - last.y);
        if (d > 1e-6) pts.push(last);
      }

      return pts;
    }

    function getBlockByName(name) {
      const blocks = dxfObj?.blocks;
      if (!blocks || !name) return null;

      if (Array.isArray(blocks)) {
        return blocks.find(b => (b?.name || b?.blockName) === name) || null;
      }
      if (typeof blocks === "object") {
        return blocks[name] || null;
      }
      return null;
    }

    function ingestEntityRecursive(e, parentM = null, depth = 0) {
      if (!e || depth > 12) return;

      const layer = e.layer || "0";
      ensureLayer(layer).count++;

      switch (e.type) {
        case "LINE": {
          const p1src =
            e.start ||
            e.vertices?.[0] ||
            e.p1 ||
            ((Number.isFinite(e.x1) && Number.isFinite(e.y1)) ? { x: e.x1, y: e.y1 } : null);

          const p2src =
            e.end ||
            e.vertices?.[1] ||
            e.p2 ||
            ((Number.isFinite(e.x2) && Number.isFinite(e.y2)) ? { x: e.x2, y: e.y2 } : null);

          if (p1src && p2src) {
            addPolylineTransformed(layer, [toXY(p1src), toXY(p2src)], false, parentM);
          }
          break;
        }

        case "LWPOLYLINE": {
          const closed = (e.shape === true) || (((e.flags || 0) & 1) === 1);
          addLwPolylineWithBulge(layer, e.vertices || [], closed, parentM);
          break;
        }

        case "POLYLINE": {
          const verts = (e.vertices || []).map(v => ({
            x: Number(v.x),
            y: Number(v.y),
            bulge: Number(v.bulge || 0),
          }));
          const closed = (((e.flags || 0) & 1) === 1);
          addLwPolylineWithBulge(layer, verts, closed, parentM);
          break;
        }

        case "CIRCLE": {
          const cx = Number(e.center?.x ?? e.x);
          const cy = Number(e.center?.y ?? e.y);
          const r = Number(e.radius ?? e.r);
          if (!parentM) {
            addCircleAsPoly(layer, cx, cy, r, 96);
          } else {
            const pts = [];
            const seg = 96;
            for (let i = 0; i <= seg; i++) {
              const t = (i / seg) * TAU;
              pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
            }
            addPolylineTransformed(layer, pts, true, parentM);
          }
          break;
        }

        case "ARC": {
          const cx = Number(e.center?.x ?? e.x);
          const cy = Number(e.center?.y ?? e.y);
          const r = Number(e.radius ?? e.r);
          const a0 = Number(e.startAngle);
          const a1 = Number(e.endAngle);
          if (!parentM) {
            addArcAsPoly(layer, cx, cy, r, a0, a1, 96);
          } else {
            let s = (a0 * Math.PI) / 180;
            let t = (a1 * Math.PI) / 180;
            while (t < s) t += TAU;
            const span = t - s;
            const n = clamp(Math.ceil(96 * (span / TAU)), 8, 512);
            const pts = [];
            for (let i = 0; i <= n; i++) {
              const ang = s + (span * i) / n;
              pts.push({ x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) });
            }
            addPolylineTransformed(layer, pts, false, parentM);
          }
          break;
        }

        case "ELLIPSE": {
          // IMPORTANTE: muchas veces son arcos elípticos (Marco.dxf)
          const center = toXY(e.center);
          const major = toXY(e.majorAxisEndPoint || e.majorAxisEnd || e.majorEndPoint);
          const ratio = Number(e.axisRatio ?? 1);
          const startParam = Number.isFinite(Number(e.startParameter)) ? Number(e.startParameter) :
                            Number.isFinite(Number(e.startAngle)) ? Number(e.startAngle) :
                            Number.isFinite(Number(e.start)) ? Number(e.start) :
                            undefined;
          const endParam = Number.isFinite(Number(e.endParameter)) ? Number(e.endParameter) :
                          Number.isFinite(Number(e.endAngle)) ? Number(e.endAngle) :
                          Number.isFinite(Number(e.end)) ? Number(e.end) :
                          undefined;

          const result = sampleEllipseOrArc(center, major, ratio, startParam, endParam, parentM);
          if (result && Array.isArray(result.pts)) {
            addPolylineSafe(layer, result.pts, !!result.closed);
          }
          break;
        }

        case "SPLINE": {
          const pts = splineToPoints(e);
          addPolylineTransformed(layer, pts, false, parentM);
          break;
        }

        case "INSERT": {
          const blockName = e.name || e.block || e.blockName;
          const blk = getBlockByName(blockName);
          const blkEntities = blk?.entities;
          if (!Array.isArray(blkEntities) || !blkEntities.length) break;

          const insPos = toXY(e.position || e.insertPoint || { x: e.x, y: e.y });
          const rot = Number(e.rotation || 0);
          const sx = Number(e.xScale || e.scaleX || e.scale || 1);
          const sy = Number(e.yScale || e.scaleY || e.scale || 1);

          const base = toXY(blk.position || blk.basePoint || blk.origin || { x: 0, y: 0 });

          // local = T(insert) * R(rot) * S(scale) * T(-base)
          const local = matMul(
            matT(insPos.x, insPos.y),
            matMul(matRdeg(rot), matMul(matS(sx, sy), matT(-base.x, -base.y)))
          );

          const M = parentM ? matMul(parentM, local) : local;

          for (const child of blkEntities) {
            ingestEntityRecursive(child, M, depth + 1);
          }
          break;
        }

        default:
          // TEXT/MTEXT/HATCH/DIMENSION/... por ahora no se dibujan
          break;
      }
    }

    // ---------- ingest top-level ----------
    for (const e of ents) {
      ingestEntityRecursive(e, null, 0);
    }

    // Fallback de bbox usando EXTMIN/EXTMAX (sirve para dimensiones aunque algo no renderice)
    if (!bboxValid(state.bbox)) {
      const ext = extractExtents(dxfObj, rawText);
      state.bbox = ext || bboxInit();
    }

    // info UI
    dom.infoFile.textContent = state.dxfName || "—";
    dom.infoEnt.textContent = String(state.entCount || 0);
    dom.infoLay.textContent = String(state.layers.size || 0);
    updateUnitsUI();
    updateDimsUI();
    renderLayersUI();

    // fit
    resetView();
  }

  // --------- draw ---------
  function redraw() {
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;
    ctx.clearRect(0, 0, W, H);

    // background
    ctx.fillStyle = "#0a0f1a";
    ctx.fillRect(0, 0, W, H);

    // draw layers
    const lw = clamp(1 / state.view.scale, 0.6, 2.0);

    for (const [layer, paths] of state.pathsByLayer.entries()) {
      const L = state.layers.get(layer);
      if (!L || !L.visible) continue;

      ctx.strokeStyle = L.color;
      ctx.lineWidth = lw;
      ctx.beginPath();

      for (const p of paths) {
        const pts = p.pts;
        if (!pts || pts.length < 2) continue;
        const s0 = worldToScreen(pts[0]);
        ctx.moveTo(s0.x, s0.y);
        for (let i = 1; i < pts.length; i++) {
          const si = worldToScreen(pts[i]);
          ctx.lineTo(si.x, si.y);
        }
        if (p.closed) ctx.closePath();
      }

      ctx.stroke();
    }

    // ruler overlay
    if (state.ruler.active && state.ruler.p0 && state.ruler.p1) {
      const a = worldToScreen(state.ruler.p0);
      const b = worldToScreen(state.ruler.p1);
      const eff = getEffectiveUnits();
      const dmm = dist(state.ruler.p0, state.ruler.p1) * eff.mm;

      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = getCssVar("--ibero-red", "#E00034");
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      const label = `${dmm.toFixed(2)} mm`;
      const tx = (a.x + b.x) / 2;
      const ty = (a.y + b.y) / 2;

      ctx.font = "12px system-ui";
      const pad = 6;
      const w = ctx.measureText(label).width + pad * 2;
      const h = 18;

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1;

      ctx.beginPath();
      ctx.rect(tx - w / 2, ty - h / 2, w, h);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = "#111";
      ctx.fillText(label, tx - w / 2 + pad, ty + 4);

      ctx.restore();
    }
  }

  function fitToBBox() {
    if (!bboxValid(state.bbox)) {
      state.view = { scale: 1, panX: 0, panY: 0, cx: 0, cy: 0 };
      redraw();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const W = rect.width, H = rect.height;

    const w = state.bbox.maxX - state.bbox.minX;
    const h = state.bbox.maxY - state.bbox.minY;

    state.view.cx = (state.bbox.minX + state.bbox.maxX) / 2;
    state.view.cy = (state.bbox.minY + state.bbox.maxY) / 2;

    const s = Math.min((W * 0.9) / (w || 1), (H * 0.9) / (h || 1));
    state.view.scale = clamp(s, 0.0005, 1e6);
    state.view.panX = 0;
    state.view.panY = 0;

    redraw();
  }

  function resetView() {
    // “Reset view” = fit
    fitToBBox();
  }

  // --------- interactions ---------
  canvas.addEventListener("mousedown", (e) => {
    if (state.ruler.active) return;
    state.dragging = true;
    state.lastMouse = { x: e.clientX, y: e.clientY };
  });

  window.addEventListener("mouseup", () => {
    state.dragging = false;
  });

  window.addEventListener("mousemove", (e) => {
    if (state.ruler.active && state.ruler.drawing && state.ruler.p0) {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      state.ruler.p1 = screenToWorld(x, y);

      updateRulerReadout();
      redraw();
      return;
    }

    if (!state.dragging) return;
    const dx = e.clientX - state.lastMouse.x;
    const dy = e.clientY - state.lastMouse.y;
    state.lastMouse = { x: e.clientX, y: e.clientY };
    state.view.panX += dx;
    state.view.panY += dy;
    redraw();
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const before = screenToWorld(mx, my);

    const k = Math.exp(-e.deltaY * 0.0015);
    state.view.scale = clamp(state.view.scale * k, 0.0005, 1e6);

    const after = screenToWorld(mx, my);
    // keep point under mouse stable
    state.view.cx += (before.x - after.x);
    state.view.cy += (before.y - after.y);

    redraw();
  }, { passive: false });

  canvas.addEventListener("dblclick", () => resetView());

  // Drop DXF
  dom.viewerEl.addEventListener("dragover", (e) => {
    e.preventDefault();
  });
  dom.viewerEl.addEventListener("drop", async (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    await loadFromFile(f);
  });

  // ruler click handling
  function updateRulerReadout() {
    if (!dom.infoRuler) return;
    if (!state.ruler.p0 || !state.ruler.p1) {
      dom.infoRuler.textContent = "—";
      return;
    }
    const eff = getEffectiveUnits();
    const dmm = dist(state.ruler.p0, state.ruler.p1) * eff.mm;
    dom.infoRuler.textContent = `${dmm.toFixed(3)} mm`;
  }

  canvas.addEventListener("click", (e) => {
    if (!state.ruler.active) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const wp = screenToWorld(x, y);

    if (!state.ruler.p0 || !state.ruler.drawing) {
      state.ruler.p0 = wp;
      state.ruler.p1 = wp;
      state.ruler.drawing = true;
    } else {
      state.ruler.p1 = wp;
      state.ruler.drawing = false;
    }
    updateRulerReadout();
    redraw();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      clearRuler();
    }
  });

  function clearRuler() {
    state.ruler.p0 = null;
    state.ruler.p1 = null;
    state.ruler.drawing = false;
    updateRulerReadout();
    redraw();
  }

  function setRulerActive(on) {
    state.ruler.active = !!on;
    dom.btnRuler.classList.toggle("on", state.ruler.active);
    if (!state.ruler.active) clearRuler();
  }

  function isRulerActive() { return !!state.ruler.active; }

  // --------- public API ---------
  async function loadFromFile(file) {
    const buf = await file.arrayBuffer();

    // intento 1: UTF-8
    let text = new TextDecoder("utf-8", { fatal: false }).decode(buf);

    // si hay caracteres de reemplazo, prueba Windows-1252 (muy común en DXF)
    if (text.includes("\uFFFD")) {
      try {
        const t1252 = new TextDecoder("windows-1252", { fatal: false }).decode(buf);
        if (/\$DWGCODEPAGE/i.test(t1252) || /ANSI_1252/i.test(t1252)) {
          text = t1252;
        }
      } catch {
        try {
          text = new TextDecoder("iso-8859-1", { fatal: false }).decode(buf);
        } catch {}
      }
    }

    await loadFromText(text, file.name);
  }

  async function loadFromText(text, name = "archivo.dxf") {
    state.dxfText = text;
    state.dxfName = name;
    dom.infoFile.textContent = name;

    const Parser = window.DxfParser;
    if (!Parser) throw new Error("No se encontró DxfParser. Revisa el script CDN.");

    const p = new Parser();
    let obj = null;
    try {
      obj = p.parseSync(text);
      } catch (err) {
        console.error(err);

        // Aun si no parsea, intenta leer EXT y INSUNITS del texto para dimensiones
        state.insunits = extractInsunits(null, text);
        updateUnitsUI();

        const ext = extractExtents(null, text);
        if (ext) {
          state.bbox = ext;
          updateDimsUI();
          dom.unitsNote.textContent = "No se pudo renderizar, pero se detectaron EXTMIN/EXTMAX para dimensiones.";
        } else {
          dom.infoDims.textContent = "—";
          dom.unitsNote.textContent = "DXF inválido o no soportado.";
        }

        // limpia geometría visible
        state.pathsByLayer.clear();
        state.layers.clear();
        redraw();
        return;
      }

    ingestDxf(obj, text);
  }

  function clear() {
    state.dxfText = "";
    state.dxfName = "";
    state.dxfObj = null;
    state.pathsByLayer.clear();
    state.layers.clear();
    state.bbox = bboxInit();
    state.entCount = 0;
    state.insunits = 0;

    // reset view
    state.view = { scale: 1, panX: 0, panY: 0, cx: 0, cy: 0 };

    // reset UI
    dom.infoFile.textContent = "—";
    dom.infoEnt.textContent = "—";
    dom.infoLay.textContent = "—";
    dom.infoUnits.textContent = "—";
    dom.infoDims.textContent = "—";
    dom.unitsNote.textContent = "";
    dom.layersEl.innerHTML = "";
    dom.infoRuler.textContent = "—";

    clearRuler();
    redraw();
  }

  function setUnitsOverride(v) {
    state.unitsOverride = v || "auto";
    updateUnitsUI();
    updateDimsUI();
    updateRulerReadout();
    redraw();
  }

  function getCurrentDxf() {
    return state.dxfText ? { text: state.dxfText, name: state.dxfName || "export.dxf" } : null;
  }

  return {
    loadFromFile,
    loadFromText,
    clear,
    resetView,
    setUnitsOverride,
    getCurrentDxf,
    setRulerActive,
    isRulerActive,
  };
}