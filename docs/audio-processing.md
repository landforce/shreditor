# Clip audio processing

Every video and audio clip can carry four optional processors next to its
volume, fades, pitch and EQ: noise reduction, a compressor, a de-esser and a
limiter. None of them is ever switched on automatically. The agent or the
user turns one on for a clip they judge needs it; a clip without the fields
renders exactly as before.

## Chain

```
source -> noise reduction -> EQ (6 bands, high/low-pass) -> compressor -> de-esser
       -> volume, fades, ducking -> limiter -> mix
```

- **Noise reduction** (`audioDenoise`): RNNoise, a small recurrent network
  trained on speech, on 10 ms frames of 480 samples at 48 kHz. Clips at other
  rates go through a streaming cubic resampler to 48 kHz and back on the wet
  path only. `amount` is the wet/dry mix; the dry signal is delayed by the wet
  path's latency (frame plus RNNoise's own 960-sample delay) so partial
  amounts do not comb-filter. With RNNoise removing a steady noise floor
  almost entirely, the floor drops by about `-20 * log10(1 - amount / 100)` dB:
  14 dB at 80 %, 20 dB at 90 % (the default), 50 dB or more at 100 %. Full
  strength can sound underwater on some voices; that is what the mix is for.
- **EQ**: the existing clip EQ. For mic pops and rumble use the
  *Plosive / rumble* preset, which only turns on the EQ high-pass at 90 Hz,
  18 dB/oct.
- **Compressor** (`audioCompressor`): feed-forward, stereo-linked peak
  compressor with a soft knee, a smooth decoupled peak detector (release-only
  hold, then attack smoothing) and make-up gain. Zero latency.
- **De-esser** (`audioDeEsser`): Linkwitz-Riley crossover at `frequencyHz`;
  only the band above it is turned down (6:1, 1 ms attack, 60 ms release,
  capped at `maxReductionDb`) while it exceeds the threshold. With no reduction
  the two bands sum to a flat response.
- **Limiter** (`audioLimiter`): 1.5 ms lookahead peak limiter. The gain each
  sample needs (ceiling / peak, with a half-sample estimate to catch most
  inter-sample peaks) goes through a sliding minimum over the lookahead, an
  exponential release and a moving average over the lookahead, so sample
  peaks never exceed the ceiling. It sits after volume and fades: raising a
  clip's volume into it limits instead of clipping.

All four are per clip. The master bus is unchanged.

## Preview and export run the same code

The processors live in `src/infrastructure/audio/clip-dynamics/` as plain
streaming classes. The chain is split into three stages because the EQ and
the clip gain sit between them (`ClipDynamicsStageProcessor`: `denoise`,
`dynamics` = compressor + de-esser, `limiter`).

- **Preview**: `preview-audio-graph.ts` has junction nodes around the EQ
  stages and after the clip gain. `preview-clip-dynamics.ts` inserts one
  `AudioWorkletNode` per enabled stage
  (`worklets/clip-dynamics-processor.worklet.ts`) and removes it when the
  stage is turned off. The preview's clip gain also contains the master bus
  and monitor volume, which export applies after the mix; the limiter scales
  its ceiling by that factor so it limits the same signal export does.
- **Export**: `canvas-audio.ts` runs the same stage processor over each
  decoded segment (`applyClipDynamicsStageOffline`), removing each stage's
  latency so the audio stays in sync with the picture.
- Segments with dynamics never take the packet-copy, windowed or smart-copy
  shortcuts, and native export (`headless/lib/native-plan.mjs`) routes their
  audio through the browser mix, so the fields are never silently dropped.

Preview latency: noise reduction adds 30 ms (1440 samples at 48 kHz), the
limiter 1.5 ms. Export has none.

### Measured parity

Headless Chrome, preview captured from the real preview graph in a realtime
context, export from the built harness to 16-bit WAV, both at 48 kHz, aligned
by cross-correlation (`base` has no processing):

| Clip | Preview vs export RMS | Residual | Result |
|---|---|---|---|
| Speech + white noise at -40 dBFS, no processing | 0.00 dB | -90 dB | floor -40.0 dB |
| Same, noise reduction 90 % (default) | 0.00 dB | -32 dB | floor -60.0 dB, speech -0.1 dB |
| Same, noise reduction 100 % | 0.00 dB | -31 dB | floor below -95 dB |
| Same source at 44.1 kHz, noise reduction 80 % | 0.07 dB | -25 dB | floor -55 / -56 dB |
| Speech peaking 0 dBFS, +6 dB volume, limiter -1 dBFS | 0.00 dB | -85 dB | true peak -0.9 dBTP |
| 1 kHz at -6 dBFS, compressor -18 dB, 4:1, knee 6 dB | 0.00 dB | -81 dB | 9.0 dB gain reduction (static curve: 9.0) |

Noise reduction residuals are higher because RNNoise sees different frame
boundaries in each run; the level matches. Without the limiter, a clip pushed
over 0 dBFS still differs (export soft-clips the mix, the preview does not);
the limiter is the fix.

## Fields

See `src/shared/utils/audio-dynamics.ts` (`AUDIO_DYNAMICS_FIELD_SPECS`) for
ranges and defaults, and `timelineItemSchema` in
`src/features/project-bundle/schemas/project-schema.ts`, which validates them
for the agent's `updateItem` and for project import.

## Licences

RNNoise is BSD-3-Clause; the WebAssembly build is `@jitsi/rnnoise-wasm`
(Apache-2.0). Both are listed in `THIRD_PARTY_NOTICES.md`. The RNNoise build is
~1.9 MB and loads lazily: inside the dynamics worklet module, which the
preview loads the first time a clip enables any of the four stages (the model
itself starts only for noise reduction), and as a separate chunk during export.
