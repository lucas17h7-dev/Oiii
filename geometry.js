export function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const inter =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi + 1e-9) + xi;
    if (inter) inside = !inside;
  }
  return inside;
}

export function boundsOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function rectFromPoints(a, b, square = false) {
  let x = Math.min(a.x, b.x);
  let y = Math.min(a.y, b.y);
  let w = Math.abs(b.x - a.x);
  let h = Math.abs(b.y - a.y);
  if (square) {
    const s = Math.max(w, h);
    if (b.x < a.x) x = a.x - s;
    if (b.y < a.y) y = a.y - s;
    w = s;
    h = s;
  }
  return { x, y, w, h };
}

export function regularPolygon(cx, cy, r, n, rot = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * Math.PI * 2) / n;
    pts.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return pts;
}

export function floodFill(ctx, x, y, fillRgba, tolerance = 32) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  x = x | 0;
  y = y | 0;
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const i0 = (y * w + x) * 4;
  const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2], ta = d[i0 + 3];
  const fr = fillRgba[0], fg = fillRgba[1], fb = fillRgba[2], fa = fillRgba[3];
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) + Math.abs(ta - fa) < 8) return;
  const match = (i) =>
    Math.abs(d[i] - tr) <= tolerance &&
    Math.abs(d[i + 1] - tg) <= tolerance &&
    Math.abs(d[i + 2] - tb) <= tolerance &&
    Math.abs(d[i + 3] - ta) <= tolerance;
  const stack = [x, y];
  const seen = new Uint8Array(w * h);
  while (stack.length) {
    const cy = stack.pop();
    const cx = stack.pop();
    let nx = cx;
    while (nx >= 0 && match((cy * w + nx) * 4) && !seen[cy * w + nx]) nx--;
    nx++;
    let spanUp = false, spanDown = false;
    while (nx < w && match((cy * w + nx) * 4) && !seen[cy * w + nx]) {
      const i = (cy * w + nx) * 4;
      d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = fa;
      seen[cy * w + nx] = 1;
      if (cy > 0) {
        const up = (cy - 1) * w + nx;
        if (!seen[up] && match(((cy - 1) * w + nx) * 4)) {
          if (!spanUp) { stack.push(nx, cy - 1); spanUp = true; }
        } else spanUp = false;
      }
      if (cy < h - 1) {
        const dn = (cy + 1) * w + nx;
        if (!seen[dn] && match(((cy + 1) * w + nx) * 4)) {
          if (!spanDown) { stack.push(nx, cy + 1); spanDown = true; }
        } else spanDown = false;
      }
      nx++;
    }
  }
  ctx.putImageData(img, 0, 0);
}

export function hexToRgba(hex, alpha = 1) {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, Math.round(alpha * 255)];
}

export function rgbaToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function sampleColor(ctx, x, y) {
  const p = ctx.getImageData(x | 0, y | 0, 1, 1).data;
  return { hex: rgbaToHex(p[0], p[1], p[2]), a: p[3] / 255 };
}

export function lassoMask(w, h, path) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (path.length < 3) return c;
  ctx.beginPath();
  ctx.moveTo(path[0].x, path[0].y);
  for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
  return c;
}

export function extractByMask(srcCanvas, maskCanvas) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const octx = out.getContext('2d');
  const src = sctx.getImageData(0, 0, w, h);
  const mask = mctx.getImageData(0, 0, w, h);
  const dst = octx.createImageData(w, h);
  let minX = w, minY = h, maxX = 0, maxY = 0, found = false;
  for (let i = 0; i < src.data.length; i += 4) {
    const a = mask.data[i + 3];
    if (a > 10) {
      dst.data[i] = src.data[i];
      dst.data[i + 1] = src.data[i + 1];
      dst.data[i + 2] = src.data[i + 2];
      dst.data[i + 3] = Math.round((src.data[i + 3] * a) / 255);
      if (dst.data[i + 3] > 0) {
        const p = i / 4;
        const x = p % w;
        const y = (p / w) | 0;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        found = true;
      }
    }
  }
  octx.putImageData(dst, 0, 0);
  if (!found) return null;
  const pad = 2;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const crop = document.createElement('canvas');
  crop.width = cw;
  crop.height = ch;
  crop.getContext('2d').drawImage(out, minX, minY, cw, ch, 0, 0, cw, ch);
  return { canvas: crop, x: minX, y: minY, w: cw, h: ch, full: out };
}

export function eraseByMask(srcCanvas, maskCanvas) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const sctx = srcCanvas.getContext('2d', { willReadFrequently: true });
  const mctx = maskCanvas.getContext('2d', { willReadFrequently: true });
  const src = sctx.getImageData(0, 0, w, h);
  const mask = mctx.getImageData(0, 0, w, h);
  for (let i = 0; i < src.data.length; i += 4) {
    const a = mask.data[i + 3];
    if (a > 10) {
      const keep = 1 - a / 255;
      src.data[i + 3] = Math.round(src.data[i + 3] * keep);
    }
  }
  sctx.putImageData(src, 0, 0);
}

export function transformRect(sel, handle, dx, dy, keepRatio) {
  const r = { ...sel };
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (handle === 'move') {
    r.x += dx;
    r.y += dy;
    return r;
  }
  if (handle === 'rotate') {
    r.rotation = (r.rotation || 0) + Math.atan2(dy, dx) * 0.15;
    return r;
  }
  let { x, y, w, h } = r;
  if (handle.includes('e')) w += dx;
  if (handle.includes('s')) h += dy;
  if (handle.includes('w')) { x += dx; w -= dx; }
  if (handle.includes('n')) { y += dy; h -= dy; }
  if (keepRatio && sel.w && sel.h) {
    const ratio = sel.w / sel.h;
    h = w / ratio;
  }
  if (w < 4) w = 4;
  if (h < 4) h = 4;
  r.x = x; r.y = y; r.w = w; r.h = h;
  r.cx = cx; r.cy = cy;
  return r;
}

export class StrokeSmoother {
  constructor() {
    this.pts = [];
  }
  add(p) {
    this.pts.push(p);
    if (this.pts.length < 3) return this.pts.slice();
    const a = this.pts[this.pts.length - 3];
    const b = this.pts[this.pts.length - 2];
    const c = this.pts[this.pts.length - 1];
    return [
      { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      { x: b.x, y: b.y },
      { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }
    ];
  }
  reset() { this.pts = []; }
}
