function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function fmt(n, d = 3) { return Number(n).toFixed(d); }

function matMul(A, B) {
  // [a b c d e f]
  return [
    A[0]*B[0] + A[2]*B[1],
    A[1]*B[0] + A[3]*B[1],
    A[0]*B[2] + A[2]*B[3],
    A[1]*B[2] + A[3]*B[3],
    A[0]*B[4] + A[2]*B[5] + A[4],
    A[1]*B[4] + A[3]*B[5] + A[5],
  ];
}
function matApply(M, p) {
  return { x: M[0]*p.x + M[2]*p.y + M[4], y: M[1]*p.x + M[3]*p.y + M[5] };
}
function matIdentity() { return [1,0,0,1,0,0]; }

function parseTransform(str) {
  if (!str) return matIdentity();
  let M = matIdentity();
  const re = /(matrix|translate|scale|rotate)\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(str))) {
    const fn = m[1];
    const args = m[2].split(/[\s,]+/).filter(Boolean).map(Number);
    let T = matIdentity();

    if (fn === "matrix" && args.length >= 6) {
      T = [args[0], args[1], args[2], args[3], args[4], args[5]];
    } else if (fn === "translate") {
      const tx = args[0] || 0, ty = args[1] || 0;
      T = [1,0,0,1,tx,ty];
    } else if (fn === "scale") {
      const sx = (args[0] ?? 1), sy = (args[1] ?? sx);
      T = [sx,0,0,sy,0,0];
    } else if (fn === "rotate") {
      const ang = (args[0] || 0) * Math.PI/180;
      const cx = args[1] || 0, cy = args[2] || 0;
      const c = Math.cos(ang), s = Math.sin(ang);
      // translate(cx,cy)*R*translate(-cx,-cy)
      const R = [c,s,-s,c,0,0];
      const A = [1,0,0,1,cx,cy];
      const B = [1,0,0,1,-cx,-cy];
      T = matMul(matMul(A, R), B);
    }

    M = matMul(M, T);
  }
  return M;
}

function bboxInit() { return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; }
function bboxAdd(b, x, y) {
  b.minX = Math.min(b.minX, x);
  b.minY = Math.min(b.minY, y);
  b.maxX = Math.max(b.maxX, x);
  b.maxY = Math.max(b.maxY, y);
}
function bboxValid(b) { return isFinite(b.minX) && isFinite(b.minY) && isFinite(b.maxX) && isFinite(b.maxY); }

function dist(a, b) { return Math.hypot(a.x-b.x, a.y-b.y); }

// --- SVG path parsing (M,L,H,V,C,Q,A,Z) ---
function tokenizePath(d) {
  const tokens = [];
  const re = /([a-zA-Z])|([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) tokens.push(m[1] || m[2]);
  return tokens;
}

function arcToCenterParam(x1,y1,x2,y2, fa, fs, rx, ry, phiDeg) {
  // SVG spec conversion (elliptical arc)
  const phi = phiDeg * Math.PI/180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return null;

  // Step 1: (x1', y1')
  const dx = (x1 - x2)/2, dy = (y1 - y2)/2;
  const x1p = cosPhi*dx + sinPhi*dy;
  const y1p = -sinPhi*dx + cosPhi*dy;

  // Step 2: correct radii
  const lam = (x1p*x1p)/(rx*rx) + (y1p*y1p)/(ry*ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s; ry *= s;
  }

  // Step 3: center (cx', cy')
  const rx2 = rx*rx, ry2 = ry*ry;
  const x1p2 = x1p*x1p, y1p2 = y1p*y1p;

  let sign = (fa === fs) ? -1 : 1;
  let num = rx2*ry2 - rx2*y1p2 - ry2*x1p2;
  let den = rx2*y1p2 + ry2*x1p2;
  num = Math.max(0, num);
  const coef = sign * Math.sqrt(num / (den || 1e-12));

  const cxp = coef * (rx*y1p)/ry;
  const cyp = coef * (-ry*x1p)/rx;

  // Step 4: center (cx, cy)
  const cx = cosPhi*cxp - sinPhi*cyp + (x1 + x2)/2;
  const cy = sinPhi*cxp + cosPhi*cyp + (y1 + y2)/2;

  // Step 5: angles
  const v1 = { x: (x1p - cxp)/rx, y: (y1p - cyp)/ry };
  const v2 = { x: (-x1p - cxp)/rx, y: (-y1p - cyp)/ry };

  const ang = (u,v) => {
    const dot = u.x*v.x + u.y*v.y;
    const det = u.x*v.y - u.y*v.x;
    return Math.atan2(det, dot);
  };

  let theta1 = ang({x:1,y:0}, v1);
  let dtheta = ang(v1, v2);

  if (!fs && dtheta > 0) dtheta -= 2*Math.PI;
  if (fs && dtheta < 0) dtheta += 2*Math.PI;

  return { cx, cy, rx, ry, phi, theta1, dtheta };
}

function sampleArc(arc, segments) {
  const pts = [];
  const { cx, cy, rx, ry, phi, theta1, dtheta } = arc;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

  for (let i=0;i<=segments;i++){
    const t = theta1 + (dtheta*i)/segments;
    const x = rx*Math.cos(t);
    const y = ry*Math.sin(t);
    const xr = cosPhi*x - sinPhi*y + cx;
    const yr = sinPhi*x + cosPhi*y + cy;
    pts.push({ x:xr, y:yr });
  }
  return pts;
}

function flattenPath(d, quality) {
  const tokens = tokenizePath(d);
  let i = 0;

  let cmd = "";
  let cur = { x:0, y:0 };
  let start = { x:0, y:0 };
  let prevCtrl = null;

  const polys = [];
  let currentPoly = [];

  const nextNum = () => Number(tokens[i++]);

  const lineTo = (x,y) => {
    currentPoly.push({ x, y });
    cur = { x, y };
  };

  const ensureStart = () => {
    if (currentPoly.length === 0) currentPoly.push({ ...cur });
  };

  const cubic = (p0,p1,p2,p3, seg) => {
    const pts = [];
    for (let k=1;k<=seg;k++){
      const t = k/seg;
      const mt = 1-t;
      const x = mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x;
      const y = mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y;
      pts.push({ x,y });
    }
    return pts;
  };

  const quad = (p0,p1,p2, seg) => {
    const pts = [];
    for (let k=1;k<=seg;k++){
      const t = k/seg;
      const mt = 1-t;
      const x = mt*mt*p0.x + 2*mt*t*p1.x + t*t*p2.x;
      const y = mt*mt*p0.y + 2*mt*t*p1.y + t*t*p2.y;
      pts.push({ x,y });
    }
    return pts;
  };

  const pushPoly = (closed) => {
    if (currentPoly.length >= 2) polys.push({ pts: currentPoly.slice(), closed });
    currentPoly = [];
  };

  while (i < tokens.length) {
    const t = tokens[i++];
    if (isNaN(Number(t))) cmd = t;
    else { i--; }

    const isRel = (cmd === cmd.toLowerCase());
    const C = cmd.toUpperCase();

    if (C === "M") {
      const x = nextNum(), y = nextNum();
      cur = { x: isRel ? cur.x + x : x, y: isRel ? cur.y + y : y };
      start = { ...cur };
      pushPoly(false);
      currentPoly = [{ ...cur }];

      // implicit lineto for extra pairs
      while (i < tokens.length && !isNaN(Number(tokens[i]))) {
        const x2 = nextNum(), y2 = nextNum();
        lineTo(isRel ? cur.x + x2 : x2, isRel ? cur.y + y2 : y2);
      }
      prevCtrl = null;
    }
    else if (C === "L") {
      ensureStart();
      while (i < tokens.length && !isNaN(Number(tokens[i]))) {
        const x = nextNum(), y = nextNum();
        lineTo(isRel ? cur.x + x : x, isRel ? cur.y + y : y);
      }
      prevCtrl = null;
    }
    else if (C === "H") {
      ensureStart();
      while (i < tokens.length && !isNaN(Number(tokens[i]))) {
        const x = nextNum();
        lineTo(isRel ? cur.x + x : x, cur.y);
      }
      prevCtrl = null;
    }
    else if (C === "V") {
      ensureStart();
      while (i < tokens.length && !isNaN(Number(tokens[i]))) {
        const y = nextNum();
        lineTo(cur.x, isRel ? cur.y + y : y);
      }
      prevCtrl = null;
    }
    else if (C === "C") {
      ensureStart();
      while (i < tokens.length && !isNaN(Number(tokens[i]))) {
        const x1 = nextNum(), y1 = nextNum();
        const x2 = nextNum(), y2 = nextNum();
        const x = nextNum(), y = nextNum();
        const p0 = { ...cur };
        const p1 = { x: isRel ? cur.x + x1 : x1, y: isRel ? cur.y + y1 : y1 };
        const p2 = { x: isRel ? cur.x + x2 : x2, y: isRel ? cur.y + y2 : y2 };
        const p3 = { x: isRel ? cur.x + x : x, y: isRel ? cur.y + y : y };
        const seg = clamp(Number(quality) || 32, 4, 512);
        const pts = cubic(p0,p1,p2,p3, seg);
        for (const q of pts) lineTo(q.x, q.y);
        cur = { ...p3 };
        prevCtrl = { ...p2 };
      }
    }
    else if (C === "Q") {
      ensureStart();
      while (i < tokens.length && !isNaN(Number(tokens[i]))) {
        const x1 = nextNum(), y1 = nextNum();
        const x = nextNum(), y = nextNum();
        const p0 = { ...cur };
        const p1 = { x: isRel ? cur.x + x1 : x1, y: isRel ? cur.y + y1 : y1 };
        const p2 = { x: isRel ? cur.x + x : x, y: isRel ? cur.y + y : y };
        const seg = clamp(Number(quality) || 32, 4, 512);
        const pts = quad(p0,p1,p2, seg);
        for (const q of pts) lineTo(q.x, q.y);
        cur = { ...p2 };
        prevCtrl = { ...p1 };
      }
    }
    else if (C === "A") {
      ensureStart();
      while (i < tokens.length && !isNaN(Number(tokens[i]))) {
        const rx = nextNum(), ry = nextNum();
        const phi = nextNum();
        const fa = nextNum();
        const fs = nextNum();
        const x = nextNum(), y = nextNum();
        const x2 = isRel ? cur.x + x : x;
        const y2 = isRel ? cur.y + y : y;

        const arc = arcToCenterParam(cur.x, cur.y, x2, y2, fa, fs, rx, ry, phi);
        if (!arc) {
          lineTo(x2, y2);
        } else {
          const seg = clamp(Number(quality) || 32, 6, 512);
          const pts = sampleArc(arc, seg);
          // pts incluye el primero; para evitar duplicado, arrancar en 1
          for (let k=1;k<pts.length;k++) lineTo(pts[k].x, pts[k].y);
        }
        cur = { x:x2, y:y2 };
        prevCtrl = null;
      }
    }
    else if (C === "Z") {
      // close
      if (currentPoly.length >= 2) {
        // ensure last == start? no importa, DXF cerrará por flag
        pushPoly(true);
      } else {
        currentPoly = [];
      }
      cur = { ...start };
      prevCtrl = null;
    }
    else {
      // command unsupported -> stop to avoid infinite loop
      prevCtrl = null;
      // consume remaining numbers defensively
      while (i < tokens.length && !isNaN(Number(tokens[i]))) i++;
    }
  }

  // finalize open poly
  pushPoly(false);
  return polys;
}

function parsePointsAttr(s) {
  const nums = (s || "").trim().split(/[\s,]+/).map(Number).filter(n => Number.isFinite(n));
  const pts = [];
  for (let i=0;i+1<nums.length;i+=2) pts.push({ x: nums[i], y: nums[i+1] });
  return pts;
}

function approxCircle(cx, cy, r, seg=96) {
  const pts = [];
  for (let i=0;i<=seg;i++){
    const t = (i/seg)*Math.PI*2;
    pts.push({ x: cx + r*Math.cos(t), y: cy + r*Math.sin(t) });
  }
  return { pts, closed:true };
}

function approxEllipse(cx, cy, rx, ry, seg=128) {
  const pts = [];
  for (let i=0;i<=seg;i++){
    const t = (i/seg)*Math.PI*2;
    pts.push({ x: cx + rx*Math.cos(t), y: cy + ry*Math.sin(t) });
  }
  return { pts, closed:true };
}

function stitchPolys(polys, tol) {
  if (!tol || tol <= 0) return polys;

  const used = new Array(polys.length).fill(false);
  const out = [];

  const rev = (p) => ({ pts: p.pts.slice().reverse(), closed: p.closed });

  for (let i=0;i<polys.length;i++){
    if (used[i]) continue;
    let a = polys[i];
    used[i] = true;

    if (a.closed) { out.push(a); continue; }

    let changed = true;
    while (changed) {
      changed = false;
      for (let j=0;j<polys.length;j++){
        if (used[j]) continue;
        let b = polys[j];
        if (b.closed) continue;

        const a0 = a.pts[0], a1 = a.pts[a.pts.length-1];
        const b0 = b.pts[0], b1 = b.pts[b.pts.length-1];

        const d1 = dist(a1, b0);
        const d2 = dist(a1, b1);
        const d3 = dist(a0, b1);
        const d4 = dist(a0, b0);

        let best = Math.min(d1,d2,d3,d4);
        if (best > tol) continue;

        if (best === d1) {
          a = { pts: a.pts.concat(b.pts.slice(1)), closed:false };
        } else if (best === d2) {
          b = rev(b);
          a = { pts: a.pts.concat(b.pts.slice(1)), closed:false };
        } else if (best === d3) {
          a = rev(a);
          a = { pts: a.pts.concat(b.pts.slice(1)), closed:false };
        } else { // d4
          a = rev(a);
          b = rev(b);
          a = { pts: a.pts.concat(b.pts.slice(1)), closed:false };
        }

        used[j] = true;
        changed = true;
      }
    }

    out.push(a);
  }

  return out;
}

function polylinesBBox(polys) {
  const b = bboxInit();
  for (const p of polys) {
    for (const q of p.pts) bboxAdd(b, q.x, q.y);
  }
  return b;
}

function insunitsToMmFactor(ins) {
  // mm por unidad DXF
  const map = { 0:1, 1:25.4, 2:304.8, 4:1, 5:10, 6:1000 };
  return map[ins] ?? 1;
}

function polylinesToDxfR12(polys, insunits) {
  const b = polylinesBBox(polys);
  const minX = bboxValid(b) ? b.minX : 0;
  const minY = bboxValid(b) ? b.minY : 0;
  const maxX = bboxValid(b) ? b.maxX : 0;
  const maxY = bboxValid(b) ? b.maxY : 0;

  const lines = [];
  const add = (a,b) => { lines.push(String(a)); lines.push(String(b)); };

  add(0, "SECTION"); add(2, "HEADER");
  add(9, "$ACADVER"); add(1, "AC1009"); // R12
  add(9, "$INSUNITS"); add(70, String(insunits));
  add(9, "$EXTMIN"); add(10, fmt(minX,6)); add(20, fmt(minY,6));
  add(9, "$EXTMAX"); add(10, fmt(maxX,6)); add(20, fmt(maxY,6));
  add(0, "ENDSEC");

  add(0, "SECTION"); add(2, "ENTITIES");

  for (const p of polys) {
    if (!p.pts || p.pts.length < 2) continue;

    add(0, "POLYLINE");
    add(8, "0");
    add(66, "1"); // vertices follow
    add(70, p.closed ? "1" : "0");
    add(10, "0"); add(20, "0"); add(30, "0");

    for (const v of p.pts) {
      add(0, "VERTEX");
      add(8, "0");
      add(10, fmt(v.x,6));
      add(20, fmt(v.y,6));
      add(30, "0");
    }

    add(0, "SEQEND");
    add(8, "0");
  }

  add(0, "ENDSEC");
  add(0, "EOF");

  return lines.join("\n") + "\n";
}

export function createConverter(dom, { onConverted } = {}) {
  const state = {
    lastSvgFile: null,
    lastSvgText: "",
    
  };

  const prevCanvas = dom.svgPreview;
  const prevCtx = prevCanvas.getContext("2d");

  function log(msg) {
    dom.convertStatus.textContent = msg;
  }

  function updateUi() {
    const hasSvg = !!state.lastSvgFile;

    // Dropzone visible si NO hay svg
    dom.svgDrop.style.display = hasSvg ? "none" : "";

    // Preview visible si SÍ hay svg
    dom.svgPreviewBlock.style.display = hasSvg ? "" : "none";

    // botón top "Cargar SVG": solo en convert mode y si NO hay svg
    const isConvert = dom.modeConvertBtn.classList.contains("on");
    dom.btnPickSvg.style.display = (isConvert && !hasSvg) ? "" : "none";

    // label con nombre
    dom.svgOpenInfo.textContent = hasSvg ? `SVG: ${state.lastSvgFile.name}` : "SVG: —";
  }

  async function loadSvgFile(file) {
    state.lastSvgFile = file;
    state.lastSvgText = await file.text();
    log(`SVG cargado: ${file.name}`);
    updateUi();
  }

  // drop svg
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
    if (!/\.svg$/i.test(f.name)) {
      log("Ese archivo no parece SVG.");
      return;
    }
    // permitir re-elegir el mismo archivo
    dom.svgFileInput.value = "";
    await loadSvgFile(f);
  });

  // input svg
  dom.svgFileInput.addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await loadSvgFile(f);
  });

  // clear
  dom.btnClear.addEventListener("click", () => {
    clear();
    updateUi();
  });

  function clear() {
    state.lastSvgFile = null;
    state.lastSvgText = "";
    dom.svgFileInput.value = "";
    prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);
    log("Listo. Carga un SVG para convertir.");
  }

  function parseSvgToPolylines(svgText, quality) {
    const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
    const svg = doc.querySelector("svg");
    if (!svg) throw new Error("No se encontró <svg> válido.");

    const polys = [];
    const walk = (node, M) => {
      if (node.nodeType !== 1) return;
      const el = node;

      const Mt = matMul(M, parseTransform(el.getAttribute("transform")));

      const tag = el.tagName.toLowerCase();

      if (tag === "path") {
        const d = el.getAttribute("d") || "";
        const parts = flattenPath(d, quality);
        for (const p of parts) {
          const pts = p.pts.map(q => matApply(Mt, q));
          polys.push({ pts, closed: p.closed });
        }
      }
      else if (tag === "line") {
        const x1 = Number(el.getAttribute("x1")||0);
        const y1 = Number(el.getAttribute("y1")||0);
        const x2 = Number(el.getAttribute("x2")||0);
        const y2 = Number(el.getAttribute("y2")||0);
        polys.push({ pts: [matApply(Mt,{x:x1,y:y1}), matApply(Mt,{x:x2,y:y2})], closed:false });
      }
      else if (tag === "polyline") {
        const pts = parsePointsAttr(el.getAttribute("points"));
        if (pts.length >= 2) polys.push({ pts: pts.map(q => matApply(Mt,q)), closed:false });
      }
      else if (tag === "polygon") {
        const pts = parsePointsAttr(el.getAttribute("points"));
        if (pts.length >= 2) polys.push({ pts: pts.map(q => matApply(Mt,q)), closed:true });
      }
      else if (tag === "rect") {
        const x = Number(el.getAttribute("x")||0);
        const y = Number(el.getAttribute("y")||0);
        const w = Number(el.getAttribute("width")||0);
        const h = Number(el.getAttribute("height")||0);
        const pts = [
          {x, y}, {x:x+w, y}, {x:x+w, y:y+h}, {x, y:y+h}, {x, y}
        ].map(q => matApply(Mt,q));
        polys.push({ pts, closed:true });
      }
      else if (tag === "circle") {
        const cx = Number(el.getAttribute("cx")||0);
        const cy = Number(el.getAttribute("cy")||0);
        const r  = Number(el.getAttribute("r")||0);
        const c = approxCircle(cx, cy, r, clamp(quality*3, 48, 256));
        polys.push({ pts: c.pts.map(q => matApply(Mt,q)), closed:true });
      }
      else if (tag === "ellipse") {
        const cx = Number(el.getAttribute("cx")||0);
        const cy = Number(el.getAttribute("cy")||0);
        const rx = Number(el.getAttribute("rx")||0);
        const ry = Number(el.getAttribute("ry")||0);
        const c = approxEllipse(cx, cy, rx, ry, clamp(quality*4, 64, 256));
        polys.push({ pts: c.pts.map(q => matApply(Mt,q)), closed:true });
      }

      // recursión
      for (const ch of el.children) walk(ch, Mt);
    };

    walk(svg, matIdentity());
    return polys;
  }

  function drawPreview(polys) {
    prevCtx.clearRect(0, 0, prevCanvas.width, prevCanvas.height);

    const b = polylinesBBox(polys);
    if (!bboxValid(b)) return;

    const W = prevCanvas.width, H = prevCanvas.height;
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;

    const s = Math.min((W*0.9)/(w||1), (H*0.9)/(h||1));
    const ox = (W - w*s)/2 - b.minX*s;
    const oy = (H - h*s)/2 - b.minY*s;

    // bg
    prevCtx.fillStyle = "#0a0f1a";
    prevCtx.fillRect(0,0,W,H);

    prevCtx.strokeStyle = "#e6edf3";
    prevCtx.lineWidth = 1;

    prevCtx.beginPath();
    for (const p of polys) {
      if (p.pts.length < 2) continue;
      prevCtx.moveTo(p.pts[0].x*s + ox, p.pts[0].y*s + oy);
      for (let i=1;i<p.pts.length;i++) prevCtx.lineTo(p.pts[i].x*s + ox, p.pts[i].y*s + oy);
      if (p.closed) prevCtx.closePath();
    }
    prevCtx.stroke();
  }

  dom.btnConvert.addEventListener("click", async () => {
    if (!state.lastSvgFile || !state.lastSvgText) {
      log("Primero carga un SVG.");
      updateUi();
      return;
    }

    const quality = clamp(Number(dom.svgQualityEl.value)||32, 4, 512);
    const stitchMm = Math.max(0, Number(dom.svgStitchEl.value)||0);
    const mmPerSvgUnit = Math.max(0, Number(dom.svgScaleEl.value)||1);

    const outInsunits = Number(dom.svgOutUnitsEl.value);
    const outMmFactor = insunitsToMmFactor(outInsunits); // mm por unidad DXF

    try {
      // 1) SVG -> polylines (en unidades SVG)
      let polys = parseSvgToPolylines(state.lastSvgText, quality);

      // 2) aplicar escala: svgUnit -> mm -> unitsDXF
      for (const p of polys) {
        for (const q of p.pts) {
          const xmm = q.x * mmPerSvgUnit;
          const ymm = q.y * mmPerSvgUnit;
          q.x = xmm / outMmFactor;
          q.y = ymm / outMmFactor;
        }
      }

      // 3) stitch (tol en unitsDXF)
      const tolOut = stitchMm / outMmFactor;
      polys = stitchPolys(polys, tolOut);

      // 4) preview (antes de DXF + antes de carga en visor)
      drawPreview(polys);
      updateUi();

      // fuerza un frame para que el canvas pinte inmediatamente
      await new Promise(requestAnimationFrame);

      // 5) DXF
      const base = state.lastSvgFile.name.replace(/\.svg$/i, "");
      const dxfName = `${base}.dxf`;
      const dxfText = polylinesToDxfR12(polys, outInsunits);

      log(`Convertido OK: ${dxfName}`);

      if (typeof onConverted === "function") {
        await onConverted({ dxfText, dxfName });
      }
    } catch (err) {
      console.error(err);
      log(`Error: ${err?.message || err}`);
    }
  });

    // deja la UI consistente desde el arranque
  clear();
  updateUi();

  // API
  return {
    clear,
    updateUi,
    hasSvg: () => !!state.lastSvgFile,
  };
}