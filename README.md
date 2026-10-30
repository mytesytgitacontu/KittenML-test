# Kitten TTS – Offline Browser Demo

Static site. Models + ORT WASM ship in-repo. Inference runs in a **Web Worker** (Stop = `worker.terminate()`). Models cache in **IndexedDB v3**.

## Layout

```
.
├── index.html
├── css/styles.css
├── js/
│   ├── app.js           # UI
│   └── tts-worker.js    # load / generate / stream
├── model/
│   ├── voices.npz
│   ├── nano-int8/       # ~24 MB (default)
│   ├── nano/            # ~54 MB fp32
│   ├── micro/
│   └── mini/
├── vendor/
│   ├── kitten-tts.js
│   └── ort/
└── README.md
```

## Notes

- Default model: **Nano int8**
- Load is manual (no auto-download)
- Progress is weighted (config 1% / onnx 95% / voices 4%)
- `navigator.storage.persist()` requested on load
- After **Stop**, click **Load model** again

## Preview

```bash
npx serve .
```

Use `http://` (not `file://`).
