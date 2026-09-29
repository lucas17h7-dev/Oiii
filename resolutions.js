export const RESOLUTIONS = [
  { id: '1080p', label: '1920 x 1080 HD', w: 1920, h: 1080, orientation: 'landscape' },
  { id: '720p', label: '1280 x 720 HD', w: 1280, h: 720, orientation: 'landscape' },
  { id: '1440p', label: '2560 x 1440 QHD', w: 2560, h: 1440, orientation: 'landscape' },
  { id: '4k', label: '3840 x 2160 4K', w: 3840, h: 2160, orientation: 'landscape' },
  { id: '1080v', label: '1080 x 1920 Vertical', w: 1080, h: 1920, orientation: 'portrait' },
  { id: '720v', label: '720 x 1280 Vertical', w: 720, h: 1280, orientation: 'portrait' },
  { id: 'square', label: '1080 x 1080 Quadrado', w: 1080, h: 1080, orientation: 'square' }
];

export const FPS_PRESETS = [8, 12, 15, 24, 30];

export function orientationOf(w, h) {
  if (w === h) return 'square';
  return w > h ? 'landscape' : 'portrait';
}

export function applyOrientation(w, h, orientation) {
  if (orientation === 'square') {
    const s = Math.min(w, h);
    return { w: s, h: s };
  }
  if (orientation === 'portrait' && w > h) return { w: h, h: w };
  if (orientation === 'landscape' && h > w) return { w: h, h: w };
  return { w, h };
}
