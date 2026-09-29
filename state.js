import { idbGet, idbPut, idbGetAll, idbDelete, uid } from './idb.js';


export const PALETTES = {
  cartoon: ['#111111', '#ffffff', '#ffcc00', '#ff5c8a', '#3dff9a', '#6ea8ff', '#ff8a3d', '#b38bff', '#ff4d6d', '#00d4ff', '#8b4513', '#f5d0c5', '#2ecc71', '#e74c3c', '#3498db', '#9b59b6'],
  skin: ['#f5d0c5', '#e0ac69', '#c68642', '#8d5524', '#5c3317', '#ffe0bd', '#ffcd94', '#d1a3a4'],
  nature: ['#1b4332', '#2d6a4f', '#40916c', '#74c69d', '#95d5b2', '#d8f3dc', '#52b788', '#081c15']
};

export const DEFAULT_TOOLS = [
  'pencil', 'brush', 'pen', 'eraser', 'fill', 'dropper',
  'lasso', 'select', 'move',
  'line', 'arc', 'rect', 'square', 'circle', 'ellipse', 'triangle', 'poly'
];

const emptyLayerData = () => ({ objects: [] });

export function createProject({
  name = 'Nova Animacao',
  width = 1280,
  height = 720,
  fps = 12,
  duration = 24
} = {}) {
  const id = uid('prj');
  const layerId = uid('ly');
  const frameCount = Math.max(1, Math.round(duration));
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push({
      id: uid('fr'),
      hold: 1,
      layers: { [layerId]: emptyLayerData() }
    });
  }
  return {
    id,
    name,
    width,
    height,
    fps,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    bg: { type: 'color', color: '#ffffff', gradient: ['#87ceeb', '#ffffff'], image: null, opacity: 1, x: 0, y: 0, scale: 1, rotation: 0 },
    layers: [{ id: layerId, name: 'Camada 1', visible: true, locked: false, opacity: 1, kind: 'draw' }],
    frames,
    audio: [],
    onion: { enabled: true, prev: 1, next: 1, opacityPrev: 0.35, opacityNext: 0.22 },
    characters: [],
    view: { zoom: 1, panX: 0, panY: 0 },
    currentFrame: 0,
    currentLayer: layerId,
    tool: 'pencil',
    color: '#111111',
    fillColor: '#ffcc00',
    brushSize: 6,
    opacity: 1,
    filled: true,
    recentColors: ['#111111', '#ffcc00', '#ff5c8a'],
    favorites: ['#ffcc00', '#111111']
  };
}

export function cloneData(d) {
  return JSON.parse(JSON.stringify(d));
}

export class StudioStore {
  constructor() {
    this.project = null;
    this.bitmaps = new Map();
    this.listeners = new Set();
    this.history = [];
    this.future = [];
    this.clipboard = null;
    this.selection = null;
    this.playing = false;
    this.dirty = false;
    this.saveTimer = null;
    this.maxHistory = 40;
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type = 'change') {
    for (const fn of this.listeners) fn(type, this);
  }

  key(frameIndex, layerId) {
    const fr = this.project.frames[frameIndex];
    return `${fr.id}__${layerId}`;
  }

  getBitmap(frameIndex, layerId, create = true) {
    const k = this.key(frameIndex, layerId);
    let c = this.bitmaps.get(k);
    if (!c && create) {
      c = document.createElement('canvas');
      c.width = this.project.width;
      c.height = this.project.height;
      this.bitmaps.set(k, c);
    }
    return c || null;
  }

  ensureFrameLayers(frameIndex) {
    const fr = this.project.frames[frameIndex];
    for (const ly of this.project.layers) {
      if (!fr.layers[ly.id]) fr.layers[ly.id] = emptyLayerData();
      this.getBitmap(frameIndex, ly.id, true);
    }
  }

  currentLayerData() {
    const p = this.project;
    this.ensureFrameLayers(p.currentFrame);
    return p.frames[p.currentFrame].layers[p.currentLayer];
  }

  snapshot(label = 'edit') {
    if (!this.project) return;
    const p = this.project;
    const frame = p.currentFrame;
    const layer = p.currentLayer;
    const canvas = this.getBitmap(frame, layer, false);
    const bitmap = canvas ? canvas.toDataURL('image/png') : null;
    const objects = cloneData(p.frames[frame].layers[layer]?.objects || []);
    this.history.push({ label, frame, layer, bitmap, objects, selection: cloneData(this.selection) });
    if (this.history.length > this.maxHistory) this.history.shift();
    this.future.length = 0;
    this.markDirty();
  }

  async restoreSnap(snap) {
    this.project.currentFrame = snap.frame;
    this.project.currentLayer = snap.layer;
    const canvas = this.getBitmap(snap.frame, snap.layer, true);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (snap.bitmap) {
      const img = await loadImage(snap.bitmap);
      ctx.drawImage(img, 0, 0);
    }
    this.project.frames[snap.frame].layers[snap.layer].objects = cloneData(snap.objects);
    this.selection = snap.selection ? cloneData(snap.selection) : null;
    this.emit();
  }

  async undo() {
    if (!this.history.length) return;
    const current = {
      frame: this.project.currentFrame,
      layer: this.project.currentLayer,
      bitmap: this.getBitmap(this.project.currentFrame, this.project.currentLayer).toDataURL('image/png'),
      objects: cloneData(this.currentLayerData().objects),
      selection: cloneData(this.selection)
    };
    const snap = this.history.pop();
    this.future.push(current);
    await this.restoreSnap(snap);
  }

  async redo() {
    if (!this.future.length) return;
    const current = {
      frame: this.project.currentFrame,
      layer: this.project.currentLayer,
      bitmap: this.getBitmap(this.project.currentFrame, this.project.currentLayer).toDataURL('image/png'),
      objects: cloneData(this.currentLayerData().objects),
      selection: cloneData(this.selection)
    };
    const snap = this.future.pop();
    this.history.push(current);
    await this.restoreSnap(snap);
  }

  markDirty() {
    this.dirty = true;
    this.project.updatedAt = Date.now();
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 900);
  }

  addFrame(after = this.project.currentFrame, duplicate = false) {
    const p = this.project;
    const src = p.frames[after];
    const neu = { id: uid('fr'), hold: 1, layers: {} };
    for (const ly of p.layers) {
      neu.layers[ly.id] = { objects: duplicate ? cloneData(src.layers[ly.id]?.objects || []) : [] };
    }
    p.frames.splice(after + 1, 0, neu);
    if (duplicate) {
      for (const ly of p.layers) {
        const from = this.getBitmap(after, ly.id, false);
        const to = this.getBitmap(after + 1, ly.id, true);
        to.getContext('2d').clearRect(0, 0, to.width, to.height);
        if (from) to.getContext('2d').drawImage(from, 0, 0);
      }
    }
    p.currentFrame = after + 1;
    this.selection = null;
    this.markDirty();
    this.emit();
  }

  deleteFrame(index = this.project.currentFrame) {
    const p = this.project;
    if (p.frames.length <= 1) return;
    const fr = p.frames[index];
    for (const ly of p.layers) this.bitmaps.delete(`${fr.id}__${ly.id}`);
    p.frames.splice(index, 1);
    p.currentFrame = Math.min(index, p.frames.length - 1);
    this.selection = null;
    this.markDirty();
    this.emit();
  }

  moveFrame(from, to) {
    const p = this.project;
    if (to < 0 || to >= p.frames.length) return;
    const [fr] = p.frames.splice(from, 1);
    p.frames.splice(to, 0, fr);
    p.currentFrame = to;
    this.markDirty();
    this.emit();
  }

  addLayer(name = null, kind = 'draw') {
    const p = this.project;
    const layer = {
      id: uid('ly'),
      name: name || `Camada ${p.layers.length + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
      kind
    };
    p.layers.push(layer);
    for (const fr of p.frames) fr.layers[layer.id] = emptyLayerData();
    p.currentLayer = layer.id;
    this.markDirty();
    this.emit();
    return layer;
  }

  deleteLayer(id) {
    const p = this.project;
    if (p.layers.length <= 1) return;
    p.layers = p.layers.filter((l) => l.id !== id);
    for (const fr of p.frames) delete fr.layers[id];
    if (p.currentLayer === id) p.currentLayer = p.layers[p.layers.length - 1].id;
    this.markDirty();
    this.emit();
  }

  duplicateLayer(id) {
    const p = this.project;
    const src = p.layers.find((l) => l.id === id);
    if (!src) return;
    const neu = { ...src, id: uid('ly'), name: src.name + ' copia' };
    const idx = p.layers.findIndex((l) => l.id === id);
    p.layers.splice(idx + 1, 0, neu);
    p.frames.forEach((fr, fi) => {
      fr.layers[neu.id] = { objects: cloneData(fr.layers[id]?.objects || []) };
      const from = this.getBitmap(fi, id, false);
      const to = this.getBitmap(fi, neu.id, true);
      to.getContext('2d').clearRect(0, 0, to.width, to.height);
      if (from) to.getContext('2d').drawImage(from, 0, 0);
    });
    p.currentLayer = neu.id;
    this.markDirty();
    this.emit();
  }

  reorderLayer(id, dir) {
    const p = this.project;
    const i = p.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (j < 0 || j >= p.layers.length) return;
    const [ly] = p.layers.splice(i, 1);
    p.layers.splice(j, 0, ly);
    this.markDirty();
    this.emit();
  }

  setFrame(i, quiet = false) {
    this.project.currentFrame = Math.max(0, Math.min(this.project.frames.length - 1, i));
    this.ensureFrameLayers(this.project.currentFrame);
    if (!quiet) this.emit();
    else this.emit('frame');
  }

  async save() {
    if (!this.project) return;
    const p = this.project;
    const frameBlobs = {};
    for (let fi = 0; fi < p.frames.length; fi++) {
      for (const ly of p.layers) {
        const c = this.getBitmap(fi, ly.id, false);
        if (!c) continue;
        const empty = isCanvasEmpty(c);
        if (empty && !(p.frames[fi].layers[ly.id]?.objects || []).length) continue;
        frameBlobs[`${p.frames[fi].id}__${ly.id}`] = c.toDataURL('image/png');
      }
    }
    const audioMeta = [];
    for (const a of p.audio) {
      audioMeta.push({ ...a, buffer: arrayBufferToBase64(a.buffer) });
    }
    const record = {
      id: p.id,
      meta: {
        ...p,
        audio: audioMeta,
        view: p.view
      },
      bitmaps: frameBlobs,
      savedAt: Date.now()
    };
    delete record.meta.frames;
    record.meta.frames = p.frames.map((f) => ({
      id: f.id,
      hold: f.hold,
      layers: Object.fromEntries(
        Object.entries(f.layers).map(([k, v]) => [k, { objects: v.objects }])
      )
    }));
    await idbPut('projects', record);
    await idbPut('meta', { key: 'lastProject', value: p.id });
    this.dirty = false;
  }

  async load(id) {
    const rec = await idbGet('projects', id);
    if (!rec) return false;
    this.bitmaps.clear();
    this.project = rec.meta;
    this.project.audio = (this.project.audio || []).map((a) => ({
      ...a,
      buffer: base64ToArrayBuffer(a.buffer)
    }));
    for (const [k, dataUrl] of Object.entries(rec.bitmaps || {})) {
      const img = await loadImage(dataUrl);
      const c = document.createElement('canvas');
      c.width = this.project.width;
      c.height = this.project.height;
      c.getContext('2d').drawImage(img, 0, 0);
      this.bitmaps.set(k, c);
    }
    this.ensureFrameLayers(this.project.currentFrame || 0);
    this.history = [];
    this.future = [];
    this.selection = null;
    this.emit('load');
    return true;
  }

  async listProjects() {
    const all = await idbGetAll('projects');
    return all
      .map((p) => ({
        id: p.id,
        name: p.meta.name,
        width: p.meta.width,
        height: p.meta.height,
        fps: p.meta.fps,
        frames: p.meta.frames.length,
        updatedAt: p.savedAt || p.meta.updatedAt
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteProject(id) {
    await idbDelete('projects', id);
  }

  async lastProjectId() {
    const m = await idbGet('meta', 'lastProject');
    return m?.value || null;
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function isCanvasEmpty(c) {
  const s = 48;
  const t = document.createElement('canvas');
  t.width = s;
  t.height = s;
  const tctx = t.getContext('2d', { willReadFrequently: true });
  tctx.drawImage(c, 0, 0, s, s);
  const d = tctx.getImageData(0, 0, s, s).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 8) return false;
  return true;
}

function arrayBufferToBase64(buf) {
  if (!buf) return null;
  const bytes = new Uint8Array(buf);
  let s = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

function base64ToArrayBuffer(b64) {
  if (!b64) return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}


