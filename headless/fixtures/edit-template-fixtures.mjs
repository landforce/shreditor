// Shared fixtures for the edit template tests (formats/edit-template/edit-template.test.ts
// and headless/edit-templates.test.mjs): a small finished Graphic Yap and its media.

export const video = (fileName, duration, category, extra = {}) => ({
  fileName,
  mimeType: 'video/mp4',
  duration,
  fps: 30,
  audioCodec: 'aac',
  category,
  ...extra,
})
export const png = (fileName, category = 'graphics') => ({
  fileName,
  mimeType: 'image/png',
  duration: 0,
  category,
})

export const yapTracks = [
  { id: 'track-title', name: 'Title', kind: 'video', formatRole: 'title', order: 0 },
  { id: 'track-captions', name: 'Captions', kind: 'video', formatRole: 'captions', order: 1 },
  { id: 'track-images', name: 'Images', kind: 'video', formatRole: 'images', order: 2 },
  { id: 'track-speaker', name: 'Speaker', kind: 'video', formatRole: 'speaker', order: 3 },
  {
    id: 'track-speaker-audio',
    name: 'Speaker audio',
    kind: 'audio',
    formatRole: 'speaker',
    order: 4,
  },
]

export const clip = (id, mediaId, trackId, from, length, sourceStart = 0, extra = {}) => ({
  id,
  type: 'video',
  mediaId,
  trackId,
  from,
  durationInFrames: length,
  sourceStart,
  sourceEnd: sourceStart + length,
  sourceFps: 30,
  label: id,
  ...extra,
})

/** A small finished Graphic Yap: three speaker clips, one image, a styled title, two captions. */
export function yapProject() {
  const items = [
    clip('c1', 'talk', 'track-speaker', 0, 90, 0, { linkedGroupId: 'g1' }),
    { ...clip('c1a', 'talk', 'track-speaker-audio', 0, 90), type: 'audio', linkedGroupId: 'g1' },
    clip('c2', 'talk', 'track-speaker', 90, 60, 120),
    clip('c3', 'talk', 'track-speaker', 150, 90, 200),
    {
      id: 'i1',
      type: 'image',
      mediaId: 'loaf',
      trackId: 'track-images',
      from: 100,
      durationInFrames: 40,
      label: 'loaf',
    },
    {
      id: 'tt',
      type: 'text',
      text: 'You store bread wrong',
      trackId: 'track-title',
      from: 0,
      durationInFrames: 105,
      textStyleId: 'style-hook',
      formatRole: 'title',
      label: 'Title',
      color: '#fff',
    },
    ...[0, 120].map((from, i) => ({
      id: `cap${i}`,
      type: 'text',
      text: 'words',
      trackId: 'track-captions',
      from,
      durationInFrames: 120,
      textRole: 'caption',
      textStyleId: 'style-caps',
      label: 'Caption',
      color: '#fff',
    })),
  ]
  return {
    id: 'p0',
    name: 'Bread rant',
    metadata: { width: 1080, height: 1920, fps: 30 },
    format: { id: 'graphic-yap', variant: 'standard' },
    timeline: {
      tracks: yapTracks,
      items,
      textStyles: [
        {
          id: 'style-hook',
          name: 'Hook',
          role: 'title',
          version: 2,
          variants: [{ aspect: '9:16', style: { fontSize: 120 } }],
        },
        {
          id: 'style-caps',
          name: 'Caps',
          role: 'caption',
          version: 1,
          variants: [{ aspect: '9:16', style: { fontSize: 60 } }],
        },
        {
          id: 'style-unused',
          name: 'Unused',
          role: 'label',
          version: 1,
          variants: [{ aspect: '9:16', style: {} }],
        },
      ],
    },
  }
}

export const yapMedia = {
  talk: video('talk.mov', 20, 'speaker'),
  loaf: png('loaf.png'),
}
