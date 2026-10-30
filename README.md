# Kitten TTS Nano – Offline Browser Demo

Static site. No CDN at runtime. Models + ORT WASM ship in-repo; models are cached in the browser after first Load.

## Layout

```
.
├── index.html          # markup only
├── css/
│   └── styles.css      # liquid-glass UI
├── js/
│   └── app.js          # UI + load/generate/stream
├── model/
│   ├── voices.npz      # shared voice embeddings
│   ├── nano/           # ~54 MB
│   ├── micro/          # ~40 MB
│   └── mini/           # ~75 MB
├── vendor/
│   ├── kitten-tts.js   # bundled inference lib
│   └── ort/            # ONNX Runtime Web (WASM)
├── .nojekyll
└── README.md
```

## GitHub Pages

Settings → Pages → branch `main` / root.

## Local preview

```bash
npx serve .
# or: python -m http.server 8080
```

Open over `http://` (not `file://`).

## License

Apache-2.0 (KittenML models + community JS port attribution).
