# Kitten TTS – Offline Browser Demo

Static site. Models + ORT WASM in-repo. Inference in a **Web Worker**. Cache in **IndexedDB v3**.

## Models

- **Nano int8** (~24 MB) — default
- **Nano fp32** (~54 MB)

## Notes

- Manual Load (no auto-download)
- Default speed **1.2×**
- WASM threads = max available cores (1 if page is not cross-origin isolated)
- Stop terminates the worker (reload model after Stop)

## Preview

```bash
npx serve .
```
