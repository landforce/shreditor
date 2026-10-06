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

## Media

| Component | License | How Shreditor uses it |
|---|---|---|
| [Mediabunny](https://github.com/Vanilagy/mediabunny) and `@mediabunny/prores` (also `@mediabunny/aac-encoder`, `mp3-encoder`, `ac3`) | MPL-2.0 | Reading, decoding and exporting media in the browser. Unmodified npm packages; source at the link. |
| [FFmpeg](https://ffmpeg.org/) | LGPL-2.1+ or GPL, depending on the build | Not bundled. The bridge and CLI run the user's installed `ffmpeg`/`ffprobe`; the license of that build applies. |

## Other optional in-browser models

Loaded only when the matching feature is used. Licenses as tagged on each Hugging Face repository at the time of writing; check the model card before commercial use.

| Model | License tag |
|---|---|
| `LiquidAI/LFM2.5-VL-450M-ONNX` (AI captions) | other: LFM Open License v1.0 |
| `Xenova/all-MiniLM-L6-v2` (caption search) | Apache-2.0 |
| `Xenova/clip-vit-base-patch32`, `Xenova/clap-htsat-unfused` | none on the conversion repo; see the upstream model cards |
| `Xenova/musicgen-small` | CC-BY-NC-4.0 (non-commercial) |
| `onnx-community/Kokoro-82M-v1.0-ONNX` | Apache-2.0 |
| `onnx-community/gemma-4-E4B-it-ONNX` | Apache-2.0 |

All other npm dependencies are listed in `package.json` with their licenses in `node_modules/*/package.json`.
