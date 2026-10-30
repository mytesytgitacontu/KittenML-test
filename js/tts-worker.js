/**
 * Kitten TTS worker — load + generate off main thread.
 * Main can terminate() this worker to hard-abort inference (Stop).
 */
import { KittenTTS } from '../vendor/kitten-tts.js';

let tts = null;

function post(msg) {
  self.postMessage(msg);
}

/** Derive site root from worker URL: .../js/tts-worker.js → .../ */
function siteRootFromWorker() {
  const u = new URL(self.location.href);
  u.hash = '';
  u.search = '';
  let path = u.pathname || '/';
  if (path.includes('/js/')) path = path.replace(/\/js\/.*$/, '/');
  if (!path.endsWith('/')) path += '/';
  u.pathname = path;
  return u.href;
}

self.onmessage = async (ev) => {
  const data = ev.data || {};
  const { type, requestId } = data;
  try {
    if (type === 'load') {
      if (tts && tts.release) {
        try { await tts.release(); } catch (_) {}
      }
      tts = null;
      const assetBase = (data.assetBase && String(data.assetBase).trim())
        ? data.assetBase
        : siteRootFromWorker();
      post({
        type: 'progress',
        requestId,
        file: 'init',
        loaded: 0,
        total: 1,
        phase: 'start',
        overall: 0,
      });
      // wasmThreads omitted → library uses max cores when COOP/COEP allows
      tts = await KittenTTS.from_pretrained(data.modelId, {
        runtime: 'cpu',
        wasmSimd: true,
        assetBase,
        onProgress: (p) => post({ type: 'progress', requestId, ...p }),
      });
      post({ type: 'loaded', requestId });
      return;
    }

    if (type === 'warmup') {
      if (!tts) throw new Error('Model not loaded');
      await tts.generate('Hi.', { voice: data.voice || 'Jasper', speed: 1.2 });
      post({ type: 'warmed', requestId });
      return;
    }

    if (type === 'generate') {
      if (!tts) throw new Error('Model not loaded');
      const audio = await tts.generate(data.text, {
        voice: data.voice,
        speed: data.speed != null ? data.speed : 1.2,
      });
      const copy = audio.data.slice(0);
      post(
        {
          type: 'generated',
          requestId,
          sampleRate: audio.sampling_rate,
          duration: audio.duration,
          pcm: copy.buffer,
        },
        [copy.buffer],
      );
      return;
    }

    if (type === 'release') {
      if (tts && tts.release) await tts.release();
      tts = null;
      post({ type: 'released', requestId });
      return;
    }

    post({ type: 'error', requestId, message: 'Unknown message type: ' + type });
  } catch (err) {
    post({
      type: 'error',
      requestId,
      message: err && err.message ? err.message : String(err),
    });
  }
};
