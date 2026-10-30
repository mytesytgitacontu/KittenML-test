# Kitten TTS Nano – Fully Offline Browser Demo

Static site. **No CDN, no external API, no npm at runtime.**

Everything ships inside this repository:

| Path | What |
|------|------|
| `index.html` | UI |
| `vendor/kitten-tts.js` | Bundled KittenTTS browser logic + phonemizer |
| `vendor/ort/` | ONNX Runtime Web (WASM) |
| `model/` | Kitten TTS Nano 0.8 fp32 ONNX + voices |

## Enable GitHub Pages

Settings → Pages → Deploy from branch → `main` / root.

URL: `https://mytesytgitacontu.github.io/KittenML-test/`

## Local preview

```bash
npx serve .
# or python -m http.server 8080
```

Open `http://localhost:8080` (must be served over http, not `file://`).

## License

Apache-2.0 (model + library attribution to KittenML / Algiras kitten-tts-js).
