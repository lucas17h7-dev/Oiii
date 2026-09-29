import './styles.css';
import { StudioStore } from './state.js';
import { Engine } from './engine.js';
import { renderApp, bindUI, showHome, restoreBg } from './ui.js';

const root = document.getElementById('app');
renderApp(root);

const store = new StudioStore();
const stage = root.querySelector('#stage');
const overlay = root.querySelector('#overlay');
const engine = new Engine(store, stage, overlay);
const ctx = { store, engine, root };

bindUI(ctx);

async function boot() {
  const last = await store.lastProjectId();
  if (last) {
    const ok = await store.load(last);
    if (ok) {
      await restoreBg(ctx);
      const { showStudio } = await import('./ui.js');
      showStudio(ctx);
      engine.resizeCanvases();
      return;
    }
  }
  showHome(ctx);
}

boot();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/src/sw.js').catch(() => {});
}

window.addEventListener('beforeunload', () => {
  if (store.project && store.dirty) store.save();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && store.project) store.save();
});
