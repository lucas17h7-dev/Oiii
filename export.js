import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import { zipSync } from 'fflate';
import { compositeFrame } from './engine.js';

function makeWorkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function drawFrameScaled(store, frameIndex, dest, tw, th) {
  const src = makeWorkCanvas(store.project.width, store.project.height);
  compositeFrame(src.getContext('2d'), store, frameIndex, { onion: false, forceAll: false });
  const ctx = dest.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, tw, th);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, tw, th);
}

function even(n) {
  n = Math.max(16, n | 0);
  return n % 2 === 0 ? n : n + 1;
}

function yieldFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

export async function exportMp4(store, options, onProgress) {
  const p = store.project;
  const width = even(options.width || p.width);
  const height = even(options.height || p.height);
  const fps = Math.max(1, Math.min(60, options.fps || p.fps || 12));
  const quality = options.quality || 'high';
  const bitrate = quality === 'low' ? 1_500_000 : quality === 'medium' ? 4_000_000 : 10_000_000;

  const dest = makeWorkCanvas(width, height);

  if (typeof VideoEncoder === 'undefined') {
    return exportMp4Recorder(store, dest, width, height, fps, onProgress);
  }

  let encoderConfig = {
    codec: 'avc1.42001f',
    width,
    height,
    bitrate,
    framerate: fps,
    avc: { format: 'avc' },
    hardwareAcceleration: 'prefer-software',
    latencyMode: 'quality'
  };

  const support = await VideoEncoder.isConfigSupported(encoderConfig).catch(() => ({ supported: false }));
  if (!support.supported) {
    encoderConfig = { ...encoderConfig, codec: 'avc1.4d001f' };
    const s2 = await VideoEncoder.isConfigSupported(encoderConfig).catch(() => ({ supported: false }));
    if (!s2.supported) {
      encoderConfig = { ...encoderConfig, codec: 'avc1.64001f' };
    }
  }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width,
      height,
      frameRate: fps
    },
    audio: p.audio?.length && options.includeAudio !== false && typeof AudioEncoder !== 'undefined' ? {
      codec: 'aac',
      sampleRate: 44100,
      numberOfChannels: 2
    } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset'
  });

  let videoEncoderError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { videoEncoderError = e; }
  });
  try {
    encoder.configure(encoderConfig);
  } catch {
    encoder.close();
    return exportMp4Recorder(store, dest, width, height, fps, onProgress);
  }

  const frames = p.frames;
  const total = frames.length;
  if (!total) throw new Error('Nenhum frame para exportar.');
  const frameDur = Math.round(1e6 / fps);
  let timestamp = 0;

  for (let i = 0; i < total; i++) {
    if (videoEncoderError) throw videoEncoderError;
    drawFrameScaled(store, i, dest, width, height);
    const hold = Math.max(1, frames[i].hold || 1);
    const bitmap = await createImageBitmap(dest);
    for (let h = 0; h < hold; h++) {
      const frame = new VideoFrame(bitmap, {
        timestamp,
        duration: frameDur
      });
      encoder.encode(frame, { keyFrame: timestamp === 0 || (i % 12 === 0 && h === 0) });
      frame.close();
      timestamp += frameDur;
    }
    bitmap.close();
    if (onProgress) onProgress((i + 1) / (total + 2), `Renderizando frame ${i + 1} de ${total}`);
    if (i % 2 === 0) await yieldFrame();
  }

  await encoder.flush();
  encoder.close();

  if (p.audio?.length && options.includeAudio !== false && typeof AudioEncoder !== 'undefined') {
    try {
      await muxAudio(muxer, store, fps, total, onProgress);
    } catch (err) {
      console.warn('Audio mix failed', err);
    }
  }

  if (onProgress) onProgress(0.97, 'Montando arquivo MP4...');
  muxer.finalize();
  const buffer = target.buffer;
  if (!buffer || buffer.byteLength < 32) {
    throw new Error('Falha ao gerar MP4. Tente outra resolucao ou GIF.');
  }
  if (onProgress) onProgress(1, 'Concluido');
  return new Blob([buffer], { type: 'video/mp4' });
}

async function exportMp4Recorder(store, dest, width, height, fps, onProgress) {
  const p = store.project;
  const total = p.frames.length;
  const mime = [
    'video/mp4;codecs=avc1.42E01E',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ].find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error('Exportacao de video nao suportada neste navegador.');

  const stream = dest.captureStream(fps);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise((resolve) => { rec.onstop = resolve; });
  rec.start();
  for (let i = 0; i < total; i++) {
    drawFrameScaled(store, i, dest, width, height);
    if (onProgress) onProgress((i + 1) / (total + 1), `Renderizando frame ${i + 1} de ${total}`);
    await new Promise((r) => setTimeout(r, Math.max(1000 / fps, 16)));
  }
  rec.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());
  const type = mime.startsWith('video/mp4') ? 'video/mp4' : 'video/webm';
  return new Blob(chunks, { type });
}

async function muxAudio(muxer, store, fps, frameCount, onProgress) {
  const durationSec = frameCount / fps;
  const sampleRate = 44100;
  const channels = 2;
  const totalSamples = Math.ceil(durationSec * sampleRate);
  const mixed = new Float32Array(totalSamples * channels);
  const ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate });

  for (const track of store.project.audio) {
    if (!track.buffer) continue;
    let decoded;
    try {
      decoded = await ac.decodeAudioData(track.buffer.slice(0));
    } catch {
      continue;
    }
    const start = Math.max(0, track.start || 0);
    const trim = Math.max(0, track.trimStart || 0);
    const tDur = track.duration || decoded.duration;
    const vol = track.volume ?? 1;
    const startSample = Math.floor(start * sampleRate);
    const srcStart = Math.floor(trim * sampleRate);
    const copyCount = Math.min(
      Math.floor((tDur - trim) * sampleRate),
      decoded.length - srcStart,
      totalSamples - startSample
    );
    if (copyCount <= 0) continue;
    const ch0 = decoded.getChannelData(0);
    const ch1 = decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : ch0;
    for (let i = 0; i < copyCount; i++) {
      const di = (startSample + i) * 2;
      mixed[di] += ch0[srcStart + i] * vol;
      mixed[di + 1] += ch1[srcStart + i] * vol;
    }
  }
  try { ac.close(); } catch {}

  const support = await AudioEncoder.isConfigSupported({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    bitrate: 128000
  }).catch(() => ({ supported: false }));
  if (!support.supported) return;

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
    error: () => {}
  });
  audioEncoder.configure({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: channels,
    bitrate: 128000
  });

  const frameSize = 1024;
  for (let off = 0; off < totalSamples; off += frameSize) {
    const n = Math.min(frameSize, totalSamples - off);
    const data = mixed.subarray(off * 2, (off + n) * 2);
    const audioData = new AudioData({
      format: 'f32',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((off / sampleRate) * 1e6),
      data: data.slice()
    });
    audioEncoder.encode(audioData);
    audioData.close();
  }
  await audioEncoder.flush();
  audioEncoder.close();
  if (onProgress) onProgress(0.95, 'Mixando audio...');
}

export async function exportGif(store, options, onProgress) {
  const p = store.project;
  const width = Math.max(16, options.width || p.width);
  const height = Math.max(16, options.height || p.height);
  const fps = Math.max(1, options.fps || p.fps || 12);
  const delay = Math.max(20, Math.round(1000 / fps));
  const dest = makeWorkCanvas(width, height);
  const gif = GIFEncoder();
  const total = p.frames.length;
  for (let i = 0; i < total; i++) {
    drawFrameScaled(store, i, dest, width, height);
    const data = dest.getContext('2d').getImageData(0, 0, width, height).data;
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, width, height, { palette, delay: delay * Math.max(1, p.frames[i].hold || 1) });
    if (onProgress) onProgress((i + 1) / total, `GIF frame ${i + 1}/${total}`);
    if (i % 2 === 0) await yieldFrame();
  }
  gif.finish();
  const bytes = gif.bytes ? gif.bytes() : gif.bytesView();
  return new Blob([bytes], { type: 'image/gif' });
}

export async function exportPngSequence(store, options, onProgress) {
  const p = store.project;
  const width = options.width || p.width;
  const height = options.height || p.height;
  const dest = makeWorkCanvas(width, height);
  const files = {};
  const total = p.frames.length;
  for (let i = 0; i < total; i++) {
    drawFrameScaled(store, i, dest, width, height);
    const blob = await new Promise((res) => dest.toBlob(res, 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    const name = `frame_${String(i + 1).padStart(4, '0')}.png`;
    files[name] = buf;
    if (onProgress) onProgress((i + 1) / total, `PNG ${i + 1}/${total}`);
    await yieldFrame();
  }
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}

export async function exportCurrentPng(store, options) {
  const p = store.project;
  const width = options.width || p.width;
  const height = options.height || p.height;
  const dest = makeWorkCanvas(width, height);
  drawFrameScaled(store, p.currentFrame, dest, width, height);
  return await new Promise((res) => dest.toBlob(res, 'image/png'));
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return url;
}
