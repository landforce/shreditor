// Each project's editor link (/editor/<id>) carries the project's name and
// cover in its HTML, so link cards and previews that read the page without
// running the app (og:image and friends) show the video, not a blank shell.
import fs from 'node:fs'
import path from 'node:path'

const EDITOR_PATH = /^\/editor\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\/?$/

const escapeHtml = (text) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )

/** The project id an editor URL opens, or null. */
export function editorProjectId(pathname) {
  return EDITOR_PATH.exec(pathname)?.[1] ?? null
}

/** Name, size and cover of a project in the workspace, or null when it doesn't exist. */
export function readProjectCard(workspace, id) {
  try {
    const dir = path.join(workspace, 'projects', id)
    const project = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8'))
    const thumbnail = fs.statSync(path.join(dir, 'thumbnail.jpg'), { throwIfNoEntry: false })
    return {
      id,
      name: project.name || 'Untitled',
      width: project.metadata?.width,
      height: project.metadata?.height,
      format: project.format?.id ?? null,
      thumbnailVersion: thumbnail ? Math.round(thumbnail.mtimeMs) : null,
    }
  } catch {
    return null
  }
}

/** index.html with the project's title and cover (og/twitter tags); unchanged without a card. */
export function injectProjectMeta(html, card, origin) {
  if (!card) return html
  const title = `${card.name} · Shreditor`
  const size = card.width && card.height ? `${card.width}×${card.height}` : ''
  const description = [size, card.format, 'Shreditor'].filter(Boolean).join(' · ')
  const tags = [
    `<meta property="og:title" content="${escapeHtml(card.name)}" />`,
    `<meta property="og:description" content="${escapeHtml(description)}" />`,
    `<meta property="og:site_name" content="Shreditor" />`,
    `<meta name="description" content="${escapeHtml(description)}" />`,
  ]
  if (card.thumbnailVersion !== null) {
    const image = `${origin}/project-cover/${card.id}.jpg?v=${card.thumbnailVersion}`
    tags.push(
      `<meta property="og:image" content="${escapeHtml(image)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:image" content="${escapeHtml(image)}" />`,
      `<link rel="image_src" href="${escapeHtml(image)}" />`,
    )
  }
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
    .replace('</head>', `    ${tags.join('\n    ')}\n  </head>`)
}

/** The page origin a browser used (Host header), for absolute og:image URLs. */
export function requestOrigin(req) {
  const host = req.headers?.host ?? 'localhost'
  return `http://${host}`
}

const COVER_PATH = /^\/project-cover\/([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.jpg$/

/** GET /project-cover/<id>.jpg: the project's cover as an image (what og:image points at). */
export function createProjectCoverRoute(workspace) {
  return function projectCover(req, res, next) {
    const id =
      req.method === 'GET'
        ? COVER_PATH.exec(new URL(req.url ?? '/', 'http://x').pathname)?.[1]
        : null
    if (!id) return next()
    const file = path.join(workspace(), 'projects', id, 'thumbnail.jpg')
    const st = fs.statSync(file, { throwIfNoEntry: false })
    if (!st?.isFile()) return next()
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': st.size,
      'cache-control': 'no-cache',
      'cross-origin-resource-policy': 'cross-origin',
    })
    fs.createReadStream(file).pipe(res)
  }
}
