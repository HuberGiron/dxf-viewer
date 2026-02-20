/* SVG → DXF + DXF Viewer (Canvas)
   - Combina el convertidor (SVG→polilíneas→DXF R12) y el visor DXF 2D.
   - DXF units: lee $INSUNITS cuando existe, y permite override para calcular dimensiones en mm.
*/

(() => {
  // -----------------------------
  // DOM
  // -----------------------------
  const $ = (id) => document.getElementById(id);

  const modeViewBtn    = $("modeView");
  const modeConvertBtn = $("modeConvert");

  const dxfFileInput = $("dxfFile");
  const svgFileInput = $("svgFile");

  const btnPickDxf    = $("btnPickDxf");
  const btnPickSvg    = $("btnPickSvg");
  const btnDownload   = $("btnDownloadDxf");
  const btnFit        = $("btnFit");
  const btnReset      = $("btnReset");

  const convertPanel  = $("convertPanel");
  const svgDrop       = $("svgDrop");
  const svgScaleEl    = $("svgScale");
  const svgQualityEl  = $("svgQuality");
  const svgStitchEl   = $("svgStitch");
  const svgOutUnitsEl = $("svgOutUnits");
  const btnConvert    = $("btnConvert");
  const btnClear      = $("btnClear");
  const convertStatus = $("convertStatus");
  const svgPreview    = $("svgPreview");
  const svgPrevCtx    = svgPreview.getContext("2d");

  const infoFile  = $("infoFile");
  const infoEnt   = $("infoEnt");
  const infoLay   = $("infoLay");
  const infoUnits = $("infoUnits");
  const infoDims  = $("infoDims");
  const layersEl  = $("layers");

  const unitsOverride = $("unitsOverride");
  const unitsNote     = $("unitsNote");

  const canvas = $("dxfCanvas");
  const wrap   = canvas.parentElement;
  const ctx    = canvas.getContext("2d");
  const btnRuler  = $("btnRuler");
  const infoRuler = $("infoRuler");

  const svgOpenInfo = $("svgOpenInfo");
  const svgPreviewBlock = $("svgPreviewBlock");

  // -----------------------------
  // Units
  // -----------------------------
  // AutoCAD INSUNITS codes (subset + some extras)
  const INSUNITS = {
    0: { name: "unitless", mm: 1, metric: null },
    1: { name: "in",       mm: 25.4, metric: 0 },
    2: { name: "ft",       mm: 304.8, metric: 0 },
    4: { name: "mm",       mm: 1, metric: 1 },
    5: { name: "cm",       mm: 10, metric: 1 },
    6: { name: "m",        mm: 1000, metric: 1 },
    7: { name: "km",       mm: 1_000_000, metric: 1 },
    10:{ name: "yd",       mm: 914.4, metric: 0 }
  };

  function insunitsInfo(code){
    const k = Number(code);
    return INSUNITS[k] || { name: `code_${k}`, mm: 1, metric: null };
  }

  function parseInsunitsFromRaw(raw){
    if (!raw) return null;
    const m = raw.match(/(?:^|\n)9\s*\r?\n\$INSUNITS\s*\r?\n70\s*\r?\n(-?\d+)/i);
    if (m) return Number(m[1]);
    return null;
  }

  // Determine effective units for reporting dimensions.
  function getEffectiveUnits() {
    if (unitsOverride.value !== "auto") {
      const code = Number(unitsOverride.value);
      return { source: "override", code, ...insunitsInfo(code) };
    }
    const code = state.units?.code ?? null;
    if (code === null || code === undefined) {
      return { source: "unknown", code: 0, ...insunitsInfo(0) };
    }
    return { source: state.units?.source || "header", code, ...insunitsInfo(code) };
  }

  function formatUnitsInfo(u){
    if (!u) return "—";
    const label = u.name;
    const code = (u.code ?? "—");
    return `${label} (INSUNITS=${code})`;
  }

  // -----------------------------
  // DXF Viewer state
  // -----------------------------
  const state = {
    dxf: null,
    raw: "",
    fileName: "",
    pathsByLayer: new Map(), // layer -> { color, visible, paths: [ {points:[{x,y}], closed} ] }
    bbox: null, // {minX,minY,maxX,maxY}
    units: { code: null, source: "unknown" }, // detected insunits
    view: { scale: 1, panX: 0, panY: 0, centerX: 0, centerY: 0 },
    ruler: { active:false, p0:null, p1:null, drawing:false }
  };

  // HiDPI resize
  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width  = Math.max(1, Math.floor(rect.width  * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
    redraw();
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // Helpers
  const TAU = Math.PI * 2;

  function matIdentity(){ return {a:1,b:0,c:0,d:1,e:0,f:0}; }
  function matTranslate(tx,ty){ return {a:1,b:0,c:0,d:1,e:tx,f:ty}; }
  function matScale(sx,sy){ return {a:sx,b:0,c:0,d:sy,e:0,f:0}; }
  function matRotateDeg(deg){
    const r = deg * Math.PI/180;
    const cos = Math.cos(r), sin = Math.sin(r);
    return {a:cos,b:sin,c:-sin,d:cos,e:0,f:0};
  }
  function matMul(m1,m2){
    return {
      a: m1.a*m2.a + m1.c*m2.b,
      b: m1.b*m2.a + m1.d*m2.b,
      c: m1.a*m2.c + m1.c*m2.d,
      d: m1.b*m2.c + m1.d*m2.d,
      e: m1.a*m2.e + m1.c*m2.f + m1.e,
      f: m1.b*m2.e + m1.d*m2.f + m1.f
    };
  }
  function matApply(m, p){
    return { x: m.a*p.x + m.c*p.y + m.e, y: m.b*p.x + m.d*p.y + m.f };
  }

  function ensureBBox(b, p){
    if (!b) return {minX:p.x, minY:p.y, maxX:p.x, maxY:p.y};
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
    return b;
  }

  function hexFromTrueColor(n){
    if (typeof n !== 'number' || !isFinite(n)) return null;

    // DXF: si viene 1..255 normalmente es ACI (color index), NO truecolor
    if (n >= 0 && n <= 255) return null;

    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

    function aciToCss(aci){
    const a = Math.abs(Number(aci) || 0);
    const text = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#e6edf3';

    // ACI básicos (suficiente para la mayoría)
    const pal = {
      0: text,   // ByBlock / default → usa texto (alto contraste)
      1: '#ff3b30',
      2: '#ffd60a',
      3: '#34c759',
      4: '#5ac8fa',
      5: '#0a84ff',
      6: '#ff2d55',
      7: text,   // ACI 7: blanco/negro dependiente de fondo → aquí lo forzamos a claro
      8: '#8e8e93',
      9: '#c7c7cc',
    };
    return pal[a] || null;
  }
  function hashColor(str){
    let h=2166136261;
    for (let i=0;i<str.length;i++){ h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    const r = (h >>> 16) & 255, g = (h >>> 8) & 255, b = h & 255;
    const mix = (x) => Math.floor(80 + (x/255)*150);
    return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
  }

  // World <-> Screen (Y up in world, canvas has Y down)
  function worldToScreen(p){
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const v = state.view;
    const x = (p.x - v.centerX) * v.scale + (w/2) + v.panX;
    const y = (-(p.y - v.centerY)) * v.scale + (h/2) + v.panY;
    return {x,y};
  }
  function screenToWorld(x,y){
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const v = state.view;
    const wx = (x - (w/2) - v.panX) / v.scale + v.centerX;
    const wy = -((y - (h/2) - v.panY) / v.scale) + v.centerY;
    return {x:wx, y:wy};
  }

  function fitToBBox(){
    if (!state.bbox) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    const b = state.bbox;
    const bw = Math.max(1e-9, b.maxX - b.minX);
    const bh = Math.max(1e-9, b.maxY - b.minY);
    const margin = 0.92;
    const s = Math.min((w*margin)/bw, (h*margin)/bh);

    state.view.scale = s;
    state.view.panX = 0;
    state.view.panY = 0;
    state.view.centerX = (b.minX + b.maxX)/2;
    state.view.centerY = (b.minY + b.maxY)/2;
    redraw();
  }

  function resetView(){
    state.view = {scale:1, panX:0, panY:0, centerX:0, centerY:0};
    fitToBBox();
  }

  function clearRuler(){
  state.ruler.p0 = null;
  state.ruler.p1 = null;
  state.ruler.drawing = false;
  if (infoRuler) infoRuler.textContent = "—";
  redraw();
}

function setRulerActive(on){
  state.ruler.active = on;
  if (!on) clearRuler();
  btnRuler?.classList.toggle("on", on); // si quieres estilo de activo
}

btnRuler?.addEventListener("click", () => {
  setRulerActive(!state.ruler.active);
});

  // Geometry sampling
  function sampleArc(center, r, a0, a1, ccw=true){
    let start = a0, end = a1;
    if (ccw){
      while (end < start) end += TAU;
    } else {
      while (end > start) end -= TAU;
    }
    const sweep = end - start;
    const n = Math.max(6, Math.min(720, Math.ceil(Math.abs(sweep) / (Math.PI/18))));
    const pts = [];
    for (let i=0;i<=n;i++){
      const t = i/n;
      const a = start + sweep*t;
      pts.push({x:center.x + r*Math.cos(a), y:center.y + r*Math.sin(a)});
    }
    return pts;
  }

  function sampleCircle(center, r){
    const n = 96;
    const pts = [];
    for (let i=0;i<=n;i++){
      const a = (i/n)*TAU;
      pts.push({x:center.x + r*Math.cos(a), y:center.y + r*Math.sin(a)});
    }
    return pts;
  }

  function sampleEllipse(center, majorEnd, axisRatio, startParam, endParam){
    const rx = Math.hypot(majorEnd.x, majorEnd.y);
    const ry = rx * axisRatio;
    const rot = Math.atan2(majorEnd.y, majorEnd.x);

    let a0 = startParam, a1 = endParam;
    while (a1 < a0) a1 += TAU;
    const sweep = a1 - a0;

    const n = Math.max(12, Math.min(900, Math.ceil(sweep / (Math.PI/24))));
    const pts = [];
    for (let i=0;i<=n;i++){
      const t = i/n;
      const a = a0 + sweep*t;
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      const x = center.x + ex*Math.cos(rot) - ey*Math.sin(rot);
      const y = center.y + ex*Math.sin(rot) + ey*Math.cos(rot);
      pts.push({x,y});
    }
    return pts;
  }

  function bulgeToArcPoints(p1, p2, bulge){
    const b = bulge;
    if (!b || Math.abs(b) < 1e-12) return [p1, p2];

    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const c = Math.hypot(dx, dy);
    if (c < 1e-12) return [p1];

    const theta = 4 * Math.atan(b);
    const absTheta = Math.abs(theta);

    const r = c / (2 * Math.sin(absTheta/2));
    const mx = (p1.x + p2.x)/2;
    const my = (p1.y + p2.y)/2;

    const ux = dx / c, uy = dy / c;
    const px = -uy, py = ux; // left normal
    const d = Math.sqrt(Math.max(0, r*r - (c*c)/4));

    const sign = (b >= 0) ? 1 : -1;
    const cx = mx + px * d * sign;
    const cy = my + py * d * sign;

    const a0 = Math.atan2(p1.y - cy, p1.x - cx);
    const a1 = Math.atan2(p2.y - cy, p2.x - cx);

    const ccw = b >= 0;
    return sampleArc({x:cx,y:cy}, Math.abs(r), a0, a1, ccw);
  }

  // DXF flattening
  function addPath(layerName, points, closed=false){
    if (!points || points.length < 2) return;
    const layer = state.pathsByLayer.get(layerName);
    layer.paths.push({points, closed});
    for (const p of points) state.bbox = ensureBBox(state.bbox, p);
  }

  function safeLayerName(ent){
    return (ent && ent.layer) ? String(ent.layer) : "0";
  }

  function buildLayerTable(dxf){
    const map = new Map();
    const layersTable = dxf?.tables?.layer?.layers || {};
    for (const [name, L] of Object.entries(layersTable)){
      // dxf-parser puede exponer L.color como trueColor
      const aci = (L.colorNumber ?? L.color);      // depende cómo te lo dé dxf-parser
      const color =
        hexFromTrueColor(L.trueColor) ||
        aciToCss(aci) ||
        hashColor(name);
      map.set(name, { color, visible: L.visible !== false, paths: [] });
    }
    if (!map.has("0")) map.set("0", { color: hashColor("0"), visible: true, paths: [] });
    state.pathsByLayer = map;
  }

  function ensureLayer(layerName){
    if (!state.pathsByLayer.has(layerName)){
      state.pathsByLayer.set(layerName, { color: hashColor(layerName), visible: true, paths: [] });
    }
    return state.pathsByLayer.get(layerName);
  }

  function entityToPaths(ent, parentMat, depth=0){
    if (!ent || depth > 8) return;
    const type = String(ent.type || "").toUpperCase();
    const layerName = safeLayerName(ent);
    ensureLayer(layerName);

    const M = parentMat || matIdentity();
    const pt = (obj) => ({x: Number(obj.x||0), y: Number(obj.y||0)});

    if (type === "LINE"){
      const p1 = matApply(M, pt(ent.start || ent.vertices?.[0] || ent.p1 || {x:0,y:0}));
      const p2 = matApply(M, pt(ent.end   || ent.vertices?.[1] || ent.p2 || {x:0,y:0}));
      addPath(layerName, [p1,p2], false);
      return;
    }

    if (type === "LWPOLYLINE" || type === "POLYLINE"){
      const verts = ent.vertices || [];
      if (verts.length < 2) return;
      const closed = !!(ent.closed || ent.shape);

      let pts = [];
      for (let i=0;i<verts.length-1;i++){
        const v1 = verts[i], v2 = verts[i+1];
        const p1w = matApply(M, pt(v1));
        const p2w = matApply(M, pt(v2));
        const bulge = Number(v1.bulge || 0);

        if (Math.abs(bulge) > 1e-12){
          const arcPts = bulgeToArcPoints(p1w, p2w, bulge);
          if (pts.length) arcPts.shift();
          pts.push(...arcPts);
        } else {
          if (!pts.length) pts.push(p1w);
          pts.push(p2w);
        }
      }

      if (closed){
        const vLast = verts[verts.length-1];
        const v0 = verts[0];
        const p1w = matApply(M, pt(vLast));
        const p2w = matApply(M, pt(v0));
        const bulge = Number(vLast.bulge || 0);

        if (Math.abs(bulge) > 1e-12){
          const arcPts = bulgeToArcPoints(p1w, p2w, bulge);
          arcPts.shift();
          pts.push(...arcPts);
        } else {
          pts.push(p2w);
        }
      }

      addPath(layerName, pts, closed);
      return;
    }

    if (type === "CIRCLE"){
      const c = matApply(M, pt(ent.center || {x:0,y:0}));
      const r = Number(ent.radius || 0);
      addPath(layerName, sampleCircle(c, r), true);
      return;
    }

    if (type === "ARC"){
      const c = matApply(M, pt(ent.center || {x:0,y:0}));
      const r = Number(ent.radius || 0);
      const a0 = Number(ent.startAngle || 0) * Math.PI/180;
      const a1 = Number(ent.endAngle || 0) * Math.PI/180;
      addPath(layerName, sampleArc(c, r, a0, a1, true), false);
      return;
    }

    if (type === "ELLIPSE"){
      const c = matApply(M, pt(ent.center || {x:0,y:0}));
      const major = ent.majorAxisEndPoint || ent.majorEndPoint || {x:1,y:0};
      const axisRatio = Number(ent.axisRatio || 1);
      const sp = Number(ent.startParam || 0);
      const ep = Number(ent.endParam || TAU);

      const raw = sampleEllipse(pt(ent.center||{x:0,y:0}), pt(major), axisRatio, sp, ep);
      const pts = raw.map(p => matApply(M, p));
      addPath(layerName, pts, false);
      return;
    }

    if (type === "INSERT"){
      const name = ent.name || ent.block || ent.blockName;
      const blk = state.dxf?.blocks ? state.dxf.blocks[name] : null;
      if (!blk || !blk.entities) return;

      const insPos = pt(ent.position || ent.insertPoint || {x:0,y:0});
      const rot = Number(ent.rotation || 0);
      const sx = Number(ent.xScale || ent.scaleX || ent.scale || 1);
      const sy = Number(ent.yScale || ent.scaleY || ent.scale || 1);
      const base = pt(blk.position || {x:0,y:0});

      const T1 = matTranslate(-base.x, -base.y);
      const RS = matMul(matRotateDeg(rot), matScale(sx, sy));
      const T2 = matTranslate(insPos.x, insPos.y);

      const local = matMul(T2, matMul(RS, T1));
      const composed = matMul(M, local);

      for (const e of blk.entities){
        entityToPaths(e, composed, depth+1);
      }
      return;
    }

    // Otros tipos se ignoran por simplicidad (HATCH/DIMENSION/SPLINE complejo, etc.)
  }

  function rebuildFromDXF(dxf){
    state.dxf = dxf;
    state.bbox = null;
    buildLayerTable(dxf);

    const rootMat = matIdentity();
    const ents = dxf.entities || [];
    for (const ent of ents) entityToPaths(ent, rootMat, 0);

    // Asegura que capas referenciadas existan
    for (const ent of ents) ensureLayer(safeLayerName(ent));
  }

  // Layers UI
  function renderLayersUI(){
    layersEl.innerHTML = "";
    const layerNames = Array.from(state.pathsByLayer.keys()).sort((a,b)=>a.localeCompare(b));
    for (const name of layerNames){
      const L = state.pathsByLayer.get(name);

      const row = document.createElement("div");
      row.className = "layerRow";

      const sw = document.createElement("div");
      sw.className = "swatch";
      sw.style.background = L.color;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!L.visible;
      cb.addEventListener("change", () => { L.visible = cb.checked; redraw(); });

      const lab = document.createElement("label");
      lab.textContent = name;

      row.appendChild(sw);
      row.appendChild(cb);
      row.appendChild(lab);
      layersEl.appendChild(row);
    }
  }

  // Drawing
  function redraw(){
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (w <= 0 || h <= 0) return;

    ctx.clearRect(0,0,w,h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0,0,w,h);

    if (!state.dxf) return;

    ctx.lineWidth = 1;
    ctx.lineJoin = "round";
    ctx.lineCap  = "round";

    for (const [layerName, L] of state.pathsByLayer){
      if (!L.visible || !L.paths.length) continue;

      ctx.strokeStyle = L.color;
      ctx.beginPath();

      for (const path of L.paths){
        const pts = path.points;
        if (!pts || pts.length < 2) continue;
        const p0 = worldToScreen(pts[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i=1;i<pts.length;i++){
          const pi = worldToScreen(pts[i]);
          ctx.lineTo(pi.x, pi.y);
        }
      }
      ctx.stroke();
    }

    if (state.ruler.active && state.ruler.p0 && state.ruler.p1) {
      const a = worldToScreen(state.ruler.p0);
      const b = worldToScreen(state.ruler.p1);

      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#e00034";
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      // texto en pantalla
      const eff = getEffectiveUnits();
      const dU = Math.hypot(state.ruler.p1.x - state.ruler.p0.x, state.ruler.p1.y - state.ruler.p0.y);
      const dMM = dU * eff.mm;

      const tx = (a.x + b.x)/2;
      const ty = (a.y + b.y)/2;

      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 1;
      const label = `${dMM.toFixed(2)} mm`;
      ctx.font = "12px system-ui";
      const pad = 6;
      const w = ctx.measureText(label).width + pad*2;
      const h = 18;

      ctx.beginPath();
      ctx.rect(tx - w/2, ty - h/2, w, h);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#111";
      ctx.fillText(label, tx - w/2 + pad, ty + 4);
      ctx.restore();
    }
  }

  // -----------------------------
  // Load DXF from text / file
  // -----------------------------
  function updateInfoUI(){
    const dxf = state.dxf;
    const ents = (dxf?.entities || []).length;
    const lay  = state.pathsByLayer.size;

    infoFile.textContent = state.fileName || "—";
    infoEnt.textContent  = dxf ? String(ents) : "—";
    infoLay.textContent  = dxf ? String(lay)  : "—";

    const eff = getEffectiveUnits();
    infoUnits.textContent = dxf ? formatUnitsInfo(state.units) : "—";

    if (!dxf) {
      infoDims.textContent = "—";
      unitsNote.textContent = "";
      btnDownload.disabled = true;
      return;
    }

    // note about units source
    if (eff.source === "override") {
      unitsNote.textContent = `Usando override: ${eff.name}.`;
    } else if (eff.source === "header") {
      unitsNote.textContent = `Detectado desde DXF (HEADER).`;
    } else if (eff.source === "raw") {
      unitsNote.textContent = `Detectado desde el texto DXF.`;
    } else {
      unitsNote.textContent = `No se detectó INSUNITS: interpreta con override si necesitas mm exactos.`;
    }

    if (state.bbox){
      const b = state.bbox;
      const wU = b.maxX - b.minX;
      const hU = b.maxY - b.minY;
      const mmFactor = eff.mm;

      const wMM = wU * mmFactor;
      const hMM = hU * mmFactor;

      infoDims.textContent = `${wU.toFixed(3)} × ${hU.toFixed(3)} (${eff.name})  |  ${wMM.toFixed(3)} × ${hMM.toFixed(3)} (mm)`;
    } else {
      infoDims.textContent = "—";
    }

    btnDownload.disabled = !state.raw;
  }

  

  function detectUnits(dxf, raw){
    // 1) header object
    let code = null;
    if (dxf?.header) {
      // dxf-parser uses "$INSUNITS" keys in header
      if (typeof dxf.header.$INSUNITS !== "undefined") code = Number(dxf.header.$INSUNITS);
      else if (typeof dxf.header.INSUNITS !== "undefined") code = Number(dxf.header.INSUNITS);
    }
    if (code !== null && isFinite(code)) return { code, source: "header" };

    // 2) raw text scan
    const scanned = parseInsunitsFromRaw(raw);
    if (scanned !== null && isFinite(scanned)) return { code: scanned, source: "raw" };

    return { code: null, source: "unknown" };
  }

  function loadDxfFromText(text, filename="(sin nombre)"){
    if (!text) return;
    if (!window.DxfParser) {
      alert("No se cargó dxf-parser. Revisa tu conexión o el script del CDN.");
      return;
    }

    try {
      const parser = new window.DxfParser();
      const dxf = parser.parseSync(text);
      if (!dxf) throw new Error("No se pudo parsear el DXF (parser devolvió null).");

      state.raw = text;
      state.fileName = filename;
      state.units = detectUnits(dxf, text);

      rebuildFromDXF(dxf);
      renderLayersUI();
      fitToBBox();
      updateInfoUI();

      // habilita descarga
      btnDownload.disabled = false;
    } catch (err) {
      console.error(err);
      clearDxfState(`Error: ${err.message || err}`);
    }
  }

  async function loadDxfFile(file){
    if (!file) return;
    const text = await file.text();
    loadDxfFromText(text, file.name);
  }

  function clearDxfState(message="—"){
    state.dxf = null;
    state.raw = "";
    state.fileName = "";
    state.pathsByLayer = new Map();
    state.bbox = null;
    state.units = { code: null, source: "unknown" };

    layersEl.innerHTML = "";
    redraw();
    updateInfoUI();
    if (message && message !== "—") console.warn(message);

    state.view = { scale: 1, panX: 0, panY: 0, centerX: 0, centerY: 0 };
    redraw();
  }

  // Download
  function downloadCurrentDxf(){
    if (!state.raw) return;
    const blob = new Blob([state.raw], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const base = (state.fileName || "export.dxf").replace(/[\\\/:*?"<>|]+/g, "_");
    a.href = url;
    a.download = base.endsWith(".dxf") ? base : (base + ".dxf");
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 800);
  }

  btnDownload.addEventListener("click", downloadCurrentDxf);

  // -----------------------------
  // Canvas interactions (Pan/Zoom/Drop)
  // -----------------------------
  ;["dragenter","dragover"].forEach(evt => {
    wrap.addEventListener(evt, (e) => {
      e.preventDefault();
      wrap.classList.add("dropzone","dragover");
    });
  });
  ;["dragleave","drop"].forEach(evt => {
    wrap.addEventListener(evt, (e) => {
      e.preventDefault();
      wrap.classList.remove("dropzone","dragover");
    });
  });
  wrap.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    btnDownload.classList.remove("hot");
    if (f) loadDxfFile(f);
  });

  // Pan
  let dragging = false;
  let last = {x:0,y:0};

  canvas.addEventListener("mousedown", (e) => {
    if (state.ruler.active) return;   // ← evita pan si regla activa
    dragging = true;
    last = {x:e.clientX, y:e.clientY};
  });

  window.addEventListener("mouseup", () => dragging = false);
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = {x:e.clientX, y:e.clientY};
    state.view.panX += dx;
    state.view.panY += dy;
    redraw();
  });

  // Zoom at cursor
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!state.dxf) return;

    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const before = screenToWorld(mx, my);
    const zoomIn = e.deltaY < 0;
    const factor = zoomIn ? 1.12 : 1/1.12;

    const v = state.view;
    v.scale = Math.max(1e-6, Math.min(1e6, v.scale * factor));

    const afterScreen = worldToScreen(before);
    v.panX += (mx - afterScreen.x);
    v.panY += (my - afterScreen.y);

    redraw();
  }, { passive:false });

  canvas.addEventListener("dblclick", () => fitToBBox());

  // Buttons
  if (btnReset) btnReset.addEventListener("click", resetView);
  // if (btnFit) btnFit.addEventListener("click", fitToBBox);  // ← eliminar o comentar

  // Units override change
  unitsOverride.addEventListener("change", updateInfoUI);

  // DXF input
  dxfFileInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    btnDownload.classList.remove("hot");
    if (f) loadDxfFile(f);
  });

  // -----------------------------
  // Mode toggling
  // -----------------------------
  function setMode(mode){
    // mode: "view" | "convert"
    const isConvert = mode === "convert";
    modeViewBtn.classList.toggle("on", !isConvert);
    modeConvertBtn.classList.toggle("on", isConvert);

    convertPanel.style.display = isConvert ? "" : "none";
    btnPickSvg.style.display = isConvert ? "" : "none";

    btnPickDxf.style.display = isConvert ? "none" : "";
    dxfFileInput.disabled = isConvert;
    if (isConvert) updateSvgUi();
  }

  function updateSvgUi() {
    const hasSvg = !!lastSvgFile || (svgFileInput.files && svgFileInput.files.length > 0);

    // Dropzone visible SOLO cuando NO hay SVG cargado
    if (svgDrop) svgDrop.style.display = hasSvg ? "none" : "";

    // Vista previa visible SOLO cuando SÍ hay SVG cargado
    if (svgPreviewBlock) svgPreviewBlock.style.display = hasSvg ? "" : "none";

    // Botón superior "Cargar SVG" visible SOLO cuando NO hay SVG cargado (en modo convert)
    const isConvert = modeConvertBtn.classList.contains("on");
    if (btnPickSvg) btnPickSvg.style.display = (isConvert && !hasSvg) ? "" : "none";
  }

  function hardReset(mode){
    // apaga regla si existe
    if (typeof setRulerActive === "function") setRulerActive(false);

    // limpia DXF (quita archivo, info, capas, descarga)
    clearDxfState();

    // limpia inputs de archivos (para poder volver a abrir el mismo)
    dxfFileInput.value = "";
    btnDownload.classList.remove("hot");   // (ver cambio #3)
    btnDownload.disabled = true;

    if (mode === "convert") {
      // limpia SVG + preview + estado del convertidor
      svgFileInput.value = "";
      lastSvgFile = null;
      updateSvgUi();
      svgPrevCtx.clearRect(0, 0, svgPreview.width, svgPreview.height);

      if (svgOpenInfo) svgOpenInfo.textContent = "SVG: —"; // (ver cambio #2)
      logConvert("Listo. Carga un SVG para convertir.", "");
    }
  }

  modeViewBtn.addEventListener("click", () => {
    hardReset("view");
    setMode("view");
  });

  modeConvertBtn.addEventListener("click", () => {
    hardReset("convert");
    setMode("convert");
  });

  // default
  setMode("view");

  /// RULER /////
  function updateRulerReadout(){
  if (!infoRuler) return;
  const r = state.ruler;
  if (!r.p0 || !r.p1) { infoRuler.textContent = "—"; return; }

  const dU = Math.hypot(r.p1.x - r.p0.x, r.p1.y - r.p0.y);
  const eff = getEffectiveUnits();
  const dMM = dU * eff.mm;

  infoRuler.textContent = `${dMM.toFixed(3)} mm`;
}

canvas.addEventListener("click", (e) => {
  if (!state.ruler.active) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const wp = screenToWorld(mx, my);

  const r = state.ruler;

  // 1er click: fija inicio y empieza "drawing"
  if (!r.p0 || !r.drawing) {
    r.p0 = wp;
    r.p1 = wp;
    r.drawing = true;
  } else {
    // 2do click: fija fin y termina
    r.p1 = wp;
    r.drawing = false;
  }

  updateRulerReadout();
  redraw();
});

window.addEventListener("mousemove", (e) => {
  const r = state.ruler;
  if (!r.active || !r.drawing || !r.p0) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  r.p1 = screenToWorld(mx, my);

  updateRulerReadout();
  redraw();
});

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") clearRuler();
});



  // -----------------------------
  // SVG → DXF conversion (from your convertidor.html)
  // -----------------------------
  function logConvert(msg, kind=""){
    const prefix = kind ? `[${kind}] ` : "";
    convertStatus.textContent = prefix + msg;
  }

  function parseSvgText(svgText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgText, "image/svg+xml");
    const svg = doc.documentElement;
    const parseError = doc.querySelector("parsererror");
    if (parseError) throw new Error("SVG inválido / error de parseo.");
    return svg;
  }

  // Matrices 2D [a b c d e f]
  function matI(){ return [1,0,0,1,0,0]; }
  function matMul2(m1, m2){
    const [a1,b1,c1,d1,e1,f1] = m1;
    const [a2,b2,c2,d2,e2,f2] = m2;
    return [
      a1*a2 + c1*b2,
      b1*a2 + d1*b2,
      a1*c2 + c1*d2,
      b1*c2 + d1*d2,
      a1*e2 + c1*f2 + e1,
      b1*e2 + d1*f2 + f1
    ];
  }
  function matApply2(m, p){
    const [a,b,c,d,e,f] = m;
    return { x: a*p.x + c*p.y + e, y: b*p.x + d*p.y + f };
  }

  function parseTransform(attr) {
    if (!attr) return matI();
    let s = attr.trim();
    let m = matI();

    const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    let match;
    while ((match = re.exec(s)) !== null) {
      const cmd = match[1].toLowerCase();
      const args = match[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
      let t = matI();

      if (cmd === "matrix") {
        if (args.length >= 6) t = [args[0],args[1],args[2],args[3],args[4],args[5]];
      } else if (cmd === "translate") {
        const tx = args[0] || 0, ty = args[1] || 0;
        t = [1,0,0,1,tx,ty];
      } else if (cmd === "scale") {
        const sx = (args[0] ?? 1), sy = (args[1] ?? sx);
        t = [sx,0,0,sy,0,0];
      } else if (cmd === "rotate") {
        const ang = (args[0] || 0) * Math.PI / 180;
        const cos = Math.cos(ang), sin = Math.sin(ang);
        const cx = args[1] || 0, cy = args[2] || 0;
        const T1 = [1,0,0,1,cx,cy];
        const R  = [cos,sin,-sin,cos,0,0];
        const T2 = [1,0,0,1,-cx,-cy];
        t = matMul2(matMul2(T1,R),T2);
      } else if (cmd === "skewx") {
        const ang = (args[0] || 0) * Math.PI / 180;
        t = [1,0,Math.tan(ang),1,0,0];
      } else if (cmd === "skewy") {
        const ang = (args[0] || 0) * Math.PI / 180;
        t = [1,Math.tan(ang),0,1,0,0];
      } else {
        // ignore unsupported
        t = matI();
      }

      m = matMul2(m, t);
    }
    return m;
  }

  // geometry helpers
  function dist(a,b){ const dx=a.x-b.x, dy=a.y-b.y; return Math.hypot(dx,dy); }
  function nearly(a,b,eps){ return Math.abs(a-b) <= eps; }

  function cubicBezier(p0,p1,p2,p3,t){
    const u=1-t;
    const tt=t*t, uu=u*u;
    const uuu=uu*u, ttt=tt*t;
    return {
      x: uuu*p0.x + 3*uu*t*p1.x + 3*u*tt*p2.x + ttt*p3.x,
      y: uuu*p0.y + 3*uu*t*p1.y + 3*u*tt*p2.y + ttt*p3.y
    };
  }
  function quadBezier(p0,p1,p2,t){
    const u=1-t;
    return {
      x: u*u*p0.x + 2*u*t*p1.x + t*t*p2.x,
      y: u*u*p0.y + 2*u*t*p1.y + t*t*p2.y
    };
  }

  function arcToPolyline(cx, cy, rx, ry, phiDeg, theta1, dtheta, segs) {
    const phi = phiDeg * Math.PI/180;
    const cosP = Math.cos(phi), sinP = Math.sin(phi);
    const pts = [];
    for (let i=0;i<=segs;i++){
      const t = i/segs;
      const ang = theta1 + dtheta*t;
      const x = rx*Math.cos(ang);
      const y = ry*Math.sin(ang);
      const xr = x*cosP - y*sinP + cx;
      const yr = x*sinP + y*cosP + cy;
      pts.push({x:xr, y:yr});
    }
    return pts;
  }

  // PATH parsing
  function tokenizePath(d){
    const tokens = [];
    const re = /([a-zA-Z])|([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/g;
    let m;
    while ((m = re.exec(d)) !== null) tokens.push(m[0]);
    return tokens;
  }

  function svgArcToPoints(p0, p1, rx, ry, phiDeg, largeArc, sweep, segs){
    rx = Math.abs(rx); ry = Math.abs(ry);
    if (rx < 1e-12 || ry < 1e-12) return [p0, p1];

    const phi = phiDeg * Math.PI/180;
    const cosP = Math.cos(phi), sinP = Math.sin(phi);

    const dx = (p0.x - p1.x) / 2;
    const dy = (p0.y - p1.y) / 2;
    const x1p = cosP*dx + sinP*dy;
    const y1p = -sinP*dx + cosP*dy;

    const lam = (x1p*x1p)/(rx*rx) + (y1p*y1p)/(ry*ry);
    if (lam > 1) { const s = Math.sqrt(lam); rx *= s; ry *= s; }

    const rx2=rx*rx, ry2=ry*ry;
    const num = rx2*ry2 - rx2*y1p*y1p - ry2*x1p*x1p;
    const den = rx2*y1p*y1p + ry2*x1p*x1p;
    let cc = Math.sqrt(Math.max(0, num/Math.max(1e-12,den)));
    if (largeArc === sweep) cc = -cc;

    const cxp = cc * (rx*y1p)/ry;
    const cyp = cc * (-ry*x1p)/rx;

    const cx = cosP*cxp - sinP*cyp + (p0.x + p1.x)/2;
    const cy = sinP*cxp + cosP*cyp + (p0.y + p1.y)/2;

    function angle(u,v){
      const dot = u.x*v.x + u.y*v.y;
      const det = u.x*v.y - u.y*v.x;
      return Math.atan2(det, dot);
    }

    const v1 = { x:(x1p - cxp)/rx, y:(y1p - cyp)/ry };
    const v2 = { x:(-x1p - cxp)/rx, y:(-y1p - cyp)/ry };

    let theta1 = angle({x:1,y:0}, v1);
    let dtheta = angle(v1, v2);

    if (!sweep && dtheta > 0) dtheta -= 2*Math.PI;
    if (sweep && dtheta < 0) dtheta += 2*Math.PI;

    return arcToPolyline(cx, cy, rx, ry, phiDeg, theta1, dtheta, segs);
  }

  function pathToPolylines(d, quality) {
    const tokens = tokenizePath(d);
    let i=0;
    const polys = [];
    let cur = {x:0,y:0};
    let start = {x:0,y:0};
    let lastCtrl = null;
    let curPoly = null;

    function ensurePoly(){
      if (!curPoly) { curPoly = { closed:false, pts:[] }; polys.push(curPoly); }
    }
    function addPt(p){
      ensurePoly();
      const last = curPoly.pts[curPoly.pts.length-1];
      if (!last || !nearly(last.x,p.x,1e-9) || !nearly(last.y,p.y,1e-9)) curPoly.pts.push({x:p.x,y:p.y});
    }
    function closePoly(){
      if (curPoly && curPoly.pts.length>1) curPoly.closed = true;
      curPoly = null;
    }

    function nextNum(){ return Number(tokens[i++]); }

    while (i < tokens.length) {
      const tok = tokens[i++];
      if (!isNaN(tok)) throw new Error("PATH parse error: número donde esperaba comando.");
      let cmd = tok;
      const isRel = (cmd === cmd.toLowerCase());
      cmd = cmd.toUpperCase();

      const getPoint = () => {
        const x = nextNum(), y = nextNum();
        return isRel ? {x:cur.x+x, y:cur.y+y} : {x, y};
      };

      if (cmd === "M") {
        const p = getPoint();
        cur = p; start = p;
        closePoly();
        curPoly = {closed:false, pts:[{x:cur.x,y:cur.y}]}; polys.push(curPoly);
        lastCtrl = null;
        while (i < tokens.length && !isNaN(tokens[i])) {
          const p2 = getPoint();
          addPt(p2);
          cur = p2;
        }
      } else if (cmd === "L") {
        while (i < tokens.length && !isNaN(tokens[i])) {
          const p = getPoint();
          addPt(p); cur = p; lastCtrl = null;
        }
      } else if (cmd === "H") {
        while (i < tokens.length && !isNaN(tokens[i])) {
          const x = nextNum();
          const nx = isRel ? cur.x + x : x;
          const p = {x:nx, y:cur.y};
          addPt(p); cur = p; lastCtrl = null;
        }
      } else if (cmd === "V") {
        while (i < tokens.length && !isNaN(tokens[i])) {
          const y = nextNum();
          const ny = isRel ? cur.y + y : y;
          const p = {x:cur.x, y:ny};
          addPt(p); cur = p; lastCtrl = null;
        }
      } else if (cmd === "C") {
        while (i < tokens.length && !isNaN(tokens[i])) {
          const p1 = getPoint();
          const p2 = getPoint();
          const p3 = getPoint();
          const p0 = {...cur};
          const segs = Math.max(4, quality|0);
          for (let k=1;k<=segs;k++){
            const t = k/segs;
            addPt(cubicBezier(p0,p1,p2,p3,t));
          }
          cur = p3;
          lastCtrl = p2;
        }
      } else if (cmd === "S") {
        while (i < tokens.length && !isNaN(tokens[i])) {
          const p2 = getPoint();
          const p3 = getPoint();
          const p0 = {...cur};
          let p1;
          if (lastCtrl) p1 = { x: 2*cur.x - lastCtrl.x, y: 2*cur.y - lastCtrl.y };
          else p1 = {...cur};
          const segs = Math.max(4, quality|0);
          for (let k=1;k<=segs;k++){
            const t = k/segs;
            addPt(cubicBezier(p0,p1,p2,p3,t));
          }
          cur = p3;
          lastCtrl = p2;
        }
      } else if (cmd === "Q") {
        while (i < tokens.length && !isNaN(tokens[i])) {
          const p1 = getPoint();
          const p2 = getPoint();
          const p0 = {...cur};
          const segs = Math.max(4, quality|0);
          for (let k=1;k<=segs;k++){
            const t = k/segs;
            addPt(quadBezier(p0,p1,p2,t));
          }
          cur = p2;
          lastCtrl = p1;
        }
      } else if (cmd === "T") {
        while (i < tokens.length && !isNaN(tokens[i])) {
          const p2 = getPoint();
          const p0 = {...cur};
          let p1;
          if (lastCtrl) p1 = { x: 2*cur.x - lastCtrl.x, y: 2*cur.y - lastCtrl.y };
          else p1 = {...cur};
          const segs = Math.max(4, quality|0);
          for (let k=1;k<=segs;k++){
            const t = k/segs;
            addPt(quadBezier(p0,p1,p2,t));
          }
          cur = p2;
          lastCtrl = p1;
        }
      } else if (cmd === "A") {
        while (i < tokens.length && !isNaN(tokens[i])) {
          const rx0 = nextNum(), ry0 = nextNum();
          const xRot = nextNum();
          const large = nextNum(), sweep = nextNum();
          const end = getPoint();
          const arcPts = svgArcToPoints(cur, end, rx0, ry0, xRot, !!large, !!sweep, Math.max(8, quality|0));
          for (let k=1;k<arcPts.length;k++) addPt(arcPts[k]);
          cur = end;
          lastCtrl = null;
        }
      } else if (cmd === "Z") {
        addPt(start);
        closePoly();
        cur = start;
        lastCtrl = null;
      } else {
        lastCtrl = null;
      }
    }
    return polys.filter(p => p.pts.length >= 2);
  }

  function elementToPolylines(el, quality) {
    const tag = el.tagName.toLowerCase();
    const polys = [];

    if (tag === "path") {
      const d = el.getAttribute("d") || "";
      if (d.trim()) polys.push(...pathToPolylines(d, quality));
    } else if (tag === "line") {
      const x1 = +el.getAttribute("x1") || 0;
      const y1 = +el.getAttribute("y1") || 0;
      const x2 = +el.getAttribute("x2") || 0;
      const y2 = +el.getAttribute("y2") || 0;
      polys.push({closed:false, pts:[{x:x1,y:y1},{x:x2,y:y2}]});
    } else if (tag === "polyline" || tag === "polygon") {
      const pts = (el.getAttribute("points") || "")
        .trim().split(/[\s,]+/).filter(Boolean).map(Number);
      const out = [];
      for (let i=0;i+1<pts.length;i+=2) out.push({x:pts[i], y:pts[i+1]});
      polys.push({closed: tag==="polygon", pts: out});
    } else if (tag === "rect") {
      const x = +el.getAttribute("x") || 0;
      const y = +el.getAttribute("y") || 0;
      const w = +el.getAttribute("width") || 0;
      const h = +el.getAttribute("height") || 0;
      const rx = +el.getAttribute("rx") || 0;
      const ry = +el.getAttribute("ry") || 0;
      if (rx>0 || ry>0) {
        const rrx = rx || ry;
        const rry = ry || rx;
        const segs = Math.max(8, quality|0);
        const pts2 = [];
        pts2.push(...arcToPolyline(x+rrx, y+rry, rrx, rry, 0, Math.PI, Math.PI/2, Math.floor(segs/4)).slice(0,-1));
        pts2.push(...arcToPolyline(x+w-rrx, y+rry, rrx, rry, 0, 1.5*Math.PI, Math.PI/2, Math.floor(segs/4)).slice(0,-1));
        pts2.push(...arcToPolyline(x+w-rrx, y+h-rry, rrx, rry, 0, 0, Math.PI/2, Math.floor(segs/4)).slice(0,-1));
        pts2.push(...arcToPolyline(x+rrx, y+h-rry, rrx, rry, 0, 0.5*Math.PI, Math.PI/2, Math.floor(segs/4)));
        polys.push({closed:true, pts:pts2});
      } else {
        polys.push({closed:true, pts:[
          {x:x,y:y},{x:x+w,y:y},{x:x+w,y:y+h},{x:x,y:y+h},{x:x,y:y}
        ]});
      }
    } else if (tag === "circle") {
      const cx = +el.getAttribute("cx") || 0;
      const cy = +el.getAttribute("cy") || 0;
      const r  = +el.getAttribute("r")  || 0;
      const segs = Math.max(16, quality|0);
      const pts2 = [];
      for (let i=0;i<=segs;i++){
        const a = 2*Math.PI*(i/segs);
        pts2.push({x:cx + r*Math.cos(a), y:cy + r*Math.sin(a)});
      }
      polys.push({closed:true, pts:pts2});
    } else if (tag === "ellipse") {
      const cx = +el.getAttribute("cx") || 0;
      const cy = +el.getAttribute("cy") || 0;
      const rx = +el.getAttribute("rx") || 0;
      const ry = +el.getAttribute("ry") || 0;
      const segs = Math.max(16, quality|0);
      const pts2 = [];
      for (let i=0;i<=segs;i++){
        const a = 2*Math.PI*(i/segs);
        pts2.push({x:cx + rx*Math.cos(a), y:cy + ry*Math.sin(a)});
      }
      polys.push({closed:true, pts:pts2});
    }

    return polys.filter(p => p.pts && p.pts.length>=2);
  }

  function collectPolylines(svgRoot, quality) {
    const polys = [];
    function walk(node, accMat) {
      if (node.nodeType !== 1) return;
      const el = node;

      const local = parseTransform(el.getAttribute("transform"));
      const mat = matMul2(accMat, local);

      const tag = el.tagName.toLowerCase();
      if (tag === "g" || tag === "svg") {
        // continue
      } else {
        const p = elementToPolylines(el, quality);
        for (const poly of p) {
          const ptsT = poly.pts.map(pt => matApply2(mat, pt));
          polys.push({ closed: poly.closed, pts: ptsT });
        }
      }
      for (const child of el.children) walk(child, mat);
    }
    walk(svgRoot, matI());
    return polys;
  }

  function stitchPolylines(polys, eps) {
    if (!(eps>0)) return polys;
    const out = [];
    const used = new Array(polys.length).fill(false);

    function endpoints(p){
      return [p.pts[0], p.pts[p.pts.length-1]];
    }

    for (let i=0;i<polys.length;i++){
      if (used[i]) continue;
      used[i] = true;
      let cur = { closed: polys[i].closed, pts: polys[i].pts.slice() };

      let changed = true;
      while (changed) {
        changed = false;
        for (let j=0;j<polys.length;j++){
          if (used[j]) continue;

          const [a0,a1] = endpoints(cur);
          const [b0,b1] = endpoints(polys[j]);

          if (dist(a1,b0) <= eps) {
            cur.pts.push(...polys[j].pts.slice(1));
            used[j]=true; changed=true;
          } else if (dist(a1,b1) <= eps) {
            const rev = polys[j].pts.slice().reverse();
            cur.pts.push(...rev.slice(1));
            used[j]=true; changed=true;
          } else if (dist(a0,b1) <= eps) {
            cur.pts = polys[j].pts.slice(0,-1).concat(cur.pts);
            used[j]=true; changed=true;
          } else if (dist(a0,b0) <= eps) {
            const rev = polys[j].pts.slice().reverse();
            cur.pts = rev.slice(0,-1).concat(cur.pts);
            used[j]=true; changed=true;
          }

          if (changed) break;
        }
      }

      if (!cur.closed && cur.pts.length>2 && dist(cur.pts[0], cur.pts[cur.pts.length-1])<=eps) {
        cur.closed = true;
        cur.pts[cur.pts.length-1] = {...cur.pts[0]};
      }

      out.push(cur);
    }
    return out;
  }

  // DXF Writer (R12) with units in HEADER
  function fmtNum(v){
    const n = Number(v);
    if (!isFinite(n)) return "0";
    return (Math.round(n*1000)/1000).toString();
  }

  function computeBBoxFromPolys(polys){
    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const pl of polys){
      for (const p of pl.pts){
        minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
      }
    }
    if (!isFinite(minX)) return null;
    return {minX, minY, maxX, maxY};
  }

  function dxfHeaderWithUnits(unitsCode, bbox){
    const u = insunitsInfo(unitsCode);
    const meas = (u.metric === null) ? 1 : u.metric; // default metric for unitless
    const lines = [
      "0","SECTION",
      "2","HEADER",
      "9","$INSUNITS",
      "70", String(unitsCode),
      "9","$MEASUREMENT",
      "70", String(meas)
    ];

    if (bbox){
      lines.push(
        "9","$EXTMIN",
        "10", fmtNum(bbox.minX), "20", fmtNum(bbox.minY),
        "9","$EXTMAX",
        "10", fmtNum(bbox.maxX), "20", fmtNum(bbox.maxY)
      );
    }

    lines.push(
      "0","ENDSEC",
      "0","SECTION",
      "2","TABLES",
      "0","ENDSEC",
      "0","SECTION",
      "2","ENTITIES"
    );
    return lines.join("\n") + "\n";
  }

  function dxfFooter(){
    return ["0","ENDSEC","0","EOF"].join("\n") + "\n";
  }

  function dxfPolyline(points, closed, layer) {
    const flags = closed ? 1 : 0;
    let s = "";
    s += ["0","POLYLINE","8",layer,"66","1","70",String(flags)].join("\n") + "\n";
    for (const p of points) {
      s += ["0","VERTEX","8",layer,"10",fmtNum(p.x),"20",fmtNum(p.y),"30","0"].join("\n") + "\n";
    }
    s += ["0","SEQEND","8",layer].join("\n") + "\n";
    return s;
  }

  function polylinesToDxf(polys, layer, unitsCode) {
    const bbox = computeBBoxFromPolys(polys);
    let s = dxfHeaderWithUnits(unitsCode, bbox);
    for (const poly of polys) {
      const pts = [];
      for (const p of poly.pts) {
        const last = pts[pts.length-1];
        if (!last || dist(last,p) > 1e-9) pts.push(p);
      }
      if (pts.length >= 2) s += dxfPolyline(pts, poly.closed, layer);
    }
    s += dxfFooter();
    return s;
  }

  // Preview for converter (screen Y down)
  function drawPreview(polysScreen){
    svgPrevCtx.clearRect(0,0,svgPreview.width,svgPreview.height);
    if (!polysScreen.length) return;

    let minX=Infinity, minY=Infinity, maxX=-Infinity, maxY=-Infinity;
    for (const pl of polysScreen){
      for (const p of pl.pts){
        minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
        maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
      }
    }
    const pad = 20;
    const w = maxX-minX || 1;
    const h = maxY-minY || 1;
    const sx = (svgPreview.width-2*pad)/w;
    const sy = (svgPreview.height-2*pad)/h;
    const s = Math.min(sx, sy);

    svgPrevCtx.lineWidth = 2;
    svgPrevCtx.beginPath();
    for (const pl of polysScreen){
      if (pl.pts.length < 2) continue;
      const p0 = pl.pts[0];
      svgPrevCtx.moveTo(pad + (p0.x-minX)*s, pad + (p0.y-minY)*s);
      for (let i=1;i<pl.pts.length;i++){
        const p = pl.pts[i];
        svgPrevCtx.lineTo(pad + (p.x-minX)*s, pad + (p.y-minY)*s);
      }
    }
    svgPrevCtx.strokeStyle = "#000";
    svgPrevCtx.stroke();
  }

  // Convert handler
  let lastSvgFile = null;

  async function doConvert(){
    const f = lastSvgFile || svgFileInput.files?.[0];
    if (!f) { logConvert("Selecciona un archivo .svg", "ERR"); return; }

    try{
      const text = await f.text();
      const svg = parseSvgText(text);

      const quality = Math.max(4, parseInt(svgQualityEl.value || "32", 10));
      const scaleMmPerUnit = Number(svgScaleEl.value || "1");
      const stitch = Number(svgStitchEl.value || "0");
      const outUnitsCode = Number(svgOutUnitsEl.value || "4");
      const outUnitsInfo = insunitsInfo(outUnitsCode);
      const layer = "0";

      let polys = collectPolylines(svg, quality);
      if (!polys.length) {
        logConvert("No encontré geometría soportada (path/line/poly*/rect/circle/ellipse).", "WARN");
        return;
      }

      // 1) SVG units -> mm (and invert Y for DXF Y-up)
      polys = polys.map(pl => ({
        closed: pl.closed,
        pts: pl.pts.map(p => ({ x: p.x*scaleMmPerUnit, y: -p.y*scaleMmPerUnit }))
      }));

      // 2) stitch in mm
      polys = stitchPolylines(polys, stitch);

      // 3) mm -> output units (so DXF numbers match INSUNITS)
      const mmPerOutUnit = outUnitsInfo.mm; // e.g. cm=10mm/unit
      const polysOut = polys.map(pl => ({
        closed: pl.closed,
        pts: pl.pts.map(p => ({ x: p.x / mmPerOutUnit, y: p.y / mmPerOutUnit }))
      }));

      // Preview in screen coords (y down), in output units
      drawPreview(polysOut.map(pl => ({
        closed: pl.closed,
        pts: pl.pts.map(p => ({ x: p.x, y: -p.y }))
      })));

      await new Promise(requestAnimationFrame);

      const dxfText = polylinesToDxf(polysOut, layer, outUnitsCode);
      const outName = (f.name.replace(/\.svg$/i,"") || "export") + ".dxf";

      loadDxfFromText(dxfText, outName);
      btnDownload.classList.add("hot");
      logConvert(`OK: ${polysOut.length} polilíneas → ${outName} · Unidades DXF: ${outUnitsInfo.name}`, "OK");

      // switch to viewer automatically after conversion
      //setMode("view");
    } catch (e) {
      console.error(e);
      logConvert(e?.message || String(e), "ERR");
    }
  }

  btnConvert.addEventListener("click", doConvert);

  btnClear.addEventListener("click", () => {
    svgFileInput.value = "";
    lastSvgFile = null;
    updateSvgUi();
    svgPrevCtx.clearRect(0,0,svgPreview.width, svgPreview.height);
    logConvert("Listo.", "");
    if (svgOpenInfo) svgOpenInfo.textContent = "SVG: —";
  });

  // SVG file input

  svgFileInput.addEventListener("change", (e) => {
  lastSvgFile = e.target.files?.[0] || null;

    if (lastSvgFile) {
      logConvert(`SVG cargado: ${lastSvgFile.name}`, "OK");
      if (svgOpenInfo) svgOpenInfo.textContent = `SVG: ${lastSvgFile.name}`;
    } else {
      if (svgOpenInfo) svgOpenInfo.textContent = "SVG: —";
    }

    updateSvgUi();
  });

  // SVG drag & drop
  ;["dragenter","dragover"].forEach(evt => {
    svgDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      svgDrop.classList.add("dragover");
    });
  });
  ;["dragleave","drop"].forEach(evt => {
    svgDrop.addEventListener(evt, (e) => {
      e.preventDefault();
      svgDrop.classList.remove("dragover");
    });
  });
  svgDrop.addEventListener("drop", (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!f) return;
    if (!/\.svg$/i.test(f.name)) {
      logConvert("Ese archivo no parece .svg", "WARN");
      return;
    }
    lastSvgFile = f;
    if (svgOpenInfo) svgOpenInfo.textContent = `SVG: ${f.name}`;
    updateSvgUi();
    // populate input for consistency
    const dt = new DataTransfer();
    dt.items.add(f);
    svgFileInput.files = dt.files;
    logConvert(`SVG cargado: ${f.name}`, "OK");
  });

})();
