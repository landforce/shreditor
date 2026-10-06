export interface PreparedNativeMedia {
  url: string
  alpha: boolean
}

/** Only the local workspace bridge can prepare original workspace media. */
export async function requestNativeMedia(
  mediaId: string,
  force = false,
  signal?: AbortSignal,
): Promise<PreparedNativeMedia | null> {
  const response = await fetch('/__shreditor/media/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mediaId, force }),
    signal,
  })
  if (response.status === 404) return null // older bridge / non-local editor
  if (!response.ok)
    throw new Error(`Media preparation failed (${response.status}): ${await response.text()}`)
  const result = (await response.json()) as { prepared?: boolean; url?: string; alpha?: boolean }
  if (!result.prepared) return null
  if (!result.url?.startsWith('/__shreditor/fs/file?'))
    throw new Error('Invalid prepared media URL')
  return { url: result.url, alpha: result.alpha === true }
}

export async function prepareImportedVideo(file: File, mediaId: string): Promise<File | null> {
  if (!file.type.startsWith('video/')) return null
  const result = await requestNativeMedia(mediaId)
  if (!result) return null
  const response = await fetch(result.url)
  if (!response.ok) throw new Error('Could not read prepared media')
  return new File([await response.blob()], file.name, {
    type: result.alpha ? 'video/quicktime' : 'video/mp4',
    lastModified: file.lastModified,
  })
}
