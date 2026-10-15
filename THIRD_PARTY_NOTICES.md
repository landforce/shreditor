# Third-party notices

Shreditor (a fork of FreeCut, MIT, see `LICENSE`) uses the components below.
Transcription runs on the user's computer: whisper.cpp in the local bridge,
or ONNX models in the browser. Media is never uploaded for it. Model files
are downloaded from Hugging Face on first use and cached.

The editor lists the transcription entries under Settings > AI > Models and licenses.

## Transcription

| Component | License | How Shreditor uses it |
|---|---|---|
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT | Native background transcription (`server/transcription.mjs`). Not bundled: Shreditor runs the user's installed `whisper-cli` (`brew install whisper-cpp`). |
| [OpenAI Whisper](https://github.com/openai/whisper) weights | MIT | `ggml-large-v3-turbo.bin` from [ggerganov/whisper.cpp](https://huggingface.co/ggerganov/whisper.cpp) for native transcription (downloaded by `shred setup --yes`, sha256 `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69`). In the browser: `onnx-community/whisper-{tiny,base,small,large-v3-turbo}_timestamped`, ONNX conversions of the same MIT weights. |
| [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) | CC-BY-4.0 | Default in-browser transcription. Attribution: model by NVIDIA, licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). Shreditor loads the community ONNX conversion [Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx](https://huggingface.co/Olicorne/parakeet-tdt-0.6b-v3-smoothquant-onnx), whose model card states `license: cc-by-4.0` (quantized; not modified further by Shreditor). |
| [Transformers.js](https://github.com/huggingface/transformers.js) (`@huggingface/transformers`) | Apache-2.0 | Runs Whisper and other models in the browser. |
| [ONNX Runtime Web](https://github.com/microsoft/onnxruntime) (`onnxruntime-web`) | MIT | In-browser inference runtime. |

## Background removal

Runs on the user's computer (onnxruntime-web, WebGPU or wasm). Weights are
downloaded on first use from a URL pinned to a Hugging Face commit and checked
against their SHA-256; nothing is bundled. Design and the models considered:
`docs/background-removal.md`.

| Component | License | How Shreditor uses it |
|---|---|---|
| [MODNet](https://github.com/ZHKKKe/MODNet) (Zhanghan Ke et al.) | Apache-2.0 (code and pre-trained models) | Person matting for Remove background. ONNX conversion [Xenova/modnet](https://huggingface.co/Xenova/modnet) (`license: apache-2.0`), `onnx/model.onnx` at revision `fa2fa546052fba4c08921230a26cc69a333fca12`, sha256 `07c308cf0fc7e6e8b2065a12ed7fc07e1de8febb7dc7839d7b7f15dd66584df9`. |
| [BiRefNet](https://github.com/ZhengPeng7/BiRefNet) lite (Peng Zheng et al.) | MIT | Object segmentation for Remove background. ONNX conversion [onnx-community/BiRefNet_lite-ONNX](https://huggingface.co/onnx-community/BiRefNet_lite-ONNX) (`license: mit`) at revision `de15b22ba131738a16dff04aab8bdf8dc32e3ac1`: `onnx/model_fp16.onnx` (WebGPU, sha256 `d39b897ceb16ae654c1731f3dba0cf9b368d9cae74b5a57459b455cc8bfec402`) and `onnx/model.onnx` (wasm, sha256 `5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333`). |

## Media

| Component | License | How Shreditor uses it |
|---|---|---|
| [Mediabunny](https://github.com/Vanilagy/mediabunny) and `@mediabunny/prores` (also `@mediabunny/aac-encoder`, `mp3-encoder`, `ac3`) | MPL-2.0 | Reading, decoding and exporting media in the browser. Unmodified npm packages; source at the link. |
| [FFmpeg](https://ffmpeg.org/) | LGPL-2.1+ or GPL, depending on the build | Not bundled. The bridge and CLI run the user's installed `ffmpeg`/`ffprobe`; the license of that build applies. |

## Audio processing

| Component | License | How Shreditor uses it |
|---|---|---|
| [RNNoise](https://github.com/xiph/rnnoise) (Jean-Marc Valin, Xiph.Org, Mozilla) | BSD-3-Clause | Per-clip noise reduction (`audioDenoise`), compiled into the WebAssembly below. Runs in the preview AudioWorklet and in the export mix. |
| [@jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm) 0.2.1 | Apache-2.0 | The RNNoise WebAssembly build Shreditor loads (`dist/rnnoise-sync.js`, wasm inlined so it instantiates synchronously inside an AudioWorklet). Unmodified npm package; license in `node_modules/@jitsi/rnnoise-wasm/LICENSE`. |

The compressor, de-esser and limiter are Shreditor's own code (`src/infrastructure/audio/clip-dynamics/`).

## Other optional in-browser models

Loaded only when the matching feature is used. Licenses as tagged on each Hugging Face repository at the time of writing; check the model card before commercial use.

| Model | License tag |
|---|---|
| `LiquidAI/LFM2.5-VL-450M-ONNX` (AI captions) | other: LFM Open License v1.0 |
| `Xenova/all-MiniLM-L6-v2` (caption search) | Apache-2.0 |
| `Xenova/clip-vit-base-patch32`, `Xenova/clap-htsat-unfused` | none on the conversion repo; see the upstream model cards |
| `onnx-community/Kokoro-82M-v1.0-ONNX` | Apache-2.0 |
| `onnx-community/gemma-4-E4B-it-ONNX` | Apache-2.0 |

All other npm dependencies are listed in `package.json` with their licenses in `node_modules/*/package.json`.
