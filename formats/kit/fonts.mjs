// Kit fonts: each `fonts.<name>` is an ordered stack of families. The first
// one that renders in Shreditor wins: installed on this machine (the editor
// and the renderer draw installed fonts by family name), or in Shreditor's
// font catalog (Google Fonts, loaded on demand). The kit's own `resolved` is
// what the creator's machine picked last time, so it is reported, not trusted.

const lower = (text) => String(text).trim().toLowerCase()

function familyStatus(family, available) {
  if (available.installed.has(lower(family))) return 'installed'
  if (available.catalog.has(lower(family))) return 'catalog'
  return 'missing'
}

/**
 * Resolve one font stack against what is available: `{ installed, catalog }`,
 * sets of lower-case family names. Returns the family to use (the stack's
 * first available one, else the kit's `resolved`, else the first in the
 * stack), where it comes from, and every family with its licence and status.
 */
function resolveFontStack(font, available) {
  const licences = new Map(
    (Array.isArray(font.families) ? font.families : []).map((entry) => [
      lower(entry.family),
      entry.license ?? entry.licence,
    ]),
  )
  const families = font.stack.map((family) => ({
    family,
    license: licences.get(lower(family)) ?? null,
    status: familyStatus(family, available),
  }))
  const usable = families.find((entry) => entry.status !== 'missing')
  return {
    family: usable?.family ?? font.resolved ?? font.stack[0],
    source: usable?.status ?? 'missing',
    kitResolved: font.resolved ?? null,
    families,
    weights: Array.isArray(font.weights) ? font.weights : [],
  }
}

/** Every font stack of the kit, resolved: { [name]: resolution }. */
export function resolveKitFonts(kit, available) {
  return Object.fromEntries(
    Object.entries(kit.fonts).map(([name, font]) => [name, resolveFontStack(font, available)]),
  )
}

const SOURCE_TEXT = {
  installed: 'installed on this machine',
  catalog: "from Shreditor's font catalog (Google Fonts)",
  missing: 'not available: text falls back to sans-serif',
}

/** One line per stack, then the families that are missing or carry a licence note. */
export function describeKitFonts(fonts) {
  return Object.entries(fonts).flatMap(([name, font]) => {
    const head = `${name}: ${font.family} (${SOURCE_TEXT[font.source]})${
      font.kitResolved && font.kitResolved !== font.family
        ? `; the kit last resolved ${font.kitResolved}`
        : ''
    }`
    const rest = font.families
      .filter((entry) => entry.status === 'missing' || entry.license)
      .map(
        (entry) =>
          `  ${entry.family}: ${entry.status}${entry.license ? `, licence: ${entry.license}` : ''}`,
      )
    return [head, ...rest]
  })
}
