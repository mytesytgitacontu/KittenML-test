import { KittenTTS } from "./vendor/kitten-tts.js";

    const MODELS = {
      "local/kitten-tts-nano":  { label: "Nano",  approx: 54 * 1024 * 1024, files: ["nano/config.json","nano/model.onnx","voices.npz"] },
      "local/kitten-tts-micro": { label: "Micro", approx: 40 * 1024 * 1024, files: ["micro/config.json","micro/model.onnx","voices.npz"] },
      "local/kitten-tts-mini":  { label: "Mini",  approx: 75 * 1024 * 1024, files: ["mini/config.json","mini/model.onnx","voices.npz"] },
    };
    const FEMALE = ["Bella","Luna","Rosie","Kiki"];
    const MALE = ["Jasper","Bruno","Hugo","Leo"];
    const CACHE = "kitten-tts-models";

    const $ = (id) => document.getElementById(id);
    const textInput = $("textInput"), textHint = $("textHint");
    const speedRange = $("speedRange"), speedVal = $("speedVal");
    const streamToggle = $("streamToggle");
    const threadsRange = $("threadsRange"), threadsVal = $("threadsVal");
    const modelSelect = $("modelSelect"), sizeLabel = $("sizeLabel"), cacheTag = $("cacheTag");
    const progBar = $("progBar"), progFill = $("progFill"), progLine = $("progLine");
    const loadBtn = $("loadBtn"), clearCacheBtn = $("clearCacheBtn");
    const generateBtn = $("generateBtn"), downloadBtn = $("downloadBtn"), stopBtn = $("stopBtn");
    const statusEl = $("status"), audioPlayer = $("audioPlayer"), readyPill = $("readyPill");

    let tts = null, selectedVoice = "Jasper", lastAudio = null, lastBlobUrl = null;
    let abortGen = false, audioCtx = null, playQueue = Promise.resolve(), activeSources = [];
    let fileProgress = {}; // file -> {loaded,total}

    const ALLOWED = /^[A-Za-z\s.,!?'";:\-()]+$/;

    function fmtBytes(n) {
      if (n < 1024) return n + " B";
      if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
      return (n / (1024 * 1024)).toFixed(1) + " MB";
    }
    function setStatus(msg, type = "") {
      statusEl.textContent = msg;
      statusEl.className = "status " + type;
    }
    function filterInput(v) { return v.replace(/[^A-Za-z\s.,!?'";:\-()]/g, ""); }

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
      document.execCommand("insertText", false, filterInput((e.clipboardData || window.clipboardData).getData("text")));
    });
    speedRange.addEventListener("input", () => { speedVal.textContent = Number(speedRange.value).toFixed(2) + "×"; });
    threadsRange.addEventListener("input", () => { threadsVal.textContent = threadsRange.value; });

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

    async function cacheHasModel(id) {
      try {
        const cache = await caches.open(CACHE);
        const files = MODELS[id].files;
        for (const f of files) {
          if (!(await cache.match("local-v1:" + f))) return false;
        }
        return true;
      } catch { return false; }
    }

    async function refreshCacheTag() {
      const id = modelSelect.value;
      sizeLabel.textContent = "~" + fmtBytes(MODELS[id].approx);
      const hit = await cacheHasModel(id);
      cacheTag.textContent = hit ? "cached in browser" : "not cached — will download";
      cacheTag.className = "cache-tag " + (hit ? "hit" : "miss");
    }
    modelSelect.addEventListener("change", () => {
      // switching model invalidates current session
      tts = null;
      generateBtn.disabled = true;
      readyPill.textContent = "Model not loaded";
      setStatus("Model changed — click Load model.", "");
      refreshCacheTag();
      progFill.style.width = "0%";
      progBar.classList.remove("indeterminate");
      progLine.textContent = "Idle — press Load model to start.";
    });

    function updateProgressUI() {
      const files = Object.keys(fileProgress);
      if (!files.length) return;
      let loaded = 0, total = 0;
      for (const f of files) {
        loaded += fileProgress[f].loaded;
        total += fileProgress[f].total || fileProgress[f].loaded;
      }
      const pct = total > 0 ? Math.min(100, (loaded / total) * 100) : 0;
      progBar.classList.remove("indeterminate");
      progFill.style.width = pct.toFixed(1) + "%";
      const phases = files.map((f) => {
        const p = fileProgress[f];
        const tag = p.phase === "cache" ? "cache" : "dl";
        return f.split("/").pop() + " " + fmtBytes(p.loaded) + (p.total ? "/" + fmtBytes(p.total) : "") + " [" + tag + "]";
      });
      progLine.textContent = fmtBytes(loaded) + " / ~" + fmtBytes(total) + " (" + pct.toFixed(0) + "%) · " + phases.join(" · ");
    }

    async function loadModel() {
      const id = modelSelect.value;
      const meta = MODELS[id];
      loadBtn.disabled = true;
      generateBtn.disabled = true;
      downloadBtn.disabled = true;
      fileProgress = {};
      progFill.style.width = "0%";
      progBar.classList.add("indeterminate");
      progLine.textContent = "Starting…";
      setStatus("Loading " + meta.label + "…", "load");
      readyPill.textContent = "Loading…";

      try {
        if (tts && tts.release) { try { await tts.release(); } catch (_) {} }
        tts = await KittenTTS.from_pretrained(id, {
          runtime: "cpu",
          wasmSimd: true,
          wasmThreads: Number(threadsRange.value) || 1,
          onProgress: ({ file, loaded, total, phase }) => {
            fileProgress[file] = { loaded, total: total || loaded, phase };
            updateProgressUI();
          },
        });
        progBar.classList.remove("indeterminate");
        progFill.style.width = "100%";
        progLine.textContent = "Ready — " + meta.label + " loaded (cached for next time).";
        setStatus(meta.label + " ready. Generate speech below.", "ok");
        readyPill.textContent = meta.label + " ready";
        generateBtn.disabled = false;
        await refreshCacheTag();
      } catch (err) {
        console.error(err);
        progBar.classList.remove("indeterminate");
        progLine.textContent = "Failed.";
        setStatus("Load failed: " + (err && err.message ? err.message : err), "err");
        readyPill.textContent = "Model not loaded";
      } finally {
        loadBtn.disabled = false;
      }
    }

    clearCacheBtn.addEventListener("click", async () => {
      try {
        await caches.delete(CACHE);
        setStatus("Browser model cache cleared.", "ok");
        await refreshCacheTag();
        progFill.style.width = "0%";
        progLine.textContent = "Cache cleared — next Load will re-download.";
      } catch (e) {
        setStatus("Could not clear cache: " + e, "err");
      }
    });

    function stopPlayback() {
      abortGen = true;
      activeSources.forEach((s) => { try { s.stop(); } catch (_) {} });
      activeSources = [];
      playQueue = Promise.resolve();
      stopBtn.disabled = true;
    }
    function ensureCtx() {
      if (!audioCtx) audioCtx = new AudioContext({ sampleRate: 24000 });
      if (audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    }
    function enqueuePlay(float32, sampleRate) {
      const ctx = ensureCtx();
      playQueue = playQueue.then(() => new Promise((resolve) => {
        if (abortGen) { resolve(); return; }
        const buf = ctx.createBuffer(1, float32.length, sampleRate);
        buf.copyToChannel(float32, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        activeSources.push(src);
        src.onended = () => { activeSources = activeSources.filter((s) => s !== src); resolve(); };
        src.start();
      }));
      return playQueue;
    }

    function floatToWav(float32Array, sampleRate) {
      const n = float32Array.length;
      const buffer = new ArrayBuffer(44 + n * 2);
      const view = new DataView(buffer);
      const ws = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); ws(8, "WAVE"); ws(12, "fmt ");
      view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true); view.setUint16(34, 16, true); ws(36, "data"); view.setUint32(40, n * 2, true);
      let o = 44;
      for (let i = 0; i < n; i++, o += 2) {
        let s = Math.max(-1, Math.min(1, float32Array[i]));
        view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      return buffer;
    }

    async function generate() {
      const text = textInput.value.trim();
      if (!text) { setStatus("Enter text.", "err"); return; }
      if (!ALLOWED.test(text)) { setStatus("Invalid characters.", "err"); return; }
      if (!tts) { setStatus("Load a model first.", "err"); return; }

      abortGen = false;
      generateBtn.disabled = true; downloadBtn.disabled = true; stopBtn.disabled = false;
      audioPlayer.style.display = "none";
      if (lastBlobUrl) { URL.revokeObjectURL(lastBlobUrl); lastBlobUrl = null; }
      lastAudio = null;
      const speed = Number(speedRange.value) || 1;
      const stream = streamToggle.checked;
      const opts = { voice: selectedVoice, speed };

      try {
        if (stream) {
          setStatus("Streaming…", "load");
          const chunks = [];
          let i = 0;
          for await (const { text: ct, audio } of tts.stream(text, opts)) {
            if (abortGen) break;
            i++;
            chunks.push(audio.data);
            setStatus("Chunk " + i + ": “" + ct.slice(0, 36) + (ct.length > 36 ? "…" : "") + "”", "load");
            enqueuePlay(audio.data, audio.sampling_rate);
          }
          if (!abortGen && chunks.length) {
            const total = chunks.reduce((n, a) => n + a.length, 0);
            const combined = new Float32Array(total);
            let off = 0;
            for (const c of chunks) { combined.set(c, off); off += c.length; }
            lastAudio = {
              data: combined, duration: total / 24000,
              toBlob() { return new Blob([floatToWav(combined, 24000)], { type: "audio/wav" }); },
            };
            downloadBtn.disabled = false;
            setStatus("Done · " + lastAudio.duration.toFixed(2) + "s · " + selectedVoice, "ok");
          } else if (abortGen) setStatus("Stopped.", "err");
        } else {
          setStatus("Generating…", "load");
          const audio = await tts.generate(text, opts);
          if (abortGen) { setStatus("Stopped.", "err"); return; }
          lastAudio = audio;
          lastBlobUrl = URL.createObjectURL(audio.toBlob());
          audioPlayer.src = lastBlobUrl;
          audioPlayer.style.display = "block";
          audioPlayer.play().catch(() => {});
          downloadBtn.disabled = false;
          setStatus("Done · " + audio.duration.toFixed(2) + "s · " + selectedVoice, "ok");
        }
      } catch (err) {
        console.error(err);
        setStatus("Failed: " + (err && err.message ? err.message : err), "err");
      } finally {
        generateBtn.disabled = !tts;
        stopBtn.disabled = true;
      }
    }

    downloadBtn.addEventListener("click", () => {
      if (!lastAudio) return;
      const blob = typeof lastAudio.toBlob === "function" ? lastAudio.toBlob() : new Blob([floatToWav(lastAudio.data, 24000)], { type: "audio/wav" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "kitten-" + selectedVoice.toLowerCase() + "-" + Date.now() + ".wav";
      a.click();
      URL.revokeObjectURL(a.href);
    });

    loadBtn.addEventListener("click", loadModel);
    generateBtn.addEventListener("click", generate);
    stopBtn.addEventListener("click", stopPlayback);

    // NO auto-download
    refreshCacheTag();
    setStatus("Choose a model and click Load model.", "");
