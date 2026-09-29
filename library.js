import { idbGetAll, idbPut, idbDelete, uid } from './idb.js';

export async function saveToLibrary(item) {
  const rec = {
    id: uid('lib'),
    kind: item.kind,
    name: item.name || 'Item',
    dataUrl: item.dataUrl,
    width: item.width,
    height: item.height,
    createdAt: Date.now()
  };
  await idbPut('library', rec);
  return rec;
}

export async function listLibrary(kind) {
  const all = await idbGetAll('library');
  return all
    .filter((x) => !kind || x.kind === kind)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function removeLibrary(id) {
  await idbDelete('library', id);
}

export const CHARACTER_PARTS = [
  { id: 'head', name: 'Cabeca' },
  { id: 'eyes', name: 'Olhos' },
  { id: 'mouth', name: 'Boca' },
  { id: 'torso', name: 'Tronco' },
  { id: 'armL', name: 'Braco E' },
  { id: 'armR', name: 'Braco D' },
  { id: 'handL', name: 'Mao E' },
  { id: 'handR', name: 'Mao D' },
  { id: 'legL', name: 'Perna E' },
  { id: 'legR', name: 'Perna D' },
  { id: 'footL', name: 'Pe E' },
  { id: 'footR', name: 'Pe D' }
];

export function createCharacter(name = 'Personagem') {
  return {
    id: uid('ch'),
    name,
    parts: CHARACTER_PARTS.map((p) => ({
      id: p.id,
      name: p.name,
      layerId: null,
      x: 0, y: 0, rotation: 0, scale: 1,
      bone: { parent: defaultParent(p.id), length: 40, angle: 0 }
    })),
    keyframes: []
  };
}

function defaultParent(id) {
  const map = {
    head: 'torso',
    eyes: 'head',
    mouth: 'head',
    torso: null,
    armL: 'torso',
    armR: 'torso',
    handL: 'armL',
    handR: 'armR',
    legL: 'torso',
    legR: 'torso',
    footL: 'legL',
    footR: 'legR'
  };
  return map[id] || null;
}
