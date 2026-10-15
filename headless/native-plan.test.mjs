// Unit tests for the native export planner (headless/lib/native-plan.mjs):
// which items ffmpeg renders, placement math, frame mapping, z-order and the
// audio mix it builds. No ffmpeg or browser needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  browserSourceFrames,
  buildFfmpegArgs,
  describePlan,
  frameRatio,
  planNativeExport,
  rateToRational,
  videoGeometry,
} from './lib/native-plan.mjs'

const videoProbe = (overrides = {}, audio = null) => ({
  streams: [
    {
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      width: 1080,
      height: 1920,
      pix_fmt: 'yuv420p',
      r_frame_rate: '30/1',
      avg_frame_rate: '30/1',
      start_time: '0.000000',
      nb_frames: '300',
      duration: '10.000000',
      color_space: 'bt709',
      color_transfer: 'bt709',
      color_primaries: 'bt709',
      color_range: 'tv',
      ...overrides,
    },
    ...(audio
      ? [
          {
            index: 1,
            codec_type: 'audio',
            codec_name: 'aac',
            sample_rate: '48000',
            channels: 2,
            start_time: '0.000000',
            ...audio,
          },
        ]
      : []),
  ],
  format: { start_time: '0.000000' },
})

const track = (id, order, extra = {}) => ({
  id,
  name: id,
  order,
  visible: true,
  muted: false,
  solo: false,
  items: [],
  ...extra,
})

const clip = (id, trackId, from, durationInFrames, extra = {}) => ({
  id,
  trackId,
  type: 'video',
  label: id,
  mediaId: 'm1',
  from,
  durationInFrames,
  sourceStart: 0,
  sourceFps: 30,
  sourceWidth: 1080,
  sourceHeight: 1920,
  ...extra,
})

function project({ tracks, items, transitions, keyframes, meta = {}, timeline = {} }) {
  return {
    id: 'p',
    name: 'Test',
    metadata: { width: 1080, height: 1920, fps: 30, ...meta },
    timeline: { tracks, items, transitions, keyframes, ...timeline },
  }
}

const media = (probes) =>
  Object.fromEntries(
    Object.entries(probes).map(([id, probe]) => [id, { original: `/orig/${id}.mov`, probe }]),
  )

const route = (plan, id) => plan.decisions.find((d) => d.id === id)
const secs = (x) => Number(x.toFixed(6)).toString()

test('rates and speeds become exact rationals', () => {
  assert.deepEqual(rateToRational(30), { num: 30, den: 1 })
  assert.deepEqual(rateToRational(29.97), { num: 30000, den: 1001 })
  assert.deepEqual(rateToRational('30000/1001'), { num: 30000, den: 1001 })
  assert.deepEqual(rateToRational(23.976), { num: 24000, den: 1001 })
  assert.equal(rateToRational(0), null)
})

test('a plain full-frame clip is native; text is drawn by the browser', () => {
  const plan = planNativeExport({
    project: project({
      tracks: [track('v2', -1), track('v1', 0)],
      items: [
        clip('a', 'v1', 0, 60, { sourceStart: 30 }),
        { id: 't', trackId: 'v2', type: 'text', text: 'Hi', from: 10, durationInFrames: 20, color: '#fff' },
      ],
    }),
    media: media({ m1: videoProbe() }),
  })
  assert.equal(plan.ok, true)
  assert.equal(route(plan, 'a').route, 'native')
  assert.equal(route(plan, 't').route, 'overlay')
  assert.equal(plan.totalFrames, 60)
  assert.deepEqual(
    plan.layers.map((l) => l.kind),
    ['native', 'overlay'],
  )
  assert.deepEqual(plan.layers[1].spans, [[10, 30]])
  assert.equal(plan.layers[0].firstSourceFrame, 30)
  assert.deepEqual(plan.layers[0].ratio, { num: 1, den: 1 })
})

test('anything not provably equivalent goes to the overlay, with the reason', () => {
  const items = [
    clip('fx', 'v1', 0, 30, { effects: [{ id: 'e', enabled: true }] }),
    clip('kf', 'v1', 30, 30, { originId: 'parent' }),
    clip('rot', 'v1', 60, 30, { transform: { rotation: 5 } }),
    clip('l', 'v1', 90, 30),
    clip('r', 'v1', 120, 30),
    clip('fade', 'v1', 150, 30, { fadeIn: 0.5 }),
    clip('soft', 'v1', 180, 30, { crop: { left: 0.1, softness: 0.2 } }),
  ]
  const plan = planNativeExport({
    project: project({
      tracks: [track('v1', 0)],
      items,
      transitions: [{ id: 'tr', leftClipId: 'l', rightClipId: 'r' }],
      // Split halves inherit keyframes from their origin clip.
      keyframes: [{ itemId: 'parent', properties: [{ property: 'x', keyframes: [{ frame: 0 }] }] }],
    }),
    media: media({ m1: videoProbe() }),
  })
  assert.match(route(plan, 'fx').reasons.join(), /effects/)
  assert.match(route(plan, 'kf').reasons.join(), /keyframes/)
  assert.match(route(plan, 'rot').reasons.join(), /rotation/)
  assert.match(route(plan, 'l').reasons.join(), /transition/)
  assert.match(route(plan, 'r').reasons.join(), /transition/)
  assert.match(route(plan, 'fade').reasons.join(), /video fade/)
  assert.match(route(plan, 'soft').reasons.join(), /soft crop/)
  for (const id of ['fx', 'kf', 'rot', 'l', 'r', 'fade', 'soft'])
    assert.equal(route(plan, id).route, 'overlay', id)
})

test('masks, adjustment layers and blend modes send every visual to the browser', () => {
  for (const extra of [
    { id: 'm', type: 'shape', shapeType: 'rectangle', isMask: true, fillColor: '#fff' },
    { id: 'm', type: 'adjustment', effects: [] },
    { id: 'm', type: 'text', text: 'x', color: '#fff', blendMode: 'multiply' },
  ]) {
    const plan = planNativeExport({
      project: project({
        tracks: [track('v2', -1), track('v1', 0)],
        items: [clip('a', 'v1', 0, 30), { ...extra, trackId: 'v2', from: 0, durationInFrames: 30 }],
      }),
      media: media({ m1: videoProbe() }),
    })
    assert.equal(route(plan, 'a').route, 'overlay', extra.type)
  }
})

test('HDR sources refuse native export instead of tone-mapping', () => {
  const plan = planNativeExport({
    project: project({ tracks: [track('v1', 0)], items: [clip('a', 'v1', 0, 30)] }),
    media: media({ m1: videoProbe({ color_transfer: 'arib-std-b67', color_primaries: 'bt2020' }) }),
  })
  assert.equal(plan.ok, false)
  assert.match(plan.refusals.join(), /HDR.*never tone-maps/)
  // An untagged transfer on a BT.2020 matrix is not assumed to be SDR.
  const untagged = planNativeExport({
    project: project({ tracks: [track('v1', 0)], items: [clip('a', 'v1', 0, 30)] }),
    media: media({ m1: videoProbe({ color_space: 'bt2020nc', color_transfer: 'unknown', color_primaries: 'unknown' }) }),
  })
  assert.equal(untagged.ok, false)
})

test('variable frame rate, rotation metadata and odd pixels stay in the browser', () => {
  const cases = {
    vfr: videoProbe({ avg_frame_rate: '2997/100' }),
    rotated: videoProbe({ side_data_list: [{ rotation: -90 }] }),
    anamorphic: videoProbe({ sample_aspect_ratio: '4:3' }),
    late: videoProbe({ start_time: '0.040000' }),
  }
  for (const [name, probe] of Object.entries(cases)) {
    const plan = planNativeExport({
      project: project({ tracks: [track('v1', 0)], items: [clip('a', 'v1', 0, 30)] }),
      media: media({ m1: probe }),
    })
    assert.equal(route(plan, 'a').route, 'overlay', name)
  }
  // A SAR a hair off 1:1 (an encoder quirk) is square.
  const quirk = planNativeExport({
    project: project({ tracks: [track('v1', 0)], items: [clip('a', 'v1', 0, 30)] }),
    media: media({ m1: videoProbe({ sample_aspect_ratio: '3133440:3133231' }) }),
  })
  assert.equal(route(quirk, 'a').route, 'native')
})

test('frame mapping mirrors the browser: same rate, 60 to 30, 24 to 30, speed', () => {
  const same = { durationInFrames: 5, sourceStart: 10, sourceFps: 30 }
  assert.deepEqual(browserSourceFrames(same, 30, { num: 30, den: 1 }, 300), [10, 11, 12, 13, 14])
  const sixty = { durationInFrames: 4, sourceStart: 6, sourceFps: 60 }
  const seq60 = browserSourceFrames(sixty, 30, { num: 60, den: 1 }, 300)
  assert.deepEqual(seq60, [6, 8, 10, 12])
  assert.deepEqual(frameRatio(seq60, sixty, 30, { num: 60, den: 1 }), { num: 2, den: 1, first: 6 })
  const film = { durationInFrames: 6, sourceStart: 0, sourceFps: 24 }
  const seq24 = browserSourceFrames(film, 30, { num: 24, den: 1 }, 300)
  assert.deepEqual(seq24, [0, 0, 1, 2, 3, 4])
  assert.deepEqual(frameRatio(seq24, film, 30, { num: 24, den: 1 }), { num: 4, den: 5, first: 0 })
  const fast = { durationInFrames: 4, sourceStart: 0, sourceFps: 30, speed: 1.5 }
  const seqFast = browserSourceFrames(fast, 30, { num: 30, den: 1 }, 300)
  assert.deepEqual(seqFast, [0, 1, 3, 4])
  assert.deepEqual(frameRatio(seqFast, fast, 30, { num: 30, den: 1 }), { num: 3, den: 2, first: 0 })
  // Metadata fps that disagrees with the stream puts the cut between frames: no constant ratio.
  const wrong = { durationInFrames: 30, sourceStart: 7, sourceFps: 25 }
  const seqWrong = browserSourceFrames(wrong, 30, { num: 24, den: 1 }, 300)
  assert.equal(frameRatio(seqWrong, wrong, 30, { num: 24, den: 1 }), null)
})

test('a clip that needs frames past the end of its source is not native', () => {
  const plan = planNativeExport({
    project: project({
      tracks: [track('v1', 0)],
      items: [clip('a', 'v1', 0, 30, { sourceStart: 290 })],
    }),
    media: media({ m1: videoProbe() }),
  })
  assert.match(route(plan, 'a').reasons.join(), /past the end/)
})

test('placement: transform offsets from centre, contain fit, crop, snapping', () => {
  const canvas = { width: 1080, height: 1920 }
  const pip = videoGeometry(
    { transform: { x: 270, y: -480, width: 432, height: 768 } },
    canvas,
    { width: 1080, height: 1920 },
  )
  assert.deepEqual(pip.snapped, { x: 594, y: 96, width: 432, height: 768 })
  assert.equal(pip.snapError, 0)
  // No transform: a landscape source is contain-fitted into the portrait canvas.
  const wide = videoGeometry({}, canvas, { width: 1920, height: 1080 })
  assert.deepEqual(wide.media, { x: 0, y: 656.25, width: 1080, height: 607.5 })
  assert.deepEqual(wide.snapped, { x: 0, y: 656, width: 1080, height: 608 })
  assert.equal(wide.snapError, 0.25)
  // A box with another aspect letterboxes the media inside it.
  const boxed = videoGeometry(
    { transform: { width: 1080, height: 1080 } },
    canvas,
    { width: 1080, height: 1920 },
  )
  assert.equal(boxed.snapped.width, 608)
  assert.equal(boxed.snapped.x, 236)
  // Crop cuts inside the drawn rect and the rest stays in place.
  const cropped = videoGeometry({ crop: { left: 0.25 } }, canvas, { width: 1080, height: 1920 })
  assert.deepEqual(cropped.visible, { x: 270, y: 0, width: 810, height: 1920 })
  // Off-canvas parts are clipped.
  const off = videoGeometry(
    { transform: { x: 540, y: 0, width: 1080, height: 1920 } },
    canvas,
    { width: 1080, height: 1920 },
  )
  assert.deepEqual(off.visible, { x: 540, y: 0, width: 540, height: 1920 })
})

test('z-order: lower track order paints on top; overlays group between native layers', () => {
  const tracks = [track('top', -2), track('mid', -1), track('base', 0)]
  const items = [
    clip('bg', 'base', 0, 60),
    { id: 't1', trackId: 'base', type: 'text', text: 'a', color: '#fff', from: 60, durationInFrames: 30 },
    { id: 't2', trackId: 'mid', type: 'text', text: 'b', color: '#fff', from: 0, durationInFrames: 30 },
    clip('pip', 'mid', 30, 30, { transform: { width: 540, height: 960 } }),
    { id: 't3', trackId: 'top', type: 'text', text: 'c', color: '#fff', from: 0, durationInFrames: 90 },
  ]
  const plan = planNativeExport({
    project: project({ tracks, items }),
    media: media({ m1: videoProbe() }),
  })
  assert.deepEqual(
    plan.layers.map((l) => (l.kind === 'native' ? l.itemId : l.itemIds.join('+'))),
    // base track: its overlay (t1) below its native clip (they never overlap in time);
    // mid: t2 opens a group above bg, then pip; top: t3 above everything.
    ['t1', 'bg', 't2', 'pip', 't3'],
  )
  const solo = planNativeExport({
    project: project({ tracks: tracks.map((t) => (t.id === 'mid' ? { ...t, solo: true } : t)), items }),
    media: media({ m1: videoProbe() }),
  })
  assert.equal(route(solo, 'bg').route, 'hidden')
  assert.equal(route(solo, 'pip').route, 'native')
})

test('ffmpeg graph: seek, frame mapping, placement, timing and output format', () => {
  const plan = planNativeExport({
    project: project({
      tracks: [track('v2', -1), track('v1', 0)],
      items: [
        clip('a', 'v1', 0, 45, { sourceStart: 30 }),
        clip('pip', 'v2', 15, 30, { transform: { x: 270, y: -480, width: 432, height: 768, opacity: 0.5 } }),
        { id: 't', trackId: 'v2', type: 'text', text: 'x', color: '#fff', from: 0, durationInFrames: 10 },
      ],
    }),
    media: media({ m1: videoProbe({ pix_fmt: 'yuvj420p', color_space: 'bt470bg', color_range: 'pc' }) }),
    options: { codec: 'h264', quality: 'high' },
  })
  const overlayId = plan.layers.find((l) => l.kind === 'overlay').id
  const args = buildFfmpegArgs(plan, {
    overlays: { [overlayId]: [{ start: 0, end: 10, pattern: '/tmp/o/%07d.png' }] },
    outPath: '/tmp/out.mp4',
  })
  const graph = args[args.indexOf('-filter_complex') + 1]
  assert.equal(args[args.indexOf('-ss') + 1], secs((30 - 0.5) / 30))
  assert.match(graph, /color=c=0x000000:s=1080x1920:r=30\/1/)
  assert.match(graph, /setpts='ceil\(N\*1\/1\)',fps=fps=30\/1,tpad=stop_mode=clone:stop=-1,trim=end_frame=45/)
  assert.match(graph, /in_color_matrix=bt601:in_range=full:out_color_matrix=bt709:out_range=limited/)
  assert.match(graph, /overlay=x=594:y=96:.*enable='between\(n,15,44\)'/)
  assert.match(graph, /lut=a='val\*0\.5'/)
  assert.match(graph, /setpts=N\+0,/)
  assert.ok(args.includes('-start_number'))
  // Overlay layers stack in plan order: the text track (v2) sits over the base clip.
  assert.ok(graph.indexOf('[v0]') < graph.indexOf('[o'))
  assert.match(graph, /format=yuv420p,setparams=color_primaries=bt709/)
  assert.deepEqual(args.slice(args.indexOf('-c:v'), args.indexOf('-c:v') + 2), ['-c:v', 'libx264'])
  assert.ok(args.includes('-an'))
})

test('10-bit sources keep 10 bits in HEVC and ProRes', () => {
  const p = project({ tracks: [track('v1', 0)], items: [clip('a', 'v1', 0, 30)] })
  const m = media({ m1: videoProbe({ pix_fmt: 'yuv422p10le', bits_per_raw_sample: '10', codec_name: 'prores' }) })
  assert.equal(planNativeExport({ project: p, media: m, options: { codec: 'hevc' } }).output.pixFmt, 'yuv420p10le')
  assert.equal(planNativeExport({ project: p, media: m, options: { codec: 'prores' } }).output.pixFmt, 'yuv422p10le')
  assert.equal(planNativeExport({ project: p, media: m, options: { codec: 'h264' } }).output.pixFmt, 'yuv420p')
  const eight = media({ m1: videoProbe() })
  assert.equal(planNativeExport({ project: p, media: eight, options: { codec: 'hevc' } }).output.pixFmt, 'yuv420p')
})

test('audio mix: dB gains, fades, placement, linked audio, mute and fallbacks', () => {
  const tracks = [
    track('v1', 0),
    track('a1', 1, { kind: 'audio', volume: -2 }),
    track('a2', 2, { kind: 'audio', muted: true }),
  ]
  const items = [
    clip('v', 'v1', 0, 60, { linkedGroupId: 'g', sourceStart: 30 }),
    { id: 'va', trackId: 'a1', type: 'audio', mediaId: 'm1', linkedGroupId: 'g', from: 0, durationInFrames: 60, sourceStart: 30, sourceFps: 30, volume: -4 },
    { id: 'music', trackId: 'a1', type: 'audio', mediaId: 'm2', from: 60, durationInFrames: 30, sourceStart: 0, volume: 3, audioFadeIn: 0.5, audioFadeOut: 0.25 },
    { id: 'muted', trackId: 'a2', type: 'audio', mediaId: 'm2', from: 0, durationInFrames: 30 },
  ]
  const probes = {
    m1: videoProbe({}, { channels: 2 }),
    m2: { streams: [{ index: 0, codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '44100', channels: 1, start_time: '0' }] },
  }
  const plan = planNativeExport({
    project: project({ tracks, items, timeline: { masterBusDb: -1 } }),
    media: media(probes),
  })
  assert.equal(plan.audio.route, 'native')
  // The video's own audio is not mixed: its linked companion carries it.
  assert.deepEqual(plan.audio.segments.map((s) => s.itemId), ['va', 'music'])
  const [va, music] = plan.audio.segments
  assert.equal(va.gainDb, -6)
  assert.equal(va.sourceStartSample, 48000)
  assert.equal(va.lengthSamples, 96000)
  assert.equal(music.startSample, 96000)
  assert.equal(music.sourceRate, 44100)
  assert.equal(music.fadeInSamples, 24000)
  assert.equal(music.fadeOutSamples, 12000)
  const args = buildFfmpegArgs(plan, { outPath: '/tmp/x.mp4' })
  const graph = args[args.indexOf('-filter_complex') + 1]
  assert.match(graph, /volume=-6dB/)
  assert.match(graph, /afade=t=in:ss=0:ns=24000:curve=tri/)
  assert.match(graph, /afade=t=out:ss=36000:ns=12000:curve=tri/)
  assert.match(graph, /pan=stereo\|c0=c0\|c1=c0/)
  assert.match(graph, /adelay=delays=96000S:all=1/)
  assert.match(graph, /amix=inputs=2:normalize=0/)
  assert.match(graph, /tanh\(val\(0\)\)/)
  assert.match(graph, /volume=-1dB/)
  assert.equal(args[args.indexOf('-ss', args.indexOf('-ss') + 1) + 1], secs((48000 - 0.5) / 48000))

  const fast = planNativeExport({
    project: project({ tracks, items: items.map((i) => (i.id === 'music' ? { ...i, speed: 2 } : i)) }),
    media: media(probes),
  })
  assert.equal(fast.audio.route, 'browser')
  assert.match(fast.audio.reasons.join(), /speed/)
  assert.match(describePlan(fast).at(-1), /browser mix/)

  // Clip dynamics are only in the browser mix: an enabled stage must route there.
  for (const field of ['audioDenoise', 'audioCompressor', 'audioDeEsser', 'audioLimiter']) {
    const processed = planNativeExport({
      project: project({
        tracks,
        items: items.map((i) => (i.id === 'music' ? { ...i, [field]: { enabled: true } } : i)),
      }),
      media: media(probes),
    })
    assert.equal(processed.audio.route, 'browser', field)
    assert.match(processed.audio.reasons.join(), /limiter/)
  }
  const disabled = planNativeExport({
    project: project({
      tracks,
      items: items.map((i) => (i.id === 'music' ? { ...i, audioLimiter: { enabled: false } } : i)),
    }),
    media: media(probes),
  })
  assert.equal(disabled.audio.route, 'native')
})

test('a speed-ramped clip and its audio go to the browser, named "speed ramp"', () => {
  const ramp = [
    { frame: 0, speed: 0.5, easing: 'ease-in' },
    { frame: 60, speed: 2 },
  ]
  const tracks = [track('v1', 0), track('a1', 1, { kind: 'audio' })]
  const items = [
    clip('v', 'v1', 0, 60, { linkedGroupId: 'g', sourceEnd: 75, speedRamp: ramp }),
    clip('plain', 'v1', 60, 30),
    { id: 'va', trackId: 'a1', type: 'audio', mediaId: 'm1', linkedGroupId: 'g', from: 0, durationInFrames: 60, sourceStart: 0, sourceEnd: 75, sourceFps: 30, speedRamp: ramp },
  ]
  const plan = planNativeExport({
    project: project({
      tracks,
      items,
      // The editor mirrors the ramp into a `speed` keyframe lane; it is not "keyframes".
      keyframes: [{ itemId: 'v', properties: [{ property: 'speed', keyframes: [{ frame: 0 }] }] }],
    }),
    media: media({ m1: videoProbe({}, { channels: 2 }) }),
  })
  assert.equal(route(plan, 'v').route, 'overlay')
  assert.match(route(plan, 'v').reasons.join(), /speed ramp/)
  assert.doesNotMatch(route(plan, 'v').reasons.join(), /keyframes/)
  assert.equal(route(plan, 'plain').route, 'native')
  assert.equal(plan.audio.route, 'browser')
  assert.match(plan.audio.reasons.join(), /speed ramp/)
})
