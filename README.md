# Kitten TTS Nano – Browser Demo

Static site that runs **Kitten TTS Nano 0.8** entirely in the browser.

- Model: [KittenML/kitten-tts-nano-0.8-fp32](https://huggingface.co/KittenML/kitten-tts-nano-0.8-fp32) via [onnx-community/KittenTTS-Nano-v0.8-ONNX](https://huggingface.co/onnx-community/KittenTTS-Nano-v0.8-ONNX)
- Library: [kitten-tts-js](https://github.com/Algiras/kitten-tts-js)
- Voices: Bella, Jasper, Luna, Bruno, Rosie, Hugo, Kiki, Leo
- Text input restricted to English letters + basic punctuation
- No server – inference happens on the user's device (WASM / WebGPU)

## GitHub Pages

Enable **Settings → Pages → Deploy from branch → main / (root)**.

Site will be available at:  
`https://mytesytgitacontu.github.io/KittenML-test/`

## Local preview

```bash
npx serve .
# or any static file server
```

## License

Apache-2.0 (same as the model).
