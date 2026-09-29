import {
  dist, rectFromPoints, regularPolygon, floodFill, hexToRgba, sampleColor,
  lassoMask, extractByMask, eraseByMask, StrokeSmoother, clamp
} from './geometry.js';
import { uid } from './idb.js';

const SHAPE_TOOLS = new Set(['line', 'arc', 'rect', 'square', 'circle', 'ellipse', 'triangle', 'poly']);
const DRAW_TOOLS = new Set(['pencil', 'brush', 'pen', 'eraser']);

export class Engine {
  constructor(store, stage, overlay) {
    this.store = store;
    this.stage = stage;
    this.overlay = overlay;
    this.view = stage.querySelector('#view');
    this.onion = stage.querySelector('#onion');
    this.draw = stage.querySelector('#draw');
    this.ui = overlay;
    this.vctx = this.view.getContext('2d');
    this.octx = this.onion.getContext('2d');
    this.dctx = this.draw.getContext('2d');
    this.uictx = this.ui.getContext('2d');
    this.pointer = null;
    this.stroke = new StrokeSmoother();
    this.shapeStart = null;
    this.lassoPath = [];
    this.panStart = null;
    this.pinch = null;
    this.raf = 0;
    this.needComposite = true;
    this.transformHandle = null;
    this.lastPt = null;
    this.spacePan = false;
    this.pointers = new Map();
    this.pinchStart = null;
    this.bind();
  }

  bind() {
    const el = this.stage;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  resizeCanvases() {
    const p = this.store.project;
    if (!p) return;
    for (const c of [this.view, this.onion, this.draw, this.ui]) {
      if (c.width !== p.width || c.height !== p.height) {
        c.width = p.width;
        c.height = p.height;
      }
    }
    this.layoutStage();
    this.needComposite = true;
    this.paint();
  }

  layoutStage() {
    const p = this.store.project;
    const wrap = this.stage.parentElement;
    const pad = 16;
    const availW = Math.max(80, wrap.clientWidth - pad);
    const availH = Math.max(80, wrap.clientHeight - pad);
    const fit = Math.min(availW / p.width, availH / p.height);
    const z = p.view.zoom * fit;
    const w = p.width * z;
    const h = p.height * z;
    this.stage.style.width = w + 'px';
    this.stage.style.height = h + 'px';
    this.stage.style.transform = `translate(${p.view.panX}px, ${p.view.panY}px)`;
    this.fitScale = fit;
  }

  screenToCanvas(e) {
    const r = this.stage.getBoundingClientRect();
    const p = this.store.project;
    return {
      x: ((e.clientX - r.left) / r.width) * p.width,
      y: ((e.clientY - r.top) / r.height) * p.height,
      pressure: e.pressure || 0.5
    };
  }

  activeLayerLocked() {
    const ly = this.store.project.layers.find((l) => l.id === this.store.project.currentLayer);
    return !ly || ly.locked || !ly.visible;
  }

  layerCanvas() {
    const p = this.store.project;
    return this.store.getBitmap(p.currentFrame, p.currentLayer, true);
  }

  onWheel(e) {
    e.preventDefault();
    const p = this.store.project;
    if (e.ctrlKey || e.metaKey) {
      const f = e.deltaY < 0 ? 1.08 : 0.92;
      p.view.zoom = clamp(p.view.zoom * f, 0.15, 8);
    } else {
      p.view.panX -= e.deltaX;
      p.view.panY -= e.deltaY;
    }
    this.layoutStage();
  }

  onDown(e) {
    if (!this.store.project) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.pinchStart = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        zoom: this.store.project.view.zoom,
        panX: this.store.project.view.panX,
        panY: this.store.project.view.panY,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2
      };
      this.pointer = null;
      this.panStart = null;
      return;
    }
    if (e.button === 1 || (e.button === 0 && (e.altKey || this.store.project.tool === 'hand'))) {
      this.panStart = { x: e.clientX, y: e.clientY, px: this.store.project.view.panX, py: this.store.project.view.panY };
      this.stage.setPointerCapture(e.pointerId);
      return;
    }
    const pt = this.screenToCanvas(e);
    this.pointer = { id: e.pointerId, ...pt };
    this.lastPt = pt;
    const tool = this.store.project.tool;

    if (this.store.selection) {
      const h = hitTransform(this.store.selection, pt);
      if (h) {
        this.liftIfNeeded();
        this.transformHandle = { kind: h, start: pt, sel: { ...this.store.selection } };
        this.stage.setPointerCapture(e.pointerId);
        return;
      }
    }

    if (this.activeLayerLocked() && !['dropper', 'select', 'move', 'lasso'].includes(tool)) return;

    if (DRAW_TOOLS.has(tool) || SHAPE_TOOLS.has(tool) || tool === 'fill') {
      this.applySelection();
    }

    if (DRAW_TOOLS.has(tool)) {
      this.store.snapshot('stroke');
      this.stroke.reset();
      this.stroke.add(pt);
      this.paintStroke(pt, pt, true);
    } else if (SHAPE_TOOLS.has(tool)) {
      this.store.snapshot('shape');
      this.shapeStart = pt;
    } else if (tool === 'lasso') {
      this.applySelection();
      this.lassoPath = [pt];
    } else if (tool === 'fill') {
      this.store.snapshot('fill');
      const c = this.layerCanvas();
      floodFill(c.getContext('2d'), pt.x, pt.y, hexToRgba(this.store.project.color, this.store.project.opacity));
      this.needComposite = true;
    } else if (tool === 'dropper') {
      this.pick(pt);
    } else if (tool === 'select') {
      this.applySelection();
      this.lassoPath = [pt];
    } else if (tool === 'move' && !this.store.selection) {
      this.panStart = { x: e.clientX, y: e.clientY, px: this.store.project.view.panX, py: this.store.project.view.panY };
    }
    this.stage.setPointerCapture(e.pointerId);
    this.paintOverlay();
  }

  onMove(e) {
    if (this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (this.pinchStart && this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const p = this.store.project;
      p.view.zoom = clamp(this.pinchStart.zoom * (d / Math.max(1, this.pinchStart.dist)), 0.15, 8);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      p.view.panX = this.pinchStart.panX + (cx - this.pinchStart.cx);
      p.view.panY = this.pinchStart.panY + (cy - this.pinchStart.cy);
      this.layoutStage();
      return;
    }
    if (this.panStart) {
      this.store.project.view.panX = this.panStart.px + (e.clientX - this.panStart.x);
      this.store.project.view.panY = this.panStart.py + (e.clientY - this.panStart.y);
      this.layoutStage();
      return;
    }
    if (!this.pointer || this.pointer.id !== e.pointerId) return;
    const pt = this.screenToCanvas(e);
    const tool = this.store.project.tool;

    if (this.transformHandle) {
      this.applyTransform(pt);
      this.paintOverlay();
      this.needComposite = true;
      this.schedule();
      return;
    }

    if (DRAW_TOOLS.has(tool)) {
      this.paintStroke(this.lastPt, pt, false);
      this.lastPt = pt;
    } else if (SHAPE_TOOLS.has(tool) && this.shapeStart) {
      this.previewShape(this.shapeStart, pt);
    } else if ((tool === 'lasso' || tool === 'select') && this.lassoPath.length) {
      this.lassoPath.push(pt);
      this.paintOverlay();
    }
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinchStart = null;
    if (this.panStart) { this.panStart = null; this.pointer = null; return; }
    if (!this.pointer) return;
    const pt = this.screenToCanvas(e);
    const tool = this.store.project.tool;

    if (this.transformHandle) {
      this.commitTransform();
      this.transformHandle = null;
      this.pointer = null;
      this.needComposite = true;
      this.paint();
      return;
    }

    if (SHAPE_TOOLS.has(tool) && this.shapeStart) {
      this.commitShape(this.shapeStart, pt);
      this.shapeStart = null;
      this.dctx.clearRect(0, 0, this.draw.width, this.draw.height);
    }

    if ((tool === 'lasso' || tool === 'select') && this.lassoPath.length > 3) {
      this.commitLasso();
    }

    this.lassoPath = [];
    this.pointer = null;
    this.needComposite = true;
    this.paint();
    this.store.markDirty();
  }

  paintStroke(a, b, start) {
    const p = this.store.project;
    const c = this.layerCanvas();
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const size = p.brushSize * (p.tool === 'pen' ? 0.7 + (this.pointer?.pressure || 0.5) : 1);
    if (p.tool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = `rgba(0,0,0,1)`;
      ctx.lineWidth = size * 1.6;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = p.opacity;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.tool === 'brush' ? size * 1.4 : size;
      if (p.tool === 'brush') ctx.shadowColor = p.color, ctx.shadowBlur = size * 0.35;
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    if (start) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = p.tool === 'eraser' ? '#000' : p.color;
      ctx.fill();
    }
    ctx.restore();
    this.needComposite = true;
    this.schedule();
  }

  previewShape(a, b) {
    const p = this.store.project;
    this.dctx.clearRect(0, 0, this.draw.width, this.draw.height);
    drawShape(this.dctx, p.tool, a, b, p);
    this.schedule();
  }

  commitShape(a, b) {
    const p = this.store.project;
    const tmp = document.createElement('canvas');
    tmp.width = p.width;
    tmp.height = p.height;
    drawShape(tmp.getContext('2d'), p.tool, a, b, p);
    const extracted = extractByMask(tmp, tmp);
    if (!extracted) {
      drawShape(this.layerCanvas().getContext('2d'), p.tool, a, b, p);
      return;
    }
    this.store.selection = {
      type: 'pixels',
      dataUrl: extracted.canvas.toDataURL('image/png'),
      x: extracted.x,
      y: extracted.y,
      w: Math.max(8, extracted.w),
      h: Math.max(8, extracted.h),
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      lifted: true
    };
    p.tool = 'move';
  }

  pick(pt) {
    const comp = document.createElement('canvas');
    const p = this.store.project;
    comp.width = p.width; comp.height = p.height;
    compositeFrame(comp.getContext('2d'), this.store, p.currentFrame, { onion: false });
    const s = sampleColor(comp.getContext('2d'), pt.x, pt.y);
    p.color = s.hex;
    if (!p.recentColors.includes(s.hex)) {
      p.recentColors.unshift(s.hex);
      p.recentColors = p.recentColors.slice(0, 12);
    }
    this.store.emit('color');
  }

  commitLasso() {
    const p = this.store.project;
    const src = this.layerCanvas();
    const mask = lassoMask(src.width, src.height, this.lassoPath);
    const extracted = extractByMask(src, mask);
    if (!extracted) return;
    const dataUrl = extracted.canvas.toDataURL('image/png');
    this.store.snapshot('lasso');
    this.store.selection = {
      type: 'pixels',
      dataUrl,
      x: extracted.x,
      y: extracted.y,
      w: extracted.w,
      h: extracted.h,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      lifted: false,
      sourceFrame: p.currentFrame,
      sourceLayer: p.currentLayer,
      maskPath: this.lassoPath.slice()
    };
    this.needComposite = true;
    this.store.emit('selection');
  }

  cutSelection() {
    if (!this.store.selection) return;
    const sel = this.store.selection;
    this.store.snapshot('cut');
    if (sel.type === 'pixels' && !sel.lifted) {
      this.liftIfNeeded();
    } else if (sel.type === 'object') {
      const objs = this.store.currentLayerData().objects;
      this.store.currentLayerData().objects = objs.filter((o) => o.id !== sel.objectId);
    }
    this.store.clipboard = {
      type: sel.type,
      dataUrl: sel.dataUrl,
      x: sel.x, y: sel.y, w: sel.w, h: sel.h,
      rotation: sel.rotation || 0,
      scaleX: sel.scaleX || 1,
      scaleY: sel.scaleY || 1,
      object: sel.type === 'object' ? this.store.currentLayerData().objects.find((o) => o.id === sel.objectId) : null,
      cut: true
    };
    this.store.selection = null;
    this.needComposite = true;
    this.paint();
    this.store.markDirty();
    this.store.emit();
  }

  copySelection() {
    if (!this.store.selection) return;
    const sel = this.store.selection;
    this.store.clipboard = {
      type: sel.type,
      dataUrl: sel.dataUrl,
      x: sel.x, y: sel.y, w: sel.w, h: sel.h,
      rotation: sel.rotation || 0,
      scaleX: sel.scaleX || 1,
      scaleY: sel.scaleY || 1,
      object: sel.type === 'object' ? { ...this.store.currentLayerData().objects.find((o) => o.id === sel.objectId) } : null,
      cut: false
    };
    this.store.emit();
  }

  pasteClipboard() {
    const clip = this.store.clipboard;
    if (!clip) return;
    this.applySelection();
    this.store.snapshot('paste');
    if (clip.type === 'pixels' || clip.dataUrl) {
      this.store.selection = {
        type: 'pixels',
        dataUrl: clip.dataUrl,
        x: (clip.x || 40) + 16,
        y: (clip.y || 40) + 16,
        w: clip.w,
        h: clip.h,
        rotation: clip.rotation || 0,
        scaleX: clip.scaleX || 1,
        scaleY: clip.scaleY || 1,
        lifted: true
      };
      this.store.project.tool = 'move';
    } else if (clip.type === 'object' && clip.object) {
      const neu = { ...JSON.parse(JSON.stringify(clip.object)), id: uid('obj'), x: clip.object.x + 12, y: clip.object.y + 12 };
      this.store.currentLayerData().objects.push(neu);
      this.store.selection = { type: 'object', objectId: neu.id, x: neu.x, y: neu.y, w: neu.w, h: neu.h, rotation: neu.rotation || 0 };
    }
    this.needComposite = true;
    this.paint();
    this.store.markDirty();
    this.store.emit();
  }

  async stampSelection(sel) {
    if (!sel || sel.type !== 'pixels' || !sel.dataUrl) return;
    const img = await loadImg(sel.dataUrl);
    const c = this.layerCanvas();
    const ctx = c.getContext('2d');
    ctx.save();
    ctx.translate(sel.x + sel.w / 2, sel.y + sel.h / 2);
    ctx.rotate(sel.rotation || 0);
    ctx.scale(sel.scaleX || 1, sel.scaleY || 1);
    ctx.drawImage(img, -sel.w / 2, -sel.h / 2, sel.w, sel.h);
    ctx.restore();
  }

  async applyTransform(pt) {
    const h = this.transformHandle;
    const sel = this.store.selection;
    const dx = pt.x - h.start.x;
    const dy = pt.y - h.start.y;
    const orig = h.sel;
    if (h.kind === 'move') {
      sel.x = orig.x + dx;
      sel.y = orig.y + dy;
    } else if (h.kind === 'rotate') {
      const cx = orig.x + orig.w / 2;
      const cy = orig.y + orig.h / 2;
      const a0 = Math.atan2(h.start.y - cy, h.start.x - cx);
      const a1 = Math.atan2(pt.y - cy, pt.x - cx);
      sel.rotation = (orig.rotation || 0) + (a1 - a0);
    } else {
      let x = orig.x, y = orig.y, w = orig.w, hgt = orig.h;
      if (h.kind.includes('e')) w = orig.w + dx;
      if (h.kind.includes('s')) hgt = orig.h + dy;
      if (h.kind.includes('w')) { x = orig.x + dx; w = orig.w - dx; }
      if (h.kind.includes('n')) { y = orig.y + dy; hgt = orig.h - dy; }
      if (w < 8) w = 8;
      if (hgt < 8) hgt = 8;
      sel.x = x; sel.y = y; sel.w = w; sel.h = hgt;
    }
    if (sel.type === 'object') {
      const obj = this.store.currentLayerData().objects.find((o) => o.id === sel.objectId);
      if (obj) {
        obj.x = sel.x; obj.y = sel.y; obj.w = sel.w; obj.h = sel.h; obj.rotation = sel.rotation || 0;
      }
    }
  }

  redrawLayerObjects() {
    const p = this.store.project;
    const c = this.layerCanvas();
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    const objs = this.store.currentLayerData().objects || [];
    for (const o of objs) drawObject(ctx, o);
  }

  liftIfNeeded() {
    const sel = this.store.selection;
    if (!sel || sel.type !== 'pixels' || sel.lifted) return;
    const src = this.layerCanvas();
    if (sel.maskPath && sel.sourceFrame === this.store.project.currentFrame && sel.sourceLayer === this.store.project.currentLayer) {
      const mask = lassoMask(src.width, src.height, sel.maskPath);
      eraseByMask(src, mask);
    }
    sel.lifted = true;
    sel.maskPath = null;
    this.needComposite = true;
    this.paint();
  }

  commitTransform() {
    const sel = this.store.selection;
    if (!sel) return;
    if (sel.type === 'pixels') {
      sel.lifted = true;
      this.store.markDirty();
    }
  }

  applySelection() {
    const sel = this.store.selection;
    if (!sel || sel.type !== 'pixels' || !sel.lifted || !sel.dataUrl) {
      if (sel && sel.type === 'pixels' && !sel.lifted) return;
      return;
    }
    const img = sel._img;
    const stamp = (image) => {
      const c = this.layerCanvas();
      const ctx = c.getContext('2d');
      ctx.save();
      ctx.translate(sel.x + sel.w / 2, sel.y + sel.h / 2);
      ctx.rotate(sel.rotation || 0);
      ctx.scale(sel.scaleX || 1, sel.scaleY || 1);
      ctx.drawImage(image, -sel.w / 2, -sel.h / 2, sel.w, sel.h);
      ctx.restore();
      this.store.selection = null;
      this.needComposite = true;
      this.store.markDirty();
    };
    if (img) {
      stamp(img);
      this.paint();
      return;
    }
    const image = new Image();
    image.onload = () => { stamp(image); this.paint(); };
    image.src = sel.dataUrl;
  }

  schedule() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.paint();
    });
  }

  paint() {
    if (!this.store.project) return;
    if (this.needComposite) {
      this.composite();
      this.needComposite = false;
    }
    this.paintOverlay();
  }

  composite() {
    const p = this.store.project;
    compositeFrame(this.vctx, this.store, p.currentFrame, { onion: false, includeDraft: this.draw });
    this.octx.clearRect(0, 0, this.onion.width, this.onion.height);
    if (p.onion.enabled && !this.store.playing) {
      drawOnion(this.octx, this.store);
    }
  }

  paintOverlay() {
    const ctx = this.uictx;
    ctx.clearRect(0, 0, this.ui.width, this.ui.height);
    if (this.lassoPath.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.lassoPath[0].x, this.lassoPath[0].y);
      for (let i = 1; i < this.lassoPath.length; i++) ctx.lineTo(this.lassoPath[i].x, this.lassoPath[i].y);
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#ffcc00';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,204,0,0.12)';
      ctx.fill();
      ctx.restore();
    }
    const sel = this.store.selection;
    if (sel && sel.type === 'pixels' && sel.dataUrl) {
      if (sel._img) {
        ctx.save();
        ctx.translate(sel.x + sel.w / 2, sel.y + sel.h / 2);
        ctx.rotate(sel.rotation || 0);
        ctx.scale(sel.scaleX || 1, sel.scaleY || 1);
        ctx.drawImage(sel._img, -sel.w / 2, -sel.h / 2, sel.w, sel.h);
        ctx.restore();
      } else {
        loadImg(sel.dataUrl).then((img) => {
          sel._img = img;
          this.paintOverlay();
        });
      }
    }
    if (sel) drawSelection(ctx, sel);
  }
}

function drawShape(ctx, tool, a, b, p) {
  ctx.save();
  ctx.globalAlpha = p.opacity;
  ctx.strokeStyle = p.color;
  ctx.fillStyle = p.fillColor;
  ctx.lineWidth = p.brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const filled = p.filled;
  if (tool === 'line') {
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  } else if (tool === 'arc') {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const r = dist(a, b) / 2;
    ctx.beginPath();
    ctx.arc(mx, my, r, Math.atan2(a.y - my, a.x - mx), Math.atan2(b.y - my, b.x - mx));
    ctx.stroke();
  } else if (tool === 'rect' || tool === 'square') {
    const r = rectFromPoints(a, b, tool === 'square');
    if (filled) ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else if (tool === 'circle' || tool === 'ellipse') {
    const r = rectFromPoints(a, b, tool === 'circle');
    ctx.beginPath();
    ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
    if (filled) ctx.fill();
    ctx.stroke();
  } else if (tool === 'triangle') {
    const r = rectFromPoints(a, b, false);
    ctx.beginPath();
    ctx.moveTo(r.x + r.w / 2, r.y);
    ctx.lineTo(r.x + r.w, r.y + r.h);
    ctx.lineTo(r.x, r.y + r.h);
    ctx.closePath();
    if (filled) ctx.fill();
    ctx.stroke();
  } else if (tool === 'poly') {
    const r = dist(a, b);
    const pts = regularPolygon(a.x, a.y, r, 6);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    if (filled) ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function shapeObject(tool, a, b, p) {
  const r = rectFromPoints(a, b, tool === 'square' || tool === 'circle');
  return {
    id: uid('obj'),
    kind: tool,
    x: r.x, y: r.y, w: r.w || dist(a, b), h: r.h || dist(a, b),
    ax: a.x, ay: a.y, bx: b.x, by: b.y,
    color: p.color, fillColor: p.fillColor, filled: p.filled,
    brushSize: p.brushSize, opacity: p.opacity, rotation: 0
  };
}

function drawObject(ctx, o) {
  ctx.save();
  ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
  ctx.rotate(o.rotation || 0);
  ctx.translate(-(o.x + o.w / 2), -(o.y + o.h / 2));
  const a = { x: o.ax ?? o.x, y: o.ay ?? o.y };
  const b = { x: o.bx ?? o.x + o.w, y: o.by ?? o.y + o.h };
  drawShape(ctx, o.kind, a, b, o);
  ctx.restore();
}

export function compositeFrame(ctx, store, frameIndex, opts = {}) {
  const p = store.project;
  const w = p.width, h = p.height;
  ctx.clearRect(0, 0, w, h);
  drawBackground(ctx, p);
  for (const ly of p.layers) {
    if (!ly.visible && !opts.forceAll) continue;
    const c = store.getBitmap(frameIndex, ly.id, false);
    if (!c) continue;
    ctx.save();
    ctx.globalAlpha = ly.opacity;
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }
  if (opts.includeDraft) ctx.drawImage(opts.includeDraft, 0, 0);
}

export function drawBackground(ctx, p) {
  const bg = p.bg || { type: 'color', color: '#ffffff' };
  ctx.save();
  ctx.globalAlpha = bg.opacity ?? 1;
  if (bg.type === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, 0, p.height);
    g.addColorStop(0, bg.gradient?.[0] || '#87ceeb');
    g.addColorStop(1, bg.gradient?.[1] || '#ffffff');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, p.width, p.height);
  } else if (bg.type === 'image' && bg._img) {
    ctx.fillStyle = bg.color || '#ffffff';
    ctx.fillRect(0, 0, p.width, p.height);
    const img = bg._img;
    const sc = bg.scale || 1;
    const rw = img.width * sc;
    const rh = img.height * sc;
    ctx.translate(p.width / 2 + (bg.x || 0), p.height / 2 + (bg.y || 0));
    ctx.rotate(bg.rotation || 0);
    ctx.drawImage(img, -rw / 2, -rh / 2, rw, rh);
  } else {
    ctx.fillStyle = bg.color || '#ffffff';
    ctx.fillRect(0, 0, p.width, p.height);
  }
  ctx.restore();
}

function drawOnion(ctx, store) {
  const p = store.project;
  const i = p.currentFrame;
  const { prev, next, opacityPrev, opacityNext } = p.onion;
  for (let k = prev; k >= 1; k--) {
    const fi = i - k;
    if (fi < 0) continue;
    ctx.save();
    ctx.globalAlpha = opacityPrev * (1 - (k - 1) / (prev + 1));
    ctx.globalCompositeOperation = 'source-over';
    tintComposite(ctx, store, fi, [255, 80, 80]);
    ctx.restore();
  }
  for (let k = 1; k <= next; k++) {
    const fi = i + k;
    if (fi >= p.frames.length) continue;
    ctx.save();
    ctx.globalAlpha = opacityNext * (1 - (k - 1) / (next + 1));
    tintComposite(ctx, store, fi, [80, 140, 255]);
    ctx.restore();
  }
}

function tintComposite(ctx, store, frameIndex, rgb) {
  const p = store.project;
  const tmp = document.createElement('canvas');
  tmp.width = p.width; tmp.height = p.height;
  const t = tmp.getContext('2d');
  for (const ly of p.layers) {
    if (!ly.visible) continue;
    const c = store.getBitmap(frameIndex, ly.id, false);
    if (c) t.drawImage(c, 0, 0);
  }
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
  t.fillRect(0, 0, tmp.width, tmp.height);
  ctx.drawImage(tmp, 0, 0);
}

function drawSelection(ctx, sel) {
  ctx.save();
  ctx.translate(sel.x + sel.w / 2, sel.y + sel.h / 2);
  ctx.rotate(sel.rotation || 0);
  ctx.strokeStyle = '#ffcc00';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 2;
  ctx.strokeRect(-sel.w / 2, -sel.h / 2, sel.w, sel.h);
  ctx.setLineDash([]);
  const hs = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  const pts = {
    nw: [-sel.w / 2, -sel.h / 2], n: [0, -sel.h / 2], ne: [sel.w / 2, -sel.h / 2],
    e: [sel.w / 2, 0], se: [sel.w / 2, sel.h / 2], s: [0, sel.h / 2],
    sw: [-sel.w / 2, sel.h / 2], w: [-sel.w / 2, 0]
  };
  ctx.fillStyle = '#ffcc00';
  for (const k of hs) {
    ctx.fillRect(pts[k][0] - 5, pts[k][1] - 5, 10, 10);
  }
  ctx.beginPath();
  ctx.moveTo(0, -sel.h / 2);
  ctx.lineTo(0, -sel.h / 2 - 22);
  ctx.stroke();
  ctx.fillStyle = '#6ea8ff';
  ctx.beginPath();
  ctx.arc(0, -sel.h / 2 - 22, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function hitSelection(sel, pt) {
  return rotateHit(sel, pt, -sel.w / 2, -sel.h / 2, sel.w, sel.h);
}

function hitTransform(sel, pt) {
  const local = toLocal(sel, pt);
  const handles = [
    ['nw', -sel.w / 2, -sel.h / 2], ['n', 0, -sel.h / 2], ['ne', sel.w / 2, -sel.h / 2],
    ['e', sel.w / 2, 0], ['se', sel.w / 2, sel.h / 2], ['s', 0, sel.h / 2],
    ['sw', -sel.w / 2, sel.h / 2], ['w', -sel.w / 2, 0]
  ];
  for (const [k, x, y] of handles) {
    if (Math.abs(local.x - x) <= 14 && Math.abs(local.y - y) <= 14) return k;
  }
  if (Math.hypot(local.x, local.y + sel.h / 2 + 22) <= 14) return 'rotate';
  if (local.x >= -sel.w / 2 && local.x <= sel.w / 2 && local.y >= -sel.h / 2 && local.y <= sel.h / 2) return 'move';
  return null;
}

function toLocal(sel, pt) {
  const cx = sel.x + sel.w / 2, cy = sel.y + sel.h / 2;
  const dx = pt.x - cx, dy = pt.y - cy;
  const a = -(sel.rotation || 0);
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

function rotateHit(sel, pt) {
  const l = toLocal(sel, pt);
  return l.x >= -sel.w / 2 && l.x <= sel.w / 2 && l.y >= -sel.h / 2 && l.y <= sel.h / 2;
}

function loadImg(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}
