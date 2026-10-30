import { clearLocalModelCache, hasValidLocalCache } from "../vendor/kitten-tts.js";

const MODELS = {
  "local/kitten-tts-nano-int8": {
    label: "Nano int8",
    approx: 24 * 1024 * 1024,
    files: ["nano-int8/config.json", "nano-int8/model.onnx", "voices.npz"],
  },
  "local/kitten-tts-nano": {
    label: "Nano fp32",
    approx: 54 * 1024 * 1024,
    files: ["nano/config.json", "nano/model.onnx", "voices.npz"],
  },
  "local/kitten-tts-micro": {
    label: "Micro",
    approx: 40 * 1024 * 1024,
    files: ["micro/config.json", "micro/model.onnx", "voices.npz"],
  },
  "local/kitten-tts-mini": {
    label: "Mini",
    approx: 75 * 1024 * 1024,
    files: ["mini/config.json", "mini/model.onnx", "voices.npz"],
  },
};

const FEMALE = ["Bella", "Luna", "Rosie", "Kiki"];
const MALE = ["Jasper", "Bruno", "Hugo", "Leo"];

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error("Missing element #" + id);
  return el;
};

const textInput = $("textInput");
const textHint = $("textHint");
const speedRange = $("speedRange");
const speedVal = $("speedVal");
const streamToggle = $("streamToggle");
const threadsRange = $("threadsRange");
const threadsVal = $("threadsVal");
const modelSelect = $("modelSelect");
const sizeLabel = $("sizeLabel");
const cacheTag = $("cacheTag");
const progBar = $("progBar");
const progFill = $("progFill");
const progLine = $("progLine");
const loadBtn = $("loadBtn");
const clearCacheBtn = $("clearCacheBtn");
const generateBtn = $("generateBtn");
const downloadBtn = $("downloadBtn");
const stopBtn = $("stopBtn");
const statusEl = $("status");
const audioPlayer = $("audioPlayer");
const readyPill = $("readyPill");

let selectedVoice = "Jasper";
let lastPcm = null;
let lastSampleRate = 24000;
let lastBlobUrl = null;
let modelReady = false;
let loadedModelId = null;
let threadsAtLoad = 1;

/** @type {Worker | null} */
let worker = null;
let requestSeq = 0;
/** @type {Map<number, {resolve:Function, reject:Function, onProgress?:Function, onChunk?:Function}>} */
const pending = new Map();

const ALLOWED = /^[A-Za-z\s.,!?'";:\-()]+$/;

/** Root URL of the site (always with trailing slash). Critical on GitHub project pages. */
function getAssetBase() {
  const u = new URL(window.location.href);
  u.hash = "";
  u.search = "";
  let path = u.pathname || "/";
  if (path.endsWith("/index.html")) path = path.slice(0, -10);
  if (!path.endsWith("/")) path += "/";
  u.pathname = path;
  return u.href;
}


function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "status " + type;
}

function filterInput(v) {
  return v.replace(/[^A-Za-z\s.,!?'";:\-()]/g, "");
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./tts-worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (ev) => {
    const msg = ev.data || {};
    const { type, requestId } = msg;
    if (type === "progress") {
      const p = pending.get(requestId);
      if (p && p.onProgress) p.onProgress(msg);
      return;
    }
    if (type === "chunk") {
      const p = pending.get(requestId);
      if (p && p.onChunk) p.onChunk(msg);
      return;
    }
    const p = pending.get(requestId);
    if (!p) return;
    if (type === "error") {
      pending.delete(requestId);
      p.reject(new Error(msg.message || "Worker error"));
      return;
    }
    if (
      type === "loaded" ||
      type === "warmed" ||
      type === "generated" ||
      type === "stream-done" ||
      type === "released"
    ) {
      pending.delete(requestId);
      p.resolve(msg);
    }
  };
  worker.onerror = (err) => {
    console.error("Worker error", err);
    setStatus("Worker failed: " + (err.message || err), "err");
  };
  return worker;
}

function killWorker() {
  if (worker) {
    try {
      worker.terminate();
    } catch (_) {}
  }
  worker = null;
  for (const [, p] of pending) {
    try {
      p.reject(new Error("Stopped"));
    } catch (_) {}
  }
  pending.clear();
  modelReady = false;
  loadedModelId = null;
}

function workerCall(payload, hooks = {}) {
  const w = ensureWorker();
  const requestId = ++requestSeq;
  return new Promise((resolve, reject) => {
    pending.set(requestId, {
      resolve,
      reject,
      onProgress: hooks.onProgress,
      onChunk: hooks.onChunk,
    });
    w.postMessage({ ...payload, requestId });
  });
}

async function requestPersistStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      const already = navigator.storage.persisted
        ? await navigator.storage.persisted()
        : false;
      if (!already) {
        const ok = await navigator.storage.persist();
        console.log("[storage] persist:", ok);
      }
    }
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      const usage = est.usage || 0;
      const quota = est.quota || 0;
      if (quota > 0 && quota - usage < 30 * 1024 * 1024) {
        setStatus(
          "Low browser storage (" +
            fmtBytes(quota - usage) +
            " free). Large models may fail to cache.",
          "err",
        );
      }
    }
  } catch (e) {
    console.warn("storage persist/estimate failed", e);
  }
}

function insertFilteredText(text) {
  const start = textInput.selectionStart ?? textInput.value.length;
  const end = textInput.selectionEnd ?? textInput.value.length;
  const filtered = filterInput(text);
  const v = textInput.value;
  textInput.value = v.slice(0, start) + filtered + v.slice(end);
  const pos = start + filtered.length;
  textInput.setSelectionRange(pos, pos);
  textInput.dispatchEvent(new Event("input", { bubbles: true }));
}

textInput.addEventListener("input", () => {
  const f = filterInput(textInput.value);
  if (f !== textInput.value) {
    const pos = textInput.selectionStart;
    textInput.value = f;
    textInput.setSelectionRange(Math.max(0, pos - 1), Math.max(0, pos - 1));
    textHint.textContent = "Non-English characters removed.";
    textHint.classList.add("err");
  } else {
    textHint.textContent = "A–Z, spaces, basic punctuation only.";
    textHint.classList.remove("err");
  }
});

textInput.addEventListener("paste", (e) => {
  e.preventDefault();
  const t = (e.clipboardData || window.clipboardData).getData("text");
  insertFilteredText(t);
});

speedRange.addEventListener("input", () => {
  speedVal.textContent = Number(speedRange.value).toFixed(2) + "×";
});

threadsRange.addEventListener("input", () => {
  threadsVal.textContent = threadsRange.value;
  if (modelReady && Number(threadsRange.value) !== threadsAtLoad) {
    setStatus("Threads changed — click Load model to apply.", "");
    generateBtn.disabled = true;
  }
});

function makeVoice(name, g) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "vbtn " + g + (name === selectedVoice ? " active" : "");
  b.textContent = name;
  b.addEventListener("click", () => {
    selectedVoice = name;
    document.querySelectorAll(".vbtn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
  });
  return b;
}

FEMALE.forEach((v) => $("voicesFemale").appendChild(makeVoice(v, "f")));
MALE.forEach((v) => $("voicesMale").appendChild(makeVoice(v, "m")));

async function refreshCacheTag() {
  const id = modelSelect.value;
  sizeLabel.textContent = "~" + fmtBytes(MODELS[id].approx);
  let hit = false;
  try {
    if (typeof hasValidLocalCache === "function") {
      hit = await hasValidLocalCache(id);
    }
  } catch (_) {
    hit = false;
  }
  cacheTag.textContent = hit ? "cached in browser" : "not cached — will download";
  cacheTag.className = "cache-tag " + (hit ? "hit" : "miss");
}

modelSelect.addEventListener("change", async () => {
  // Release previous session immediately
  if (worker && modelReady) {
    try {
      await workerCall({ type: "release" });
    } catch (_) {}
  }
  modelReady = false;
  loadedModelId = null;
  generateBtn.disabled = true;
  readyPill.textContent = "Model not loaded";
  setStatus("Model changed — click Load model.", "");
  progFill.style.width = "0%";
  progBar.classList.remove("indeterminate");
  progLine.textContent = "Idle — press Load model.";
  await refreshCacheTag();
});

function setProgressOverall(overall, detail) {
  const pct = Math.max(0, Math.min(100, (overall || 0) * 100));
  progBar.classList.remove("indeterminate");
  progFill.style.width = pct.toFixed(1) + "%";
  if (detail) progLine.textContent = detail;
}

async function loadModel() {
  const id = modelSelect.value;
  const meta = MODELS[id];
  loadBtn.disabled = true;
  generateBtn.disabled = true;
  downloadBtn.disabled = true;
  progFill.style.width = "0%";
  progBar.classList.add("indeterminate");
  progLine.textContent = "Starting…";
  setStatus("Loading " + meta.label + "…", "load");
  readyPill.textContent = "Loading…";

  await requestPersistStorage();

  // Fresh worker ensures clean state after prior Stop/terminate
  if (!worker) ensureWorker();

  const threads = Number(threadsRange.value) || 1;

  try {
    const assetBase = getAssetBase();
    await workerCall(
      { type: "load", modelId: id, wasmThreads: threads, assetBase },
      {
        onProgress: (p) => {
          const phase = p.phase === "cache" ? "cache" : "download";
          const detail =
            (p.file || "") +
            " · " +
            fmtBytes(p.loaded || 0) +
            (p.total ? " / " + fmtBytes(p.total) : "") +
            " · " +
            phase +
            (typeof p.overall === "number"
              ? " · " + Math.round(p.overall * 100) + "%"
              : "");
          setProgressOverall(
            typeof p.overall === "number" ? p.overall : 0,
            detail,
          );
        },
      },
    );

    setStatus("Warming up…", "load");
    progLine.textContent = "Warming phonemizer + session…";
    try {
      await workerCall({ type: "warmup", voice: selectedVoice });
    } catch (e) {
      console.warn("warmup failed", e);
    }

    setProgressOverall(1, "Ready — " + meta.label + " loaded.");
    setStatus(meta.label + " ready.", "ok");
    readyPill.textContent = meta.label + " ready";
    modelReady = true;
    loadedModelId = id;
    threadsAtLoad = threads;
    generateBtn.disabled = false;
    await refreshCacheTag();
  } catch (err) {
    console.error(err);
    progBar.classList.remove("indeterminate");
    progLine.textContent = "Failed.";
    const msg = err && err.message ? err.message : String(err);
    setStatus("Load failed: " + msg, "err");
    readyPill.textContent = "Model not loaded";
    modelReady = false;
  } finally {
    loadBtn.disabled = false;
  }
}

clearCacheBtn.addEventListener("click", async () => {
  try {
    killWorker();
    await clearLocalModelCache();
    generateBtn.disabled = true;
    readyPill.textContent = "Model not loaded";
    setStatus("Browser model cache cleared.", "ok");
    await refreshCacheTag();
    progFill.style.width = "0%";
    progLine.textContent = "Cache cleared — next Load will re-download.";
  } catch (e) {
    setStatus("Could not clear cache: " + e, "err");
  }
});

let audioCtx = null;
let playQueue = Promise.resolve();
let activeSources = [];

function stopPlaybackOnly() {
  activeSources.forEach((s) => {
    try {
      s.stop();
    } catch (_) {}
  });
  activeSources = [];
  playQueue = Promise.resolve();
}

function ensureCtx(sampleRate) {
  if (!audioCtx || audioCtx.sampleRate !== sampleRate) {
    try {
      if (audioCtx) audioCtx.close();
    } catch (_) {}
    try {
      audioCtx = new AudioContext({ sampleRate });
    } catch {
      audioCtx = new AudioContext();
    }
  }
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function enqueuePlay(float32, sampleRate) {
  const ctx = ensureCtx(sampleRate);
  playQueue = playQueue.then(
    () =>
      new Promise((resolve) => {
        const buf = ctx.createBuffer(1, float32.length, sampleRate);
        buf.copyToChannel(float32, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        activeSources.push(src);
        src.onended = () => {
          activeSources = activeSources.filter((s) => s !== src);
          resolve();
        };
        try {
          src.start();
        } catch {
          resolve();
        }
      }),
  );
  return playQueue;
}

function floatToWav(float32Array, sampleRate) {
  const n = float32Array.length;
  const buffer = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buffer);
  const ws = (o, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  ws(0, "RIFF");
  view.setUint32(4, 36 + n * 2, true);
  ws(8, "WAVE");
  ws(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ws(36, "data");
  view.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++, o += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function stopAll() {
  stopPlaybackOnly();
  // Hard-abort inference: terminate worker (10.B)
  killWorker();
  stopBtn.disabled = true;
  generateBtn.disabled = true;
  readyPill.textContent = "Stopped — reload model";
  setStatus("Stopped. Click Load model to continue.", "err");
  progLine.textContent = "Worker terminated — model must be loaded again.";
}

async function generate() {
  const text = textInput.value.trim();
  if (!text) {
    setStatus("Enter text.", "err");
    return;
  }
  if (!ALLOWED.test(text)) {
    setStatus("Invalid characters.", "err");
    return;
  }
  if (!modelReady || !worker) {
    setStatus("Load a model first.", "err");
    return;
  }

  generateBtn.disabled = true;
  downloadBtn.disabled = true;
  stopBtn.disabled = false;
  audioPlayer.style.display = "none";
  if (lastBlobUrl) {
    URL.revokeObjectURL(lastBlobUrl);
    lastBlobUrl = null;
  }
  lastPcm = null;

  const speed = Number(speedRange.value) || 1;
  const stream = streamToggle.checked;
  const voice = selectedVoice;

  try {
    if (stream) {
      setStatus("Streaming…", "load");
      const chunks = [];
      let sampleRate = 24000;
      await workerCall(
        { type: "stream", text, voice, speed },
        {
          onChunk: (msg) => {
            const pcm = new Float32Array(msg.pcm);
            sampleRate = msg.sampleRate || sampleRate;
            chunks.push(pcm);
            setStatus(
              "Chunk " +
                (msg.index + 1) +
                ": “" +
                String(msg.text || "").slice(0, 36) +
                "”",
              "load",
            );
            enqueuePlay(pcm, sampleRate);
          },
        },
      );
      if (chunks.length) {
        const total = chunks.reduce((n, a) => n + a.length, 0);
        const combined = new Float32Array(total);
        let off = 0;
        for (const c of chunks) {
          combined.set(c, off);
          off += c.length;
        }
        lastPcm = combined;
        lastSampleRate = sampleRate;
        const blob = new Blob([floatToWav(combined, sampleRate)], {
          type: "audio/wav",
        });
        lastBlobUrl = URL.createObjectURL(blob);
        audioPlayer.src = lastBlobUrl;
        audioPlayer.style.display = "block";
        downloadBtn.disabled = false;
        setStatus(
          "Done · " + (total / sampleRate).toFixed(2) + "s · " + voice,
          "ok",
        );
      }
    } else {
      setStatus("Generating…", "load");
      const msg = await workerCall({ type: "generate", text, voice, speed });
      const pcm = new Float32Array(msg.pcm);
      lastPcm = pcm;
      lastSampleRate = msg.sampleRate || 24000;
      const blob = new Blob([floatToWav(pcm, lastSampleRate)], {
        type: "audio/wav",
      });
      lastBlobUrl = URL.createObjectURL(blob);
      audioPlayer.src = lastBlobUrl;
      audioPlayer.style.display = "block";
      audioPlayer.play().catch(() => {});
      downloadBtn.disabled = false;
      setStatus(
        "Done · " +
          (msg.duration != null
            ? Number(msg.duration).toFixed(2)
            : (pcm.length / lastSampleRate).toFixed(2)) +
          "s · " +
          voice,
        "ok",
      );
    }
  } catch (err) {
    console.error(err);
    const msg = err && err.message ? err.message : String(err);
    if (msg === "Stopped") setStatus("Stopped.", "err");
    else setStatus("Failed: " + msg, "err");
  } finally {
    stopBtn.disabled = true;
    generateBtn.disabled = !modelReady;
  }
}

downloadBtn.addEventListener("click", () => {
  if (!lastPcm) return;
  const blob = new Blob([floatToWav(lastPcm, lastSampleRate)], {
    type: "audio/wav",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download =
    "kitten-" + selectedVoice.toLowerCase() + "-" + Date.now() + ".wav";
  a.click();
  URL.revokeObjectURL(a.href);
});

loadBtn.addEventListener("click", loadModel);
generateBtn.addEventListener("click", generate);
stopBtn.addEventListener("click", stopAll);

// init — no auto download
requestPersistStorage();
refreshCacheTag();
setStatus("Choose a model and click Load model.", "");
