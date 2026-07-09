// js/vector-utils.js
// Utilidades compartidas para trabajar con geometría 2D de corte láser.
// La representación canónica interna usa polilíneas en milímetros, con eje Y hacia arriba.

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
export function fmt(n, d = 6) {
  if (!Number.isFinite(Number(n))) return "0";
  return Number(n).toFixed(d).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

export function sanitizeBaseName(name = "export") {
  return String(name || "export")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "_") || "export";
}

export function bboxInit() { return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }; }
export function bboxAdd(b, x, y) {
  b.minX = Math.min(b.minX, x);
  b.minY = Math.min(b.minY, y);
  b.maxX = Math.max(b.maxX, x);
  b.maxY = Math.max(b.maxY, y);
}
export function bboxValid(b) {
  return !!b && Number.isFinite(b.minX) && Number.isFinite(b.minY) && Number.isFinite(b.maxX) && Number.isFinite(b.maxY);
}
export function geometryBBox(geometryOrPolys) {
  const polys = Array.isArray(geometryOrPolys) ? geometryOrPolys : (geometryOrPolys?.polys || []);
  const b = bboxInit();
  for (const p of polys) {
    for (const q of p.pts || []) bboxAdd(b, Number(q.x), Number(q.y));
  }
  return b;
}

export function insunitsToMmFactor(ins) {
  const map = { 0: 1, 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
  return map[Number(ins)] ?? 1;
}

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function matMul(A, B) {
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
      T = [1,0,0,1,args[0] || 0,args[1] || 0];
    } else if (fn === "scale") {
      const sx = args[0] ?? 1;
      const sy = args[1] ?? sx;
      T = [sx,0,0,sy,0,0];
    } else if (fn === "rotate") {
      const ang = (args[0] || 0) * Math.PI / 180;
      const cx = args[1] || 0, cy = args[2] || 0;
      const c = Math.cos(ang), s = Math.sin(ang);
      T = matMul(matMul([1,0,0,1,cx,cy], [c,s,-s,c,0,0]), [1,0,0,1,-cx,-cy]);
    }

    M = matMul(M, T);
  }
  return M;
}

function parseLengthToMm(value) {
  const s = String(value || "").trim();
  const m = s.match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*(mm|cm|m|in|pt|px)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const u = (m[2] || "px").toLowerCase();
  const f = { mm: 1, cm: 10, m: 1000, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96 }[u];
  return Number.isFinite(n) && f ? n * f : null;
}

function inferSvgMmPerUnit(svg, fallback = 1) {
  const vb = (svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
  const vbW = vb.length >= 4 ? Math.abs(vb[2]) : null;
  const wMm = parseLengthToMm(svg.getAttribute("width"));
  if (wMm && vbW && vbW > 0) return wMm / vbW;

  const vbH = vb.length >= 4 ? Math.abs(vb[3]) : null;
  const hMm = parseLengthToMm(svg.getAttribute("height"));
  if (hMm && vbH && vbH > 0) return hMm / vbH;

  return Number(fallback) > 0 ? Number(fallback) : 1;
}

function tokenizePath(d) {
  const tokens = [];
  const re = /([a-zA-Z])|([-+]?\d*\.?\d+(?:e[-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d))) tokens.push(m[1] || m[2]);
  return tokens;
}

function arcToCenterParam(x1,y1,x2,y2, fa, fs, rx, ry, phiDeg) {
  const phi = phiDeg * Math.PI / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx === 0 || ry === 0) return null;

  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  const lam = (x1p*x1p)/(rx*rx) + (y1p*y1p)/(ry*ry);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rx *= s; ry *= s;
  }

  const rx2 = rx*rx, ry2 = ry*ry;
  const x1p2 = x1p*x1p, y1p2 = y1p*y1p;
  let num = rx2*ry2 - rx2*y1p2 - ry2*x1p2;
  const den = rx2*y1p2 + ry2*x1p2;
  num = Math.max(0, num);
  const coef = (fa === fs ? -1 : 1) * Math.sqrt(num / (den || 1e-12));
  const cxp = coef * (rx * y1p) / ry;
  const cyp = coef * (-ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const v1 = { x: (x1p - cxp) / rx, y: (y1p - cyp) / ry };
  const v2 = { x: (-x1p - cxp) / rx, y: (-y1p - cyp) / ry };
  const ang = (u,v) => Math.atan2(u.x*v.y - u.y*v.x, u.x*v.x + u.y*v.y);
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
  for (let i = 0; i <= segments; i++) {
    const t = theta1 + (dtheta * i) / segments;
    const x = rx * Math.cos(t), y = ry * Math.sin(t);
    pts.push({ x: cosPhi*x - sinPhi*y + cx, y: sinPhi*x + cosPhi*y + cy });
  }
  return pts;
}

function flattenPath(d, quality = 32) {
  const tokens = tokenizePath(d);
  let i = 0, cmd = "";
  let cur = { x:0, y:0 }, start = { x:0, y:0 };
  let prevCtrl = null;
  const polys = [];
  let currentPoly = [];
  const nextNum = () => Number(tokens[i++]);
  const ensureStart = () => { if (!currentPoly.length) currentPoly.push({ ...cur }); };
  const lineTo = (x,y) => { currentPoly.push({ x, y }); cur = { x, y }; };
  const pushPoly = (closed) => {
    if (currentPoly.length >= 2) polys.push({ pts: currentPoly.slice(), closed: !!closed });
    currentPoly = [];
  };
  const cubic = (p0,p1,p2,p3,seg) => {
    const pts = [];
    for (let k = 1; k <= seg; k++) {
      const t = k / seg, mt = 1 - t;
      pts.push({
        x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
        y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
      });
    }
    return pts;
  };
  const quad = (p0,p1,p2,seg) => {
    const pts = [];
    for (let k = 1; k <= seg; k++) {
      const t = k / seg, mt = 1 - t;
      pts.push({ x: mt*mt*p0.x + 2*mt*t*p1.x + t*t*p2.x, y: mt*mt*p0.y + 2*mt*t*p1.y + t*t*p2.y });
    }
    return pts;
  };

  while (i < tokens.length) {
    const t = tokens[i++];
    if (Number.isNaN(Number(t))) cmd = t;
    else i--;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();

    if (C === "M") {
      const x = nextNum(), y = nextNum();
      cur = { x: rel ? cur.x + x : x, y: rel ? cur.y + y : y };
      start = { ...cur };
      pushPoly(false);
      currentPoly = [{ ...cur }];
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        const x2 = nextNum(), y2 = nextNum();
        lineTo(rel ? cur.x + x2 : x2, rel ? cur.y + y2 : y2);
      }
      prevCtrl = null;
    } else if (C === "L") {
      ensureStart();
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        const x = nextNum(), y = nextNum();
        lineTo(rel ? cur.x + x : x, rel ? cur.y + y : y);
      }
      prevCtrl = null;
    } else if (C === "H") {
      ensureStart();
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        const x = nextNum();
        lineTo(rel ? cur.x + x : x, cur.y);
      }
      prevCtrl = null;
    } else if (C === "V") {
      ensureStart();
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        const y = nextNum();
        lineTo(cur.x, rel ? cur.y + y : y);
      }
      prevCtrl = null;
    } else if (C === "C") {
      ensureStart();
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        const x1 = nextNum(), y1 = nextNum(), x2 = nextNum(), y2 = nextNum(), x = nextNum(), y = nextNum();
        const p0 = { ...cur };
        const p1 = { x: rel ? cur.x + x1 : x1, y: rel ? cur.y + y1 : y1 };
        const p2 = { x: rel ? cur.x + x2 : x2, y: rel ? cur.y + y2 : y2 };
        const p3 = { x: rel ? cur.x + x : x, y: rel ? cur.y + y : y };
        for (const q of cubic(p0,p1,p2,p3, clamp(Number(quality) || 32, 4, 512))) lineTo(q.x, q.y);
        cur = { ...p3 }; prevCtrl = { ...p2 };
      }
    } else if (C === "S") {
      ensureStart();
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        const x2 = nextNum(), y2 = nextNum(), x = nextNum(), y = nextNum();
        const p0 = { ...cur };
        const p1 = prevCtrl ? { x: 2*cur.x - prevCtrl.x, y: 2*cur.y - prevCtrl.y } : { ...cur };
        const p2 = { x: rel ? cur.x + x2 : x2, y: rel ? cur.y + y2 : y2 };
        const p3 = { x: rel ? cur.x + x : x, y: rel ? cur.y + y : y };
        for (const q of cubic(p0,p1,p2,p3, clamp(Number(quality) || 32, 4, 512))) lineTo(q.x, q.y);
        cur = { ...p3 }; prevCtrl = { ...p2 };
      }
    } else if (C === "Q") {
      ensureStart();
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        const x1 = nextNum(), y1 = nextNum(), x = nextNum(), y = nextNum();
        const p0 = { ...cur };
        const p1 = { x: rel ? cur.x + x1 : x1, y: rel ? cur.y + y1 : y1 };
        const p2 = { x: rel ? cur.x + x : x, y: rel ? cur.y + y : y };
        for (const q of quad(p0,p1,p2, clamp(Number(quality) || 32, 4, 512))) lineTo(q.x, q.y);
        cur = { ...p2 }; prevCtrl = { ...p1 };
      }
    } else if (C === "A") {
      ensureStart();
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) {
        const rx = nextNum(), ry = nextNum(), phi = nextNum(), fa = nextNum(), fs = nextNum(), x = nextNum(), y = nextNum();
        const x2 = rel ? cur.x + x : x;
        const y2 = rel ? cur.y + y : y;
        const arc = arcToCenterParam(cur.x, cur.y, x2, y2, fa, fs, rx, ry, phi);
        if (!arc) lineTo(x2, y2);
        else {
          const pts = sampleArc(arc, clamp(Number(quality) || 32, 6, 512));
          for (let k = 1; k < pts.length; k++) lineTo(pts[k].x, pts[k].y);
        }
        cur = { x:x2, y:y2 }; prevCtrl = null;
      }
    } else if (C === "Z") {
      if (currentPoly.length >= 2) pushPoly(true);
      else currentPoly = [];
      cur = { ...start }; prevCtrl = null;
    } else {
      while (i < tokens.length && !Number.isNaN(Number(tokens[i]))) i++;
      prevCtrl = null;
    }
  }
  pushPoly(false);
  return polys;
}

function parsePointsAttr(s) {
  const nums = (s || "").trim().split(/[\s,]+/).map(Number).filter(Number.isFinite);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i+1] });
  return pts;
}
function approxCircle(cx, cy, r, seg = 96) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pts.push({ x: cx + r*Math.cos(t), y: cy + r*Math.sin(t) });
  }
  return { pts, closed: true };
}
function approxEllipse(cx, cy, rx, ry, seg = 128) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2;
    pts.push({ x: cx + rx*Math.cos(t), y: cy + ry*Math.sin(t) });
  }
  return { pts, closed: true };
}
function isSvgNodeRenderable(el) {
  const style = (el.getAttribute("style") || "").toLowerCase();
  const display = (el.getAttribute("display") || "").toLowerCase();
  const visibility = (el.getAttribute("visibility") || "").toLowerCase();
  const opacity = Number(el.getAttribute("opacity") ?? "1");
  if (display === "none" || visibility === "hidden" || style.includes("display:none") || style.includes("visibility:hidden")) return false;
  if (Number.isFinite(opacity) && opacity <= 0) return false;
  return true;
}

export function parseSvgToGeometry(svgText, options = {}) {
  const quality = clamp(Number(options.quality) || 32, 4, 512);
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const parserError = doc.querySelector("parsererror");
  if (parserError) throw new Error("SVG inválido o mal formado.");
  const svg = doc.querySelector("svg");
  if (!svg) throw new Error("No se encontró un elemento <svg> válido.");

  const rawPolys = [];
  const walk = (node, M, inheritedLayer = "0") => {
    if (node.nodeType !== 1) return;
    const el = node;
    if (!isSvgNodeRenderable(el)) return;
    const Mt = matMul(M, parseTransform(el.getAttribute("transform")));
    const tag = el.tagName.toLowerCase();
    const layer = el.getAttribute("id") || el.getAttribute("data-layer") || inheritedLayer;
    const color = el.getAttribute("stroke") || el.getAttribute("fill") || "#111111";
    const push = (poly) => {
      const pts = (poly.pts || []).map(q => matApply(Mt, q)).filter(q => Number.isFinite(q.x) && Number.isFinite(q.y));
      if (pts.length >= 2) rawPolys.push({ pts, closed: !!poly.closed, layer, color });
    };

    if (tag === "path") {
      for (const p of flattenPath(el.getAttribute("d") || "", quality)) push(p);
    } else if (tag === "line") {
      push({ pts: [
        { x: Number(el.getAttribute("x1") || 0), y: Number(el.getAttribute("y1") || 0) },
        { x: Number(el.getAttribute("x2") || 0), y: Number(el.getAttribute("y2") || 0) },
      ], closed: false });
    } else if (tag === "polyline") {
      const pts = parsePointsAttr(el.getAttribute("points"));
      if (pts.length >= 2) push({ pts, closed: false });
    } else if (tag === "polygon") {
      const pts = parsePointsAttr(el.getAttribute("points"));
      if (pts.length >= 2) push({ pts, closed: true });
    } else if (tag === "rect") {
      const x = Number(el.getAttribute("x") || 0), y = Number(el.getAttribute("y") || 0);
      const w = Number(el.getAttribute("width") || 0), h = Number(el.getAttribute("height") || 0);
      if (w > 0 && h > 0) push({ pts: [{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h},{x,y}], closed: true });
    } else if (tag === "circle") {
      const cx = Number(el.getAttribute("cx") || 0), cy = Number(el.getAttribute("cy") || 0), r = Number(el.getAttribute("r") || 0);
      if (r > 0) push(approxCircle(cx, cy, r, clamp(quality * 3, 48, 256)));
    } else if (tag === "ellipse") {
      const cx = Number(el.getAttribute("cx") || 0), cy = Number(el.getAttribute("cy") || 0);
      const rx = Number(el.getAttribute("rx") || 0), ry = Number(el.getAttribute("ry") || 0);
      if (rx > 0 && ry > 0) push(approxEllipse(cx, cy, rx, ry, clamp(quality * 4, 64, 256)));
    }

    for (const ch of el.children) walk(ch, Mt, layer);
  };

  walk(svg, matIdentity());
  if (!rawPolys.length) throw new Error("El SVG no contiene vectores compatibles para corte láser.");

  const rawB = geometryBBox(rawPolys);
  const mmPerUnit = options.mmPerSvgUnit === "auto"
    ? inferSvgMmPerUnit(svg, 1)
    : (Number(options.mmPerSvgUnit) > 0 ? Number(options.mmPerSvgUnit) : inferSvgMmPerUnit(svg, 1));

  const polys = rawPolys.map(p => ({
    ...p,
    pts: p.pts.map(q => ({
      x: (q.x - rawB.minX) * mmPerUnit,
      y: (rawB.maxY - q.y) * mmPerUnit,
    })),
  }));

  return { polys, units: "mm", sourceFormat: "svg", bbox: geometryBBox(polys), meta: { mmPerSvgUnit: mmPerUnit } };
}

function stitchPolys(polys, tolMm = 0) {
  if (!tolMm || tolMm <= 0) return polys;
  const used = new Array(polys.length).fill(false);
  const out = [];
  const rev = (p) => ({ ...p, pts: p.pts.slice().reverse(), closed: p.closed });
  for (let i = 0; i < polys.length; i++) {
    if (used[i]) continue;
    let a = polys[i];
    used[i] = true;
    if (a.closed) { out.push(a); continue; }
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < polys.length; j++) {
        if (used[j] || polys[j].closed) continue;
        let b = polys[j];
        const a0 = a.pts[0], a1 = a.pts[a.pts.length - 1];
        const b0 = b.pts[0], b1 = b.pts[b.pts.length - 1];
        const ds = [dist(a1,b0), dist(a1,b1), dist(a0,b1), dist(a0,b0)];
        const best = Math.min(...ds);
        if (best > tolMm) continue;
        if (best === ds[0]) a = { ...a, pts: a.pts.concat(b.pts.slice(1)), closed: false };
        else if (best === ds[1]) { b = rev(b); a = { ...a, pts: a.pts.concat(b.pts.slice(1)), closed: false }; }
        else if (best === ds[2]) { a = rev(a); a = { ...a, pts: a.pts.concat(b.pts.slice(1)), closed: false }; }
        else { a = rev(a); b = rev(b); a = { ...a, pts: a.pts.concat(b.pts.slice(1)), closed: false }; }
        used[j] = true; changed = true;
      }
    }
    out.push(a);
  }
  return out;
}

export function normalizeGeometry(geometry, options = {}) {
  const stitchToleranceMm = Number(options.stitchToleranceMm || 0);
  const polys = stitchPolys((geometry?.polys || []).filter(p => (p.pts || []).length >= 2), stitchToleranceMm);
  return { ...geometry, polys, bbox: geometryBBox(polys), units: "mm" };
}

export function geometryToDxfR12(geometry, options = {}) {
  const insunits = Number(options.insunits ?? 4);
  const outMmFactor = insunitsToMmFactor(insunits);
  const g = normalizeGeometry(geometry, options);
  const scaledPolys = g.polys.map(p => ({ ...p, pts: p.pts.map(q => ({ x: q.x / outMmFactor, y: q.y / outMmFactor })) }));
  const b = geometryBBox(scaledPolys);
  const minX = bboxValid(b) ? b.minX : 0, minY = bboxValid(b) ? b.minY : 0;
  const maxX = bboxValid(b) ? b.maxX : 0, maxY = bboxValid(b) ? b.maxY : 0;
  const lines = [];
  const add = (a,b) => { lines.push(String(a)); lines.push(String(b)); };

  add(0, "SECTION"); add(2, "HEADER");
  add(9, "$ACADVER"); add(1, "AC1009");
  add(9, "$INSUNITS"); add(70, String(insunits));
  add(9, "$EXTMIN"); add(10, fmt(minX)); add(20, fmt(minY));
  add(9, "$EXTMAX"); add(10, fmt(maxX)); add(20, fmt(maxY));
  add(0, "ENDSEC");
  add(0, "SECTION"); add(2, "ENTITIES");

  for (const p of scaledPolys) {
    if (!p.pts || p.pts.length < 2) continue;
    add(0, "POLYLINE");
    add(8, String(p.layer || "0").slice(0, 250));
    add(66, "1");
    add(70, p.closed ? "1" : "0");
    add(10, "0"); add(20, "0"); add(30, "0");
    for (const v of p.pts) {
      add(0, "VERTEX");
      add(8, String(p.layer || "0").slice(0, 250));
      add(10, fmt(v.x)); add(20, fmt(v.y)); add(30, "0");
    }
    add(0, "SEQEND");
    add(8, String(p.layer || "0").slice(0, 250));
  }

  add(0, "ENDSEC"); add(0, "EOF");
  return lines.join("\n") + "\n";
}

export function geometryToSvg(geometry, options = {}) {
  const g = normalizeGeometry(geometry, options);
  const b = geometryBBox(g);
  const width = bboxValid(b) ? Math.max(0.001, b.maxX - b.minX) : 100;
  const height = bboxValid(b) ? Math.max(0.001, b.maxY - b.minY) : 100;
  const sw = Number(options.strokeWidthMm ?? 0.1);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  const dFor = (p) => {
    const pts = p.pts || [];
    if (pts.length < 2) return "";
    const cmds = [];
    const first = pts[0];
    cmds.push(`M ${fmt(first.x - b.minX)} ${fmt(height - (first.y - b.minY))}`);
    for (let i = 1; i < pts.length; i++) cmds.push(`L ${fmt(pts[i].x - b.minX)} ${fmt(height - (pts[i].y - b.minY))}`);
    if (p.closed) cmds.push("Z");
    return cmds.join(" ");
  };
  const paths = g.polys.map((p, i) => {
    const d = dFor(p);
    if (!d) return "";
    const color = p.color && !String(p.color).includes("url(") && p.color !== "none" ? p.color : "#000000";
    return `  <path id="path_${i+1}" data-layer="${esc(p.layer || "0")}" d="${d}" fill="none" stroke="${esc(color)}" stroke-width="${fmt(sw, 3)}" vector-effect="non-scaling-stroke"/>`;
  }).filter(Boolean).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${fmt(width,3)}mm" height="${fmt(height,3)}mm" viewBox="0 0 ${fmt(width,3)} ${fmt(height,3)}">\n  <title>Laser vector export</title>\n  <g id="laser_vectors" fill="none">\n${paths}\n  </g>\n</svg>\n`;
}

function makePdfDocument(content, pageWPt, pageHPt) {
  const objects = [];
  const addObj = (s) => { objects.push(s); return objects.length; };
  const contentId = 4;
  addObj("<< /Type /Catalog /Pages 2 0 R >>");
  addObj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(pageWPt,3)} ${fmt(pageHPt,3)}] /Contents ${contentId} 0 R /Resources << >> >>`);
  addObj(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  let pdf = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i+1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}

export function geometryToPdfBytes(geometry, options = {}) {
  const g = normalizeGeometry(geometry, options);
  const b = geometryBBox(g);
  const PT_PER_MM = 72 / 25.4;
  const marginMm = Number(options.marginMm ?? 5);
  const wMm = bboxValid(b) ? Math.max(0.001, b.maxX - b.minX) : 100;
  const hMm = bboxValid(b) ? Math.max(0.001, b.maxY - b.minY) : 100;
  const pageW = (wMm + marginMm * 2) * PT_PER_MM;
  const pageH = (hMm + marginMm * 2) * PT_PER_MM;
  const swPt = Math.max(0.05, Number(options.strokeWidthMm ?? 0.1) * PT_PER_MM);

  const lines = ["q", "0 0 0 RG", "0 0 0 rg", `${fmt(swPt,3)} w`, "1 J 1 j"];
  for (const p of g.polys) {
    const pts = p.pts || [];
    if (pts.length < 2) continue;
    const xy = (pt) => [
      (marginMm + (pt.x - b.minX)) * PT_PER_MM,
      (marginMm + (pt.y - b.minY)) * PT_PER_MM,
    ];
    const [x0, y0] = xy(pts[0]);
    lines.push(`${fmt(x0,3)} ${fmt(y0,3)} m`);
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = xy(pts[i]);
      lines.push(`${fmt(x,3)} ${fmt(y,3)} l`);
    }
    if (p.closed) lines.push("h");
    lines.push("S");
  }
  lines.push("Q");
  const pdf = makePdfDocument(lines.join("\n"), pageW, pageH);
  return new Uint8Array([...pdf].map(ch => ch.charCodeAt(0) & 255));
}

function uint8ToLatin1(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return s;
}
function latin1ToUint8(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 255;
  return out;
}
async function inflatePdfStream(bytes) {
  if (typeof DecompressionStream !== "undefined") {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const ab = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(ab);
  }
  throw new Error("Este navegador no permite descomprimir FlateDecode. Prueba con un PDF sin compresión o usa Chrome/Edge reciente.");
}

function extractPdfStreams(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const text = uint8ToLatin1(bytes);
  const streams = [];
  let pos = 0;
  while (true) {
    const si = text.indexOf("stream", pos);
    if (si < 0) break;
    const dictStart = text.lastIndexOf("<<", si);
    const dictEnd = text.lastIndexOf(">>", si);
    const dict = dictStart >= 0 && dictEnd >= dictStart ? text.slice(dictStart, dictEnd + 2) : "";
    let start = si + "stream".length;
    if (text[start] === "\r" && text[start + 1] === "\n") start += 2;
    else if (text[start] === "\n" || text[start] === "\r") start += 1;
    const ei = text.indexOf("endstream", start);
    if (ei < 0) break;
    let end = ei;
    while (end > start && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
    streams.push({ dict, bytes: bytes.slice(start, end) });
    pos = ei + "endstream".length;
  }
  return streams;
}

function tokenizePdfContent(text) {
  const cleaned = text.replace(/%[^\r\n]*/g, " ");
  const tokens = [];
  const re = /([-+]?\d*\.?\d+(?:e[-+]?\d+)?)|(cm|m|l|c|v|y|h|re|S|s|f\*?|B\*?|b\*?|n|q|Q|W\*?|RG|rg|G|g|w|J|j|M|d)\b|\[|\]|\([^)]*\)|\/[^\s\[\]<>\/()%]+/g;
  let m;
  while ((m = re.exec(cleaned))) tokens.push(m[0]);
  return tokens;
}
function isNumberToken(t) { return /^[-+]?\d*\.?\d+(?:e[-+]?\d+)?$/i.test(t); }
function isPdfOp(t) { return /^(cm|m|l|c|v|y|h|re|S|s|f\*?|B\*?|b\*?|n|q|Q|W\*?|RG|rg|G|g|w|J|j|M|d)$/.test(t); }

function parsePdfContentToPolys(text, quality = 32) {
  const tokens = tokenizePdfContent(text);
  let ctm = [1,0,0,1,0,0];
  const stack = [];
  const args = [];
  const all = [];
  let subpaths = [];
  let path = [];
  let start = null;
  let cur = null;

  const tr = (x, y) => matApply(ctm, { x, y });
  const finishSubpath = (forceClosed = false) => {
    if (path.length >= 2) subpaths.push({ pts: path.slice(), closed: !!forceClosed });
    path = []; start = null; cur = null;
  };
  const paint = () => {
    finishSubpath(false);
    for (const p of subpaths) if ((p.pts || []).length >= 2) all.push({ ...p, layer: "PDF", color: "#000000" });
    subpaths = [];
  };
  const cubic = (p0,p1,p2,p3,seg) => {
    const pts = [];
    for (let k = 1; k <= seg; k++) {
      const t = k / seg, mt = 1 - t;
      pts.push({
        x: mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x,
        y: mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y,
      });
    }
    return pts;
  };
  const take = (n) => args.splice(Math.max(0, args.length - n), n).map(Number);

  for (const tok of tokens) {
    if (isNumberToken(tok)) { args.push(Number(tok)); continue; }
    if (!isPdfOp(tok)) continue;

    switch (tok) {
      case "q": stack.push(ctm.slice()); break;
      case "Q": ctm = stack.pop() || [1,0,0,1,0,0]; break;
      case "cm": {
        const v = take(6);
        if (v.length === 6) ctm = matMul(ctm, v);
        break;
      }
      case "m": {
        const [x, y] = take(2);
        finishSubpath(false);
        const p = tr(x, y);
        path = [p]; start = { ...p }; cur = { ...p };
        break;
      }
      case "l": {
        const [x, y] = take(2);
        const p = tr(x, y);
        if (!path.length) { path = [p]; start = { ...p }; }
        else path.push(p);
        cur = { ...p };
        break;
      }
      case "c": {
        const [x1,y1,x2,y2,x3,y3] = take(6);
        if (!cur) break;
        const p1 = tr(x1,y1), p2 = tr(x2,y2), p3 = tr(x3,y3);
        for (const p of cubic(cur, p1, p2, p3, clamp(quality, 8, 256))) path.push(p);
        cur = { ...p3 };
        break;
      }
      case "v": {
        const [x2,y2,x3,y3] = take(4);
        if (!cur) break;
        const p1 = { ...cur }, p2 = tr(x2,y2), p3 = tr(x3,y3);
        for (const p of cubic(cur, p1, p2, p3, clamp(quality, 8, 256))) path.push(p);
        cur = { ...p3 };
        break;
      }
      case "y": {
        const [x1,y1,x3,y3] = take(4);
        if (!cur) break;
        const p1 = tr(x1,y1), p3 = tr(x3,y3), p2 = { ...p3 };
        for (const p of cubic(cur, p1, p2, p3, clamp(quality, 8, 256))) path.push(p);
        cur = { ...p3 };
        break;
      }
      case "h": {
        if (path.length && start) path.push({ ...start });
        finishSubpath(true);
        break;
      }
      case "re": {
        const [x,y,w,h] = take(4);
        const p0 = tr(x,y), p1 = tr(x+w,y), p2 = tr(x+w,y+h), p3 = tr(x,y+h);
        finishSubpath(false);
        subpaths.push({ pts: [p0,p1,p2,p3,p0], closed: true });
        break;
      }
      case "S": case "s": case "f": case "f*": case "B": case "B*": case "b": case "b*":
        if (tok === "s" || tok === "b" || tok === "b*") {
          if (path.length && start) path.push({ ...start });
          finishSubpath(true);
        }
        paint();
        break;
      case "n":
        subpaths = []; path = []; start = null; cur = null;
        break;
      default:
        break;
    }
    if (!["cm","m","l","c","v","y","re"].includes(tok)) args.length = 0;
  }
  paint();
  return all;
}

export async function parsePdfToGeometry(arrayBuffer, options = {}) {
  const quality = clamp(Number(options.quality) || 32, 4, 512);
  const streams = extractPdfStreams(arrayBuffer);
  if (!streams.length) throw new Error("No se encontraron streams de contenido en el PDF.");

  const polysPt = [];
  const warnings = [];
  for (const s of streams) {
    let bytes = s.bytes;
    try {
      if (/\/FlateDecode/i.test(s.dict)) bytes = await inflatePdfStream(bytes);
      const content = uint8ToLatin1(bytes);
      const found = parsePdfContentToPolys(content, quality);
      polysPt.push(...found);
    } catch (err) {
      warnings.push(err?.message || String(err));
    }
  }

  if (!polysPt.length) {
    const detail = warnings.length ? ` ${warnings[0]}` : "";
    throw new Error(`El PDF no contiene vectores compatibles o usa operadores no soportados.${detail}`);
  }

  const b = geometryBBox(polysPt);
  const PT_TO_MM = 25.4 / 72;
  const polys = polysPt.map(p => ({
    ...p,
    pts: p.pts.map(q => ({ x: (q.x - b.minX) * PT_TO_MM, y: (q.y - b.minY) * PT_TO_MM })),
  }));
  return { polys, units: "mm", sourceFormat: "pdf", bbox: geometryBBox(polys), meta: { warnings } };
}
