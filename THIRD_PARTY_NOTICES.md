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
| [U-2-Net](https://github.com/xuebinqin/U-2-Net) (Xuebin Qin et al.) | Apache-2.0 (repository licence; the upstream README does not state a separate licence for the weights) | Object segmentation for Remove background. ONNX conversion [BritishWerewolf/U-2-Net](https://huggingface.co/BritishWerewolf/U-2-Net) (`license: apache-2.0`), `onnx/model.onnx` at revision `c08042b462485d8597c89d3ce831d00be8582c5c`, sha256 `8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491`. |
| [SlimSAM](https://github.com/czg1225/SlimSAM) (Zigeng Chen et al.), a pruned [Segment Anything](https://github.com/facebookresearch/segment-anything) (Meta) | Apache-2.0 (SlimSAM repository licence; weights `Zigeng/SlimSAM-uniform-77` and `nielsr/slimsam-77-uniform` tagged `license: apache-2.0`; Segment Anything's model is Apache-2.0) | The smart brush of Remove background. ONNX conversion [Xenova/slimsam-77-uniform](https://huggingface.co/Xenova/slimsam-77-uniform) (`license: apache-2.0`) at revision `5850ab45f587c112167512ffef949107115e26a0`: `onnx/vision_encoder.onnx` sha256 `9f8433273a6750b587779baa0cf5508111001bf7e7acfcf585d370139fd366d0`, `onnx/vision_encoder_quantized.onnx` sha256 `cce23c7b2e5d4f330932738fb67ba518e04b0d99ccdd1cccd22a7da4e01f2971`, `onnx/prompt_encoder_mask_decoder_quantized.onnx` sha256 `cb90b279f549d2cab7fd6e20c38522438c65d84bdcca3d2a764cff7d857fdce2`. |

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
