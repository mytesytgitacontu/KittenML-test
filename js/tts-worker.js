/**
 * Kitten TTS worker — load + generate/stream off main thread.
 * Main can terminate() this worker to hard-abort inference (Stop).
 */
import { KittenTTS } from '../vendor/kitten-tts.js';

let tts = null;

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


function post(msg) {
  self.postMessage(msg);
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
      post({ type: 'progress', requestId, file: 'init', loaded: 0, total: 1, phase: 'start', overall: 0, detail: 'assetBase=' + assetBase });
      tts = await KittenTTS.from_pretrained(data.modelId, {
        runtime: 'cpu',
        wasmSimd: true,
        wasmThreads: data.wasmThreads || 1,
        assetBase,
        onProgress: (p) => post({ type: 'progress', requestId, ...p }),
      });
      // warm phonemizer
      try {
        if (typeof tts.generate === 'function') {
          // light touch via internal path if available — skip heavy; just mark ready
        }
      } catch (_) {}
      post({ type: 'loaded', requestId });
      return;
    }

    if (type === 'warmup') {
      if (!tts) throw new Error('Model not loaded');
      // Run a tiny generate to warm phonemizer + session
      await tts.generate('Hi.', { voice: data.voice || 'Jasper', speed: 1 });
      post({ type: 'warmed', requestId });
      return;
    }

    if (type === 'generate') {
      if (!tts) throw new Error('Model not loaded');
      const audio = await tts.generate(data.text, {
        voice: data.voice,
        speed: data.speed,
      });
      // Transfer underlying buffer when possible
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

    if (type === 'stream') {
      if (!tts) throw new Error('Model not loaded');
      let index = 0;
      for await (const { text: chunkText, audio } of tts.stream(data.text, {
        voice: data.voice,
        speed: data.speed,
      })) {
        const copy = audio.data.slice(0);
        post(
          {
            type: 'chunk',
            requestId,
            index,
            text: chunkText,
            sampleRate: audio.sampling_rate,
            pcm: copy.buffer,
          },
          [copy.buffer],
        );
        index += 1;
      }
      post({ type: 'stream-done', requestId, chunks: index });
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
