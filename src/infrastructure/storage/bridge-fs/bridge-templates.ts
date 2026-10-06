/**
 * The bridge's change stamp for the motion template library
 * (server/template-bridge.mjs). Null when the workspace isn't bridge-served
 * (a browser-picked folder), where the library is re-read on demand instead.
 */
export async function readTemplateLibraryVersion(): Promise<string | null> {
  try {
    const res = await fetch('/__shreditor/templates/version', { cache: 'no-store' })
    if (!res.ok) return null
    const body = (await res.json()) as { version?: unknown }
    return typeof body.version === 'string' ? body.version : null
  } catch {
    return null
  }
}
