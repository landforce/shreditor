/**
 * How a film tile's thumbnail fills its wide, short body (118x44): wide frames
 * cover it, but a portrait (9:16) frame is shown whole, since covering would
 * leave only a thin band across its middle.
 */
export function miniFilmTileThumbnailFit(width: number, height: number): 'cover' | 'contain' {
  return width > 0 && height > width ? 'contain' : 'cover'
}
