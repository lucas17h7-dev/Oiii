import { ICONS } from './icons.js';
import { PALETTES, DEFAULT_TOOLS, createProject } from './state.js';
import { RESOLUTIONS, FPS_PRESETS } from './resolutions.js';
import { CHARACTER_PARTS, createCharacter, saveToLibrary, listLibrary, removeLibrary } from './library.js';
import { exportMp4, exportGif, exportPngSequence, exportCurrentPng, downloadBlob } from './export.js';
import { compositeFrame } from './engine.js';
import { loadImage } from './state.js';

const TOOL_LABELS = {
  pencil: 'Lapís', brush: 'Pincel', pen: 'Caneta', eraser: 'Borracha',
  fill: 'Balde', dropper: 'Gotas', lasso: 'Laco', select: 'Selecionar',
  move: 'Mover', line: 'Linha', arc: 'Arco', rect: 'Retangulo',
  square: 'Quadrado', circle: 'Circulo', ellipse: 'Elipse',
  triangle: 'Triangulo', poly: 'Poligono'
};

export function renderApp(root) {
  root.innerHTML = `
    <div class="home" id="home"></div>
    <div class="app hidden" id="studio">
      <header class="topbar">
        <div class="brand">CARTOON STUDIO<small>2D ANIMATION</small></div>
        <div class="proj-name" id="projName"></div>
        <div class="top-actions">
          <button class="icon-btn" data-act="undo" title="Desfazer">${ICONS.undo}</button>
          <button class="icon-btn" data-act="redo" title="Refazer">${ICONS.redo}</button>
          <button class="icon-btn" data-act="cut" title="Cortar">${ICONS.cut}</button>
          <button class="icon-btn" data-act="copy" title="Copiar">${ICONS.copy}</button>
          <button class="icon-btn" data-act="paste" title="Colar">${ICONS.paste}</button>
          <button class="icon-btn" data-act="layers" title="Camadas">${ICONS.layers}</button>
          <button class="icon-btn" data-act="onion" title="Onion Skin">${ICONS.onion}</button>
          <button class="icon-btn" data-act="export" title="Exportar">${ICONS.export}</button>
          <button class="icon-btn" data-act="menu" title="Menu">${ICONS.menu}</button>
        </div>
      </header>
      <div class="options" id="options"></div>
      <nav class="dock" id="dock"></nav>
      <main class="workspace">
        <div class="canvas-wrap">
          <div class="stage" id="stage">
            <canvas id="view"></canvas>
            <canvas id="onion"></canvas>
            <canvas id="draw"></canvas>
            <canvas id="overlay"></canvas>
          </div>
        </div>
      </main>
      <aside class="side" id="side"></aside>
      <footer class="timeline">
        <div class="tl-controls">
          <button class="icon-btn" data-act="toStart">${ICONS.start}</button>
          <button class="icon-btn" data-act="prev">${ICONS.prev}</button>
          <button class="icon-btn" data-act="play" id="playBtn">${ICONS.play}</button>
          <button class="icon-btn" data-act="stop">${ICONS.stop}</button>
          <button class="icon-btn" data-act="next">${ICONS.next}</button>
          <button class="icon-btn" data-act="toEnd">${ICONS.end}</button>
          <button class="icon-btn" data-act="addFrame">${ICONS.plus}</button>
          <button class="icon-btn" data-act="dupFrame" title="Duplicar">${ICONS.copy}</button>
          <button class="icon-btn danger" data-act="delFrame">${ICONS.trash}</button>
          <span class="tl-meta" id="tlMeta"></span>
        </div>
        <div class="frames" id="frames"></div>
      </footer>
    </div>
    <div class="sheet" id="sheet"></div>
    <div class="modal" id="modal"></div>
    <div class="toast" id="toast"></div>
    <div class="progress" id="progress">
      <div class="progress-box">
        <h3 id="progTitle">Exportando</h3>
        <p class="kbd" id="progMsg">Preparando...</p>
        <div class="bar"><i id="progBar"></i></div>
      </div>
    </div>
  `;
}

export function bindUI(ctx) {
  const { store, engine, root } = ctx;
  root.querySelector('#studio').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    handleAction(ctx, btn.dataset.act);
  });
  window.addEventListener('keydown', (e) => onKey(ctx, e));
  window.addEventListener('resize', () => engine.layoutStage());
  for (const name of ['setFrame', 'addFrame', 'deleteFrame', 'moveFrame', 'save']) {
    const orig = store[name].bind(store);
    store[name] = (...args) => {
      const sel = store.selection;
      if (sel?.lifted) engine.applySelection();
      else if (sel && name !== 'save') store.selection = null;
      return orig(...args);
    };
  }
  store.on((type) => {
    if (type === 'load') {
      showStudio(ctx);
      engine.resizeCanvases();
    }
    if (type === 'frame' && store.playing) {
      highlightFrame(ctx);
      engine.needComposite = true;
      engine.paint();
      return;
    }
    refreshChrome(ctx);
    engine.needComposite = true;
    engine.paint();
  });
}

function onKey(ctx, e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
  const k = e.key.toLowerCase();
  const mod = e.metaKey || e.ctrlKey;
  if (mod && k === 'z') { e.preventDefault(); ctx.store.undo(); }
  else if (mod && k === 'y') { e.preventDefault(); ctx.store.redo(); }
  else if (mod && k === 'c') { e.preventDefault(); ctx.engine.copySelection(); toast(ctx, 'Copiado'); }
  else if (mod && k === 'x') { e.preventDefault(); ctx.engine.cutSelection(); toast(ctx, 'Cortado'); }
  else if (mod && k === 'v') { e.preventDefault(); ctx.engine.pasteClipboard(); toast(ctx, 'Colado'); }
  else if (k === ' ') { e.preventDefault(); togglePlay(ctx); }
  else if (k === 'arrowright') ctx.store.setFrame(ctx.store.project.currentFrame + 1);
  else if (k === 'arrowleft') ctx.store.setFrame(ctx.store.project.currentFrame - 1);
  else if (k === 'delete' || k === 'backspace') {
    if (ctx.store.selection) ctx.engine.cutSelection();
  }
}

export function handleAction(ctx, act) {
  const s = ctx.store;
  const p = s.project;
  switch (act) {
    case 'undo': s.undo(); break;
    case 'redo': s.redo(); break;
    case 'cut': ctx.engine.cutSelection(); toast(ctx, 'Cortado'); break;
    case 'copy': ctx.engine.copySelection(); toast(ctx, 'Copiado'); break;
    case 'paste': ctx.engine.pasteClipboard(); toast(ctx, 'Colado'); break;
    case 'layers': openLayers(ctx); break;
    case 'onion': openOnion(ctx); break;
    case 'export': openExport(ctx); break;
    case 'menu': openMenu(ctx); break;
    case 'play': togglePlay(ctx); break;
    case 'stop': stopPlay(ctx); s.setFrame(0); break;
    case 'prev': s.setFrame(p.currentFrame - 1); break;
    case 'next': s.setFrame(p.currentFrame + 1); break;
    case 'toStart': s.setFrame(0); break;
    case 'toEnd': s.setFrame(p.frames.length - 1); break;
    case 'addFrame': s.addFrame(p.currentFrame, false); break;
    case 'dupFrame': s.addFrame(p.currentFrame, true); break;
    case 'delFrame': s.deleteFrame(); break;
    case 'home': showHome(ctx); break;
    case 'save': s.save().then(() => toast(ctx, 'Projeto salvo')); break;
    case 'colors': openColors(ctx); break;
    case 'bg': openBackground(ctx); break;
    case 'audio': openAudio(ctx); break;
    case 'library': openLibrary(ctx); break;
    case 'chars': openCharacters(ctx); break;
    case 'project': openProjectSettings(ctx); break;
  }
}

export function refreshChrome(ctx) {
  const p = ctx.store.project;
  if (!p) return;
  ctx.root.querySelector('#projName').textContent = p.name;
  renderDock(ctx);
  renderOptions(ctx);
  renderFrames(ctx);
  const playBtn = ctx.root.querySelector('#playBtn');
  playBtn.innerHTML = ctx.store.playing ? ICONS.pause : ICONS.play;
  ctx.root.querySelector('#tlMeta').textContent =
    `F ${p.currentFrame + 1}/${p.frames.length}  ${p.fps} fps  ${p.width}x${p.height}`;
}

function renderDock(ctx) {
  const dock = ctx.root.querySelector('#dock');
  const p = ctx.store.project;
  dock.innerHTML = DEFAULT_TOOLS.map((t) => `
    <button class="tool ${p.tool === t ? 'active' : ''}" data-tool="${t}">
      ${ICONS[t] || ICONS.pencil}<span>${TOOL_LABELS[t] || t}</span>
    </button>
  `).join('');
  dock.querySelectorAll('[data-tool]').forEach((b) => {
    b.onclick = () => {
      p.tool = b.dataset.tool;
      refreshChrome(ctx);
    };
  });
}

function renderOptions(ctx) {
  const p = ctx.store.project;
  const el = ctx.root.querySelector('#options');
  el.innerHTML = `
    <span class="opt-label">Cor</span>
    <button class="color-swatch" id="colorBtn" style="background:${p.color}"></button>
    <span class="opt-label">Tamanho ${p.brushSize}</span>
    <input class="slider" id="sizeSl" type="range" min="1" max="80" value="${p.brushSize}" />
    <span class="opt-label">Opac. ${Math.round(p.opacity * 100)}%</span>
    <input class="slider" id="opSl" type="range" min="5" max="100" value="${Math.round(p.opacity * 100)}" />
    <button class="chip-btn ${p.filled ? 'active' : ''}" id="fillTog">Preenchido</button>
    <button class="chip-btn ${p.onion.enabled ? 'active' : ''}" data-act="onion">Onion</button>
    <button class="chip-btn" data-act="colors">Paleta</button>
    <button class="chip-btn" data-act="bg">Fundo</button>
    <button class="chip-btn" data-act="audio">Audio</button>
    <button class="chip-btn" data-act="chars">Personagem</button>
    <button class="chip-btn" data-act="library">Biblioteca</button>
    <button class="chip-btn" id="zoomOut">${ICONS.minus}</button>
    <span class="opt-label">${Math.round(p.view.zoom * 100)}%</span>
    <button class="chip-btn" id="zoomIn">${ICONS.plus}</button>
    <button class="chip-btn" id="zoomFit">Encaixar</button>
  `;
  el.querySelector('#colorBtn').onclick = () => openColors(ctx);
  el.querySelector('#sizeSl').oninput = (e) => { p.brushSize = +e.target.value; refreshChrome(ctx); };
  el.querySelector('#opSl').oninput = (e) => { p.opacity = +e.target.value / 100; refreshChrome(ctx); };
  el.querySelector('#fillTog').onclick = () => { p.filled = !p.filled; refreshChrome(ctx); };
  el.querySelector('#zoomIn').onclick = () => { p.view.zoom = Math.min(8, p.view.zoom * 1.2); ctx.engine.layoutStage(); refreshChrome(ctx); };
  el.querySelector('#zoomOut').onclick = () => { p.view.zoom = Math.max(0.15, p.view.zoom / 1.2); ctx.engine.layoutStage(); refreshChrome(ctx); };
  el.querySelector('#zoomFit').onclick = () => { p.view.zoom = 1; p.view.panX = 0; p.view.panY = 0; ctx.engine.layoutStage(); refreshChrome(ctx); };
}

function renderFrames(ctx) {
  const p = ctx.store.project;
  const el = ctx.root.querySelector('#frames');
  const html = p.frames.map((fr, i) => {
    return `<button class="frame-cel ${i === p.currentFrame ? 'active' : ''}" data-fi="${i}">
      <canvas width="54" height="36"></canvas>
      <span class="n">${i + 1}</span>
    </button>`;
  }).join('');
  el.innerHTML = html;
  el.querySelectorAll('[data-fi]').forEach((b) => {
    const i = +b.dataset.fi;
    b.onclick = () => ctx.store.setFrame(i);
    const c = b.querySelector('canvas');
    thumbFrame(ctx, i, c);
  });
  const active = el.querySelector('.frame-cel.active');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function thumbFrame(ctx, i, c) {
  const p = ctx.store.project;
  const g = c.getContext('2d');
  g.fillStyle = p.bg?.color || '#fff';
  g.fillRect(0, 0, c.width, c.height);
  for (const ly of p.layers) {
    if (!ly.visible) continue;
    const src = ctx.store.getBitmap(i, ly.id, false);
    if (!src) continue;
    g.globalAlpha = ly.opacity;
    g.drawImage(src, 0, 0, c.width, c.height);
  }
  g.globalAlpha = 1;
}

let playTimer = 0;
function togglePlay(ctx) {
  if (ctx.store.playing) stopPlay(ctx);
  else startPlay(ctx);
}
function highlightFrame(ctx) {
  const p = ctx.store.project;
  const playBtn = ctx.root.querySelector('#playBtn');
  if (playBtn) playBtn.innerHTML = ctx.store.playing ? ICONS.pause : ICONS.play;
  const meta = ctx.root.querySelector('#tlMeta');
  if (meta) meta.textContent = `F ${p.currentFrame + 1}/${p.frames.length}  ${p.fps} fps  ${p.width}x${p.height}`;
  ctx.root.querySelectorAll('.frame-cel').forEach((el) => {
    el.classList.toggle('active', +el.dataset.fi === p.currentFrame);
  });
}

function startPlay(ctx) {
  ctx.engine.applySelection();
  ctx.store.playing = true;
  ctx.engine.needComposite = true;
  ctx.engine.paint();
  refreshChrome(ctx);
  const p = ctx.store.project;
  const tick = () => {
    if (!ctx.store.playing) return;
    let n = p.currentFrame + 1;
    if (n >= p.frames.length) n = 0;
    ctx.store.setFrame(n, true);
    const hold = p.frames[n].hold || 1;
    playTimer = setTimeout(tick, (1000 / p.fps) * hold);
  };
  playTimer = setTimeout(tick, 1000 / p.fps);
  playAudio(ctx);
}
function stopPlay(ctx) {
  ctx.store.playing = false;
  clearTimeout(playTimer);
  stopAudio(ctx);
  ctx.engine.needComposite = true;
  ctx.engine.paint();
  refreshChrome(ctx);
}

let audioEls = [];
function playAudio(ctx) {
  stopAudio(ctx);
  const p = ctx.store.project;
  const t0 = p.currentFrame / p.fps;
  for (const tr of p.audio) {
    if (!tr.objectUrl && tr.buffer) {
      tr.objectUrl = URL.createObjectURL(new Blob([tr.buffer]));
    }
    if (!tr.objectUrl) continue;
    const a = new Audio(tr.objectUrl);
    a.volume = tr.volume ?? 1;
    const startAt = Math.max(0, t0 - (tr.start || 0) + (tr.trimStart || 0));
    a.currentTime = startAt;
    if (t0 >= (tr.start || 0)) a.play().catch(() => {});
    else {
      const delay = ((tr.start || 0) - t0) * 1000;
      a._to = setTimeout(() => a.play().catch(() => {}), delay);
    }
    audioEls.push(a);
  }
}
function stopAudio() {
  for (const a of audioEls) {
    clearTimeout(a._to);
    a.pause();
  }
  audioEls = [];
}

export function toast(ctx, msg) {
  const t = ctx.root.querySelector('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._id);
  t._id = setTimeout(() => t.classList.remove('show'), 1800);
}

function openSheet(ctx, html) {
  const s = ctx.root.querySelector('#sheet');
  s.classList.add('open');
  s.innerHTML = `<div class="sheet-card"><div class="handle"></div>${html}</div>`;
  s.onclick = (e) => { if (e.target === s) closeSheet(ctx); };
}
function closeSheet(ctx) { ctx.root.querySelector('#sheet').classList.remove('open'); }

function openModal(ctx, html) {
  const s = ctx.root.querySelector('#modal');
  s.classList.add('open');
  s.innerHTML = `<div class="modal-card">${html}</div>`;
  s.onclick = (e) => { if (e.target === s) closeModal(ctx); };
}
function closeModal(ctx) { ctx.root.querySelector('#modal').classList.remove('open'); }

function openLayers(ctx) {
  const p = ctx.store.project;
  openSheet(ctx, `
    <div class="sheet-h"><h3>Camadas</h3>
      <button class="btn tiny" id="addLy">Nova</button>
    </div>
    <div class="col" id="lyList"></div>
  `);
  const list = () => {
    const box = ctx.root.querySelector('#lyList');
    box.innerHTML = p.layers.slice().reverse().map((ly) => `
      <div class="layer-item ${ly.id === p.currentLayer ? 'active' : ''}" data-ly="${ly.id}">
        <div class="layer-thumb"><canvas width="40" height="28"></canvas></div>
        <input class="grow" style="background:transparent;border:0;color:inherit;font-size:13px" value="${ly.name}" data-ren="${ly.id}" />
        <button class="icon-btn tiny" data-vis="${ly.id}">${ly.visible ? ICONS.eye : ICONS.minus}</button>
        <button class="icon-btn tiny" data-lock="${ly.id}">${ly.locked ? ICONS.lock : ICONS.eye}</button>
        <button class="icon-btn tiny" data-up="${ly.id}">▲</button>
        <button class="icon-btn tiny" data-dn="${ly.id}">▼</button>
        <button class="icon-btn tiny" data-dup="${ly.id}">${ICONS.copy}</button>
        <button class="icon-btn tiny danger" data-del="${ly.id}">${ICONS.trash}</button>
      </div>
      <div class="row" style="padding:0 8px 8px">
        <span class="opt-label">Opacidade</span>
        <input class="slider grow" type="range" min="0" max="100" value="${Math.round(ly.opacity * 100)}" data-lyop="${ly.id}" />
      </div>
    `).join('');
    box.querySelectorAll('[data-ly]').forEach((el) => {
      el.onclick = (e) => {
        if (e.target.closest('button,input')) return;
        p.currentLayer = el.dataset.ly;
        ctx.store.emit();
        list();
      };
    });
    box.querySelectorAll('[data-ren]').forEach((inp) => {
      inp.onchange = () => {
        const ly = p.layers.find((l) => l.id === inp.dataset.ren);
        if (ly) { ly.name = inp.value; ctx.store.markDirty(); }
      };
    });
    box.querySelectorAll('[data-vis]').forEach((b) => b.onclick = () => {
      const ly = p.layers.find((l) => l.id === b.dataset.vis); ly.visible = !ly.visible; ctx.store.markDirty(); ctx.store.emit(); list();
    });
    box.querySelectorAll('[data-lock]').forEach((b) => b.onclick = () => {
      const ly = p.layers.find((l) => l.id === b.dataset.lock); ly.locked = !ly.locked; ctx.store.markDirty(); list();
    });
    box.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { ctx.store.reorderLayer(b.dataset.up, 1); list(); });
    box.querySelectorAll('[data-dn]').forEach((b) => b.onclick = () => { ctx.store.reorderLayer(b.dataset.dn, -1); list(); });
    box.querySelectorAll('[data-dup]').forEach((b) => b.onclick = () => { ctx.store.duplicateLayer(b.dataset.dup); list(); });
    box.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { ctx.store.deleteLayer(b.dataset.del); list(); });
    box.querySelectorAll('[data-lyop]').forEach((sl) => sl.oninput = () => {
      const ly = p.layers.find((l) => l.id === sl.dataset.lyop);
      ly.opacity = +sl.value / 100; ctx.store.markDirty(); ctx.engine.needComposite = true; ctx.engine.paint();
    });
  };
  list();
  ctx.root.querySelector('#addLy').onclick = () => { ctx.store.addLayer(); list(); };
}

function openOnion(ctx) {
  const o = ctx.store.project.onion;
  openSheet(ctx, `
    <div class="sheet-h"><h3>Onion Skin / Ghost</h3>
      <button class="chip-btn ${o.enabled ? 'active' : ''}" id="onTog">${o.enabled ? 'Ativo' : 'Off'}</button>
    </div>
    <p class="kbd">Sombras dos frames vizinhos so aparecem na edicao. Nunca entram no MP4.</p>
    <div class="field">Frames anteriores (${o.prev})
      <input class="slider" id="prevN" type="range" min="0" max="5" value="${o.prev}" />
    </div>
    <div class="field">Opacidade anteriores ${Math.round(o.opacityPrev * 100)}%
      <input class="slider" id="prevO" type="range" min="5" max="80" value="${Math.round(o.opacityPrev * 100)}" />
    </div>
    <div class="field">Frames posteriores (${o.next})
      <input class="slider" id="nextN" type="range" min="0" max="5" value="${o.next}" />
    </div>
    <div class="field">Opacidade posteriores ${Math.round(o.opacityNext * 100)}%
      <input class="slider" id="nextO" type="range" min="5" max="80" value="${Math.round(o.opacityNext * 100)}" />
    </div>
  `);
  const bind = (id, fn) => ctx.root.querySelector(id).oninput = fn;
  ctx.root.querySelector('#onTog').onclick = () => { o.enabled = !o.enabled; ctx.store.emit(); openOnion(ctx); };
  bind('#prevN', (e) => { o.prev = +e.target.value; ctx.store.emit(); });
  bind('#nextN', (e) => { o.next = +e.target.value; ctx.store.emit(); });
  bind('#prevO', (e) => { o.opacityPrev = +e.target.value / 100; ctx.store.emit(); });
  bind('#nextO', (e) => { o.opacityNext = +e.target.value / 100; ctx.store.emit(); });
}

function openColors(ctx) {
  const p = ctx.store.project;
  openSheet(ctx, `
    <div class="sheet-h"><h3>Cores</h3></div>
    <div class="field">Cor do traco
      <input type="color" id="c1" value="${toHex(p.color)}" />
    </div>
    <div class="field">Cor de preenchimento
      <input type="color" id="c2" value="${toHex(p.fillColor)}" />
    </div>
    <p class="opt-label">Cartoon</p>
    <div class="palette" id="pal1"></div>
    <p class="opt-label">Pele</p>
    <div class="palette" id="pal2"></div>
    <p class="opt-label">Recentes</p>
    <div class="palette" id="palR"></div>
    <p class="opt-label">Favoritas</p>
    <div class="palette" id="palF"></div>
    <button class="btn full" id="favAdd">Adicionar cor atual aos favoritos</button>
  `);
  const paintPal = (id, arr) => {
    const box = ctx.root.querySelector(id);
    box.innerHTML = arr.map((c) => `<button class="pal ${c === p.color ? 'active' : ''}" data-c="${c}" style="background:${c}"></button>`).join('');
    box.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
      p.color = b.dataset.c;
      if (!p.recentColors.includes(p.color)) p.recentColors.unshift(p.color);
      ctx.store.emit('color');
      openColors(ctx);
    });
  };
  paintPal('#pal1', PALETTES.cartoon);
  paintPal('#pal2', PALETTES.skin);
  paintPal('#palR', p.recentColors);
  paintPal('#palF', p.favorites);
  ctx.root.querySelector('#c1').oninput = (e) => { p.color = e.target.value; ctx.store.emit('color'); refreshChrome(ctx); };
  ctx.root.querySelector('#c2').oninput = (e) => { p.fillColor = e.target.value; };
  ctx.root.querySelector('#favAdd').onclick = () => {
    if (!p.favorites.includes(p.color)) p.favorites.unshift(p.color);
    openColors(ctx);
  };
}

function toHex(c) {
  if (c.startsWith('#') && (c.length === 7 || c.length === 4)) return c.length === 4
    ? '#' + c[1]+c[1]+c[2]+c[2]+c[3]+c[3] : c;
  return '#111111';
}

function openBackground(ctx) {
  const bg = ctx.store.project.bg;
  openSheet(ctx, `
    <div class="sheet-h"><h3>Fundo</h3></div>
    <div class="seg" id="bgType">
      <button data-t="color" class="${bg.type === 'color' ? 'on' : ''}">Cor</button>
      <button data-t="gradient" class="${bg.type === 'gradient' ? 'on' : ''}">Gradiente</button>
      <button data-t="image" class="${bg.type === 'image' ? 'on' : ''}">Imagem</button>
    </div>
    <div class="field">Cor <input type="color" id="bgc" value="${toHex(bg.color || '#ffffff')}" /></div>
    <div class="grid-2">
      <div class="field">Grad 1 <input type="color" id="g1" value="${toHex(bg.gradient?.[0] || '#87ceeb')}" /></div>
      <div class="field">Grad 2 <input type="color" id="g2" value="${toHex(bg.gradient?.[1] || '#ffffff')}" /></div>
    </div>
    <div class="field">Opacidade ${Math.round((bg.opacity ?? 1) * 100)}%
      <input class="slider" id="bgo" type="range" min="0" max="100" value="${Math.round((bg.opacity ?? 1) * 100)}" />
    </div>
    <div class="field">Escala
      <input class="slider" id="bgs" type="range" min="20" max="300" value="${Math.round((bg.scale || 1) * 100)}" />
    </div>
    <div class="grid-2">
      <button class="btn" id="bgImg">Importar PNG/JPG/WEBP</button>
      <button class="btn" id="bgDraw">Usar desenho atual</button>
    </div>
    <input type="file" id="bgFile" accept="image/png,image/jpeg,image/jpg,image/webp" class="hidden" />
  `);
  ctx.root.querySelector('#bgType').onclick = (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    bg.type = b.dataset.t; ctx.store.markDirty(); ctx.store.emit(); openBackground(ctx);
  };
  ctx.root.querySelector('#bgc').oninput = (e) => { bg.color = e.target.value; ctx.store.markDirty(); ctx.store.emit(); };
  ctx.root.querySelector('#g1').oninput = (e) => { bg.gradient[0] = e.target.value; bg.type = 'gradient'; ctx.store.emit(); };
  ctx.root.querySelector('#g2').oninput = (e) => { bg.gradient[1] = e.target.value; bg.type = 'gradient'; ctx.store.emit(); };
  ctx.root.querySelector('#bgo').oninput = (e) => { bg.opacity = +e.target.value / 100; ctx.store.emit(); };
  ctx.root.querySelector('#bgs').oninput = (e) => { bg.scale = +e.target.value / 100; ctx.store.emit(); };
  ctx.root.querySelector('#bgImg').onclick = () => ctx.root.querySelector('#bgFile').click();
  ctx.root.querySelector('#bgFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const url = URL.createObjectURL(f);
    const img = await loadImage(url);
    bg.type = 'image'; bg._img = img; bg.image = await blobToData(f);
    ctx.store.markDirty(); ctx.store.emit();
    toast(ctx, 'Fundo importado');
  };
  ctx.root.querySelector('#bgDraw').onclick = async () => {
    const c = document.createElement('canvas');
    c.width = ctx.store.project.width; c.height = ctx.store.project.height;
    compositeFrame(c.getContext('2d'), ctx.store, ctx.store.project.currentFrame, { onion: false });
    bg.type = 'image';
    bg.image = c.toDataURL('image/png');
    bg._img = await loadImage(bg.image);
    ctx.store.emit();
  };
}

async function blobToData(file) {
  return await new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(file);
  });
}

function openAudio(ctx) {
  const p = ctx.store.project;
  openSheet(ctx, `
    <div class="sheet-h"><h3>Audio</h3></div>
    <div class="grid-2">
      <button class="btn" id="impAud">Importar MP3/WAV</button>
      <button class="btn pink" id="recAud">Gravar voz</button>
    </div>
    <input type="file" id="audFile" accept="audio/mpeg,audio/wav,audio/mp3,audio/x-wav" class="hidden" />
    <div class="col" id="audList" style="margin-top:10px"></div>
  `);
  const list = () => {
    const box = ctx.root.querySelector('#audList');
    if (!p.audio.length) { box.innerHTML = '<p class="kbd">Nenhum audio ainda.</p>'; return; }
    box.innerHTML = p.audio.map((a, i) => `
      <div class="layer-item">
        <div class="grow">
          <strong>${a.name}</strong>
          <div class="kbd">inicio ${a.start.toFixed(2)}s · vol ${Math.round(a.volume * 100)}%</div>
          <input class="slider" type="range" min="0" max="100" value="${Math.round(a.volume * 100)}" data-vol="${i}" />
          <div class="field">Inicio (s)
            <input type="number" step="0.1" value="${a.start}" data-st="${i}" />
          </div>
        </div>
        <button class="icon-btn danger tiny" data-adel="${i}">${ICONS.trash}</button>
      </div>
    `).join('');
    box.querySelectorAll('[data-vol]').forEach((sl) => sl.oninput = () => { p.audio[+sl.dataset.vol].volume = +sl.value / 100; ctx.store.markDirty(); });
    box.querySelectorAll('[data-st]').forEach((inp) => inp.onchange = () => { p.audio[+inp.dataset.st].start = +inp.value; ctx.store.markDirty(); });
    box.querySelectorAll('[data-adel]').forEach((b) => b.onclick = () => { p.audio.splice(+b.dataset.adel, 1); ctx.store.markDirty(); list(); });
  };
  list();
  ctx.root.querySelector('#impAud').onclick = () => ctx.root.querySelector('#audFile').click();
  ctx.root.querySelector('#audFile').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const buf = await f.arrayBuffer();
    p.audio.push({ id: 'a' + Date.now(), name: f.name, buffer: buf, start: 0, trimStart: 0, duration: 0, volume: 1 });
    ctx.store.markDirty();
    toast(ctx, 'Audio importado');
    openAudio(ctx);
  };
  ctx.root.querySelector('#recAud').onclick = () => recordVoice(ctx);
}

async function recordVoice(ctx) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const rec = new MediaRecorder(stream);
    const chunks = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const buffer = await blob.arrayBuffer();
      ctx.store.project.audio.push({ id: 'a' + Date.now(), name: 'Voz gravada', buffer, start: 0, trimStart: 0, duration: 0, volume: 1 });
      ctx.store.markDirty();
      toast(ctx, 'Voz gravada');
      openAudio(ctx);
    };
    rec.start();
    toast(ctx, 'Gravando 4s...');
    setTimeout(() => rec.stop(), 4000);
  } catch {
    toast(ctx, 'Microfone nao disponivel');
  }
}

function openCharacters(ctx) {
  const p = ctx.store.project;
  openSheet(ctx, `
    <div class="sheet-h"><h3>Personagens e partes</h3>
      <button class="btn tiny" id="newCh">Novo</button>
    </div>
    <p class="kbd">Cada parte vira uma camada. Selecione com o LACO, copie, cole em outro frame e mova/rotacione.</p>
    <div class="col" id="chList"></div>
    <div class="grid-2" style="margin-top:8px">
      ${CHARACTER_PARTS.map((pt) => `<button class="btn" data-part="${pt.id}">+ ${pt.name}</button>`).join('')}
    </div>
  `);
  const list = () => {
    ctx.root.querySelector('#chList').innerHTML = (p.characters || []).map((c) =>
      `<div class="char-item"><strong>${c.name}</strong> · ${c.parts.filter((x) => x.layerId).length} partes</div>`
    ).join('') || '<p class="kbd">Nenhum personagem. Crie um e adicione partes.</p>';
  };
  list();
  ctx.root.querySelector('#newCh').onclick = () => {
    const name = prompt('Nome do personagem', 'Personagem') || 'Personagem';
    p.characters.push(createCharacter(name));
    ctx.store.markDirty();
    list();
  };
  ctx.root.querySelectorAll('[data-part]').forEach((b) => b.onclick = () => {
    const part = CHARACTER_PARTS.find((x) => x.id === b.dataset.part);
    const ly = ctx.store.addLayer(part.name, 'part');
    if (!p.characters.length) p.characters.push(createCharacter('Personagem'));
    const ch = p.characters[p.characters.length - 1];
    const pr = ch.parts.find((x) => x.id === part.id);
    if (pr) pr.layerId = ly.id;
    toast(ctx, `Camada ${part.name} pronta. Desenhe a parte.`);
    closeSheet(ctx);
  });
}

async function openLibrary(ctx) {
  const items = await listLibrary();
  openSheet(ctx, `
    <div class="sheet-h"><h3>Biblioteca</h3>
      <button class="btn tiny" id="saveLib">Salvar selecao</button>
    </div>
    <div class="col" id="libList"></div>
  `);
  const box = ctx.root.querySelector('#libList');
  box.innerHTML = items.map((it) => `
    <div class="lib-item">
      <img src="${it.dataUrl}" style="width:48px;height:36px;object-fit:contain;background:#222;border-radius:6px" />
      <div class="grow"><strong>${it.name}</strong><div class="kbd">${it.kind}</div></div>
      <button class="btn tiny" data-use="${it.id}">Usar</button>
      <button class="icon-btn tiny danger" data-rm="${it.id}">${ICONS.trash}</button>
    </div>
  `).join('') || '<p class="kbd">Biblioteca vazia. Selecione com o laco e salve.</p>';
  ctx.root.querySelector('#saveLib').onclick = async () => {
    const sel = ctx.store.selection;
    if (!sel?.dataUrl) { toast(ctx, 'Selecione com o LACO primeiro'); return; }
    await saveToLibrary({ kind: 'drawing', name: 'Desenho', dataUrl: sel.dataUrl, width: sel.w, height: sel.h });
    toast(ctx, 'Salvo na biblioteca');
    openLibrary(ctx);
  };
  box.querySelectorAll('[data-use]').forEach((b) => b.onclick = async () => {
    const it = items.find((x) => x.id === b.dataset.use);
    ctx.store.clipboard = { type: 'pixels', dataUrl: it.dataUrl, x: 40, y: 40, w: it.width || 120, h: it.height || 120, rotation: 0 };
    await ctx.engine.pasteClipboard();
    toast(ctx, 'Colado na cena');
    closeSheet(ctx);
  });
  box.querySelectorAll('[data-rm]').forEach((b) => b.onclick = async () => {
    await removeLibrary(b.dataset.rm);
    openLibrary(ctx);
  });
}

function openMenu(ctx) {
  openSheet(ctx, `
    <div class="sheet-h"><h3>Menu</h3></div>
    <div class="col">
      <button class="btn" data-act="home">Projetos</button>
      <button class="btn" data-act="project">Ajustes do projeto</button>
      <button class="btn" data-act="save">Salvar agora</button>
      <button class="btn" data-act="layers">Camadas</button>
      <button class="btn" data-act="library">Biblioteca</button>
      <button class="btn primary" data-act="export">Exportar MP4 / GIF / PNG</button>
    </div>
  `);
  ctx.root.querySelector('.sheet-card').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    closeSheet(ctx);
    handleAction(ctx, b.dataset.act);
  });
}

function openProjectSettings(ctx) {
  const p = ctx.store.project;
  openModal(ctx, `
    <div class="modal-h"><h3>Projeto</h3></div>
    <div class="field">Nome <input id="pn" value="${p.name}" /></div>
    <div class="field">FPS
      <select id="pf">${FPS_PRESETS.map((f) => `<option ${f === p.fps ? 'selected' : ''}>${f}</option>`).join('')}</select>
    </div>
    <p class="kbd">${p.width} x ${p.height} · ${p.frames.length} frames</p>
    <button class="btn primary full" id="psave">Aplicar</button>
  `);
  ctx.root.querySelector('#psave').onclick = () => {
    p.name = ctx.root.querySelector('#pn').value;
    p.fps = +ctx.root.querySelector('#pf').value;
    ctx.store.markDirty();
    ctx.store.emit();
    closeModal(ctx);
  };
}

function openExport(ctx) {
  const p = ctx.store.project;
  openModal(ctx, `
    <div class="modal-h"><h3>Exportar animacao</h3></div>
    <p class="kbd">O MP4 renderiza TODOS os ${p.frames.length} frames em sequencia. Onion skin nao entra no video.</p>
    <div class="field">Resolucao
      <select id="exRes">
        ${RESOLUTIONS.map((r) => `<option value="${r.w}x${r.h}" ${r.w === p.width && r.h === p.height ? 'selected' : ''}>${r.label}</option>`).join('')}
        <option value="custom">Personalizada</option>
      </select>
    </div>
    <div class="grid-2">
      <div class="field">Largura <input id="exW" type="number" value="${p.width}" /></div>
      <div class="field">Altura <input id="exH" type="number" value="${p.height}" /></div>
    </div>
    <div class="grid-2">
      <div class="field">FPS <input id="exFps" type="number" min="1" max="60" value="${p.fps}" /></div>
      <div class="field">Qualidade
        <select id="exQ"><option>high</option><option>medium</option><option>low</option></select>
      </div>
    </div>
    <label class="check"><input type="checkbox" id="exAud" checked /> Incluir audio</label>
    <div class="col" style="margin-top:10px">
      <button class="btn primary full" id="doMp4">Exportar MP4 completo</button>
      <button class="btn full" id="doGif">Exportar GIF</button>
      <button class="btn full" id="doSeq">Sequencia PNG (ZIP)</button>
      <button class="btn full" id="doPng">PNG do frame atual</button>
    </div>
    <div id="exPrev"></div>
  `);
  const res = ctx.root.querySelector('#exRes');
  res.onchange = () => {
    if (res.value === 'custom') return;
    const [w, h] = res.value.split('x');
    ctx.root.querySelector('#exW').value = w;
    ctx.root.querySelector('#exH').value = h;
  };
  const opts = () => ({
    width: +ctx.root.querySelector('#exW').value,
    height: +ctx.root.querySelector('#exH').value,
    fps: +ctx.root.querySelector('#exFps').value,
    quality: ctx.root.querySelector('#exQ').value,
    includeAudio: ctx.root.querySelector('#exAud').checked
  });
  ctx.root.querySelector('#doMp4').onclick = () => runExport(ctx, 'mp4', opts());
  ctx.root.querySelector('#doGif').onclick = () => runExport(ctx, 'gif', opts());
  ctx.root.querySelector('#doSeq').onclick = () => runExport(ctx, 'seq', opts());
  ctx.root.querySelector('#doPng').onclick = () => runExport(ctx, 'png', opts());
}

async function runExport(ctx, kind, options) {
  const prog = ctx.root.querySelector('#progress');
  const bar = ctx.root.querySelector('#progBar');
  const msg = ctx.root.querySelector('#progMsg');
  ctx.root.querySelector('#progTitle').textContent =
    kind === 'mp4' ? 'Renderizando video MP4' : kind === 'gif' ? 'Gerando GIF' : 'Exportando imagens';
  prog.classList.add('open');
  const onP = (t, m) => { bar.style.width = Math.round(t * 100) + '%'; msg.textContent = m; };
  try {
    let blob, name;
    const base = (ctx.store.project.name || 'animacao').replace(/\s+/g, '_');
    ctx.engine.applySelection();
    if (kind === 'mp4') {
      blob = await exportMp4(ctx.store, options, onP);
      name = blob.type.includes('webm') ? base + '.webm' : base + '.mp4';
    } else if (kind === 'gif') {
      blob = await exportGif(ctx.store, options, onP);
      name = base + '.gif';
    } else if (kind === 'seq') {
      blob = await exportPngSequence(ctx.store, options, onP);
      name = base + '_frames.zip';
    } else {
      blob = await exportCurrentPng(ctx.store, options);
      name = base + '_frame.png';
    }
    const url = downloadBlob(blob, name);
    prog.classList.remove('open');
    closeModal(ctx);
    if (kind === 'mp4' || kind === 'gif') {
      openModal(ctx, `
        <div class="modal-h"><h3>Animacao exportada</h3></div>
        <p class="kbd">${ctx.store.project.frames.length} frames · ${options.fps} fps · arquivo baixado</p>
        ${kind === 'mp4'
          ? `<video class="preview-video" src="${url}" controls autoplay loop playsinline></video>`
          : `<img class="preview-video" src="${url}" />`}
        <button class="btn primary full" id="dlAgain">Baixar novamente</button>
      `);
      ctx.root.querySelector('#dlAgain').onclick = () => downloadBlob(blob, name);
    } else {
      toast(ctx, 'Arquivo baixado');
    }
  } catch (err) {
    prog.classList.remove('open');
    toast(ctx, err.message || 'Falha na exportacao');
    console.error(err);
  }
}

export function showHome(ctx) {
  ctx.root.querySelector('#studio').classList.add('hidden');
  const home = ctx.root.querySelector('#home');
  home.classList.remove('hidden');
  renderHome(ctx);
}

export function showStudio(ctx) {
  ctx.root.querySelector('#home').classList.add('hidden');
  ctx.root.querySelector('#studio').classList.remove('hidden');
  refreshChrome(ctx);
  requestAnimationFrame(() => ctx.engine.resizeCanvases());
}

export async function renderHome(ctx) {
  const list = await ctx.store.listProjects();
  const home = ctx.root.querySelector('#home');
  home.innerHTML = `
    <h1>CARTOON<br>STUDIO 2D</h1>
    <p class="lead">Estudio profissional de animacao cartoon quadro a quadro.</p>
    <button class="btn primary full" id="newP">Novo projeto</button>
    <h3 style="margin:18px 0 8px">Projetos</h3>
    <div class="col" id="plist">
      ${list.length ? list.map((p) => `
        <div class="project-card" data-open="${p.id}">
          <div class="ph"></div>
          <div class="grow">
            <strong>${p.name}</strong>
            <div class="kbd">${p.width}x${p.height} · ${p.frames} frames · ${p.fps} fps</div>
          </div>
          <button class="icon-btn danger tiny" data-delp="${p.id}">${ICONS.trash}</button>
        </div>
      `).join('') : '<p class="kbd">Nenhum projeto ainda. Crie o primeiro.</p>'}
    </div>
  `;
  home.querySelector('#newP').onclick = () => openNewProject(ctx);
  home.querySelectorAll('[data-open]').forEach((el) => {
    el.onclick = async (e) => {
      if (e.target.closest('[data-delp]')) return;
      const ok = await ctx.store.load(el.dataset.open);
      if (ok) {
        await restoreBg(ctx);
        showStudio(ctx);
      }
    };
  });
  home.querySelectorAll('[data-delp]').forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    await ctx.store.deleteProject(b.dataset.delp);
    renderHome(ctx);
  });
}

async function restoreBg(ctx) {
  const bg = ctx.store.project.bg;
  if (bg?.image) {
    try { bg._img = await loadImage(bg.image); } catch {}
  }
}

function openNewProject(ctx) {
  openModal(ctx, `
    <div class="modal-h"><h3>Novo projeto</h3></div>
    <div class="field">Nome <input id="nn" value="Minha Animacao" /></div>
    <div class="field">Resolucao
      <select id="nr">${RESOLUTIONS.map((r) => `<option value="${r.w}x${r.h}" ${r.id === '720p' ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
    </div>
    <div class="field">Orientacao
      <select id="no">
        <option value="landscape">Horizontal</option>
        <option value="portrait">Vertical</option>
        <option value="square">Quadrada</option>
      </select>
    </div>
    <div class="grid-2">
      <div class="field">FPS
        <select id="nf">${FPS_PRESETS.map((f) => `<option ${f === 12 ? 'selected' : ''}>${f}</option>`).join('')}</select>
      </div>
      <div class="field">Frames <input id="nd" type="number" min="1" max="300" value="24" /></div>
    </div>
    <div class="grid-2 hidden" id="customWH">
      <div class="field">Largura <input id="cw" type="number" value="1920" /></div>
      <div class="field">Altura <input id="ch" type="number" value="1080" /></div>
    </div>
    <button class="btn primary full" id="createP">Criar e desenhar</button>
  `);
  ctx.root.querySelector('#createP').onclick = () => {
    let [w, h] = ctx.root.querySelector('#nr').value.split('x').map(Number);
    const ori = ctx.root.querySelector('#no').value;
    if (ori === 'portrait' && w > h) [w, h] = [h, w];
    if (ori === 'square') { const s = Math.min(w, h); w = s; h = s; }
    const project = createProject({
      name: ctx.root.querySelector('#nn').value || 'Nova Animacao',
      width: w, height: h,
      fps: +ctx.root.querySelector('#nf').value,
      duration: +ctx.root.querySelector('#nd').value
    });
    ctx.store.project = project;
    ctx.store.bitmaps.clear();
    ctx.store.ensureFrameLayers(0);
    ctx.store.history = [];
    ctx.store.save();
    closeModal(ctx);
    showStudio(ctx);
    ctx.engine.resizeCanvases();
    ctx.store.emit('load');
  };
}

export { restoreBg };
