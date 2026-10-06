/**
 * FileSystemDirectoryHandle / FileSystemFileHandle stand-ins backed by the
 * local workspace bridge (`server/workspace-bridge.mjs`), served from the
 * same origin under `/__shreditor/`.
 *
 * They implement the subset workspace-fs uses (see
 * `workspace-fs/__tests__/in-memory-handle.ts`), so storage code runs
 * unchanged while every byte goes through one local process that the agent
 * shares. Permissions are always granted: the bridge only listens on
 * loopback and only exposes the chosen workspace folder.
 */

const BASE = '/__shreditor'

type Kind = 'file' | 'directory'

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

function assertName(name: string): void {
  if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new TypeError(`Invalid entry name: ${name}`)
  }
}

async function call(
  method: string,
  route: string,
  path: string,
  init: RequestInit = {},
  extra = '',
) {
  const res = await fetch(`${BASE}/${route}?path=${encodeURIComponent(path)}${extra}`, {
    method,
    cache: 'no-store',
    ...init,
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { name?: string; message?: string }
    throw new DOMException(
      body.message ?? `${res.status} ${res.statusText}`,
      body.name ?? 'UnknownError',
    )
  }
  return res
}

async function stat(path: string): Promise<{ kind: Kind; size: number; mtimeMs: number } | null> {
  const body = (await (await call('GET', 'fs/stat', path)).json()) as {
    exists: boolean
    kind: Kind
    size: number
    mtimeMs: number
  }
  return body.exists ? body : null
}

abstract class BridgeHandle {
  abstract readonly kind: Kind
  constructor(
    readonly name: string,
    /** Path relative to the workspace root; '' is the root. */
    readonly path: string,
  ) {}

  async isSameEntry(other: FileSystemHandle): Promise<boolean> {
    return other instanceof BridgeHandle && other.kind === this.kind && other.path === this.path
  }

  async queryPermission(): Promise<PermissionState> {
    return 'granted'
  }

  async requestPermission(): Promise<PermissionState> {
    return 'granted'
  }
}

export class BridgeWritable {
  private parts: BlobPart[] = []
  private closed = false

  constructor(
    private readonly path: string,
    initial?: Blob,
  ) {
    if (initial) this.parts.push(initial)
  }

  async write(data: unknown): Promise<void> {
    if (this.closed) throw new DOMException('Stream is closed', 'InvalidStateError')
    if (
      data &&
      typeof data === 'object' &&
      'type' in data &&
      (data as { type: string }).type === 'write'
    ) {
      const params = data as unknown as { data: unknown; position?: number }
      if (params.position !== undefined && params.position !== null) {
        throw new DOMException(
          'Positioned writes are not supported by the workspace bridge',
          'NotSupportedError',
        )
      }
      return this.write(params.data)
    }
    if (
      typeof data === 'string' ||
      data instanceof Blob ||
      data instanceof ArrayBuffer ||
      ArrayBuffer.isView(data)
    ) {
      this.parts.push(data as BlobPart)
      return
    }
    throw new TypeError('Unsupported write() data')
  }

  async truncate(size: number): Promise<void> {
    const blob = new Blob(this.parts).slice(0, size)
    this.parts = [blob]
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await call('PUT', 'fs/file', this.path, { body: new Blob(this.parts) })
  }

  async abort(): Promise<void> {
    this.closed = true
    this.parts = []
  }

  getWriter(): never {
    throw new DOMException(
      'getWriter() is not supported by the workspace bridge',
      'NotSupportedError',
    )
  }
}

export class BridgeFileHandle extends BridgeHandle {
  readonly kind = 'file' as const

  async getFile(): Promise<File> {
    const res = await call('GET', 'fs/file', this.path)
    const blob = await res.blob()
    return new File([blob], this.name, {
      lastModified: Number(res.headers.get('x-mtime')) || Date.now(),
      type: guessType(this.name),
    })
  }

  async createWritable(
    options: { keepExistingData?: boolean } = {},
  ): Promise<FileSystemWritableFileStream> {
    const initial = options.keepExistingData ? await this.getFile() : undefined
    return new BridgeWritable(this.path, initial) as unknown as FileSystemWritableFileStream
  }

  /** `move(newName)`, `move(dir)` or `move(dir, newName)`, like Chromium's. */
  async move(target: BridgeDirectoryHandle | string, newName?: string): Promise<void> {
    const dir =
      typeof target === 'string' ? this.path.split('/').slice(0, -1).join('/') : target.path
    const name = typeof target === 'string' ? target : (newName ?? this.name)
    assertName(name)
    const to = join(dir, name)
    await call('POST', 'fs/move', '', { body: JSON.stringify({ from: this.path, to }) })
    ;(this as { name: string }).name = name
    ;(this as { path: string }).path = to
  }
}

export class BridgeDirectoryHandle extends BridgeHandle {
  readonly kind = 'directory' as const

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<BridgeDirectoryHandle> {
    assertName(name)
    const path = join(this.path, name)
    const existing = await stat(path)
    if (existing?.kind === 'file') throw new DOMException(`${name} is a file`, 'TypeMismatchError')
    if (!existing) {
      if (!options.create) throw new DOMException(`${path} not found`, 'NotFoundError')
      await call('POST', 'fs/mkdir', path)
    }
    return new BridgeDirectoryHandle(name, path)
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<BridgeFileHandle> {
    assertName(name)
    const path = join(this.path, name)
    const existing = await stat(path)
    if (existing?.kind === 'directory')
      throw new DOMException(`${name} is a folder`, 'TypeMismatchError')
    if (!existing) {
      if (!options.create) throw new DOMException(`${path} not found`, 'NotFoundError')
      await call('POST', 'fs/touch', path)
    }
    return new BridgeFileHandle(name, path)
  }

  async removeEntry(name: string, options: { recursive?: boolean } = {}): Promise<void> {
    assertName(name)
    await call(
      'DELETE',
      'fs/entry',
      join(this.path, name),
      {},
      options.recursive ? '&recursive=1' : '',
    )
  }

  async resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null> {
    if (!(possibleDescendant instanceof BridgeHandle)) return null
    const mine = this.path ? `${this.path}/` : ''
    if (possibleDescendant.path === this.path) return []
    if (!possibleDescendant.path.startsWith(mine)) return null
    return possibleDescendant.path.slice(mine.length).split('/')
  }

  private async list(): Promise<Array<{ name: string; kind: Kind }>> {
    return (await (await call('GET', 'fs/list', this.path)).json()) as Array<{
      name: string
      kind: Kind
    }>
  }

  async *values(): AsyncIterableIterator<BridgeFileHandle | BridgeDirectoryHandle> {
    for (const entry of await this.list()) {
      const path = join(this.path, entry.name)
      yield entry.kind === 'directory'
        ? new BridgeDirectoryHandle(entry.name, path)
        : new BridgeFileHandle(entry.name, path)
    }
  }

  async *keys(): AsyncIterableIterator<string> {
    for (const entry of await this.list()) yield entry.name
  }

  async *entries(): AsyncIterableIterator<[string, BridgeFileHandle | BridgeDirectoryHandle]> {
    for await (const handle of this.values()) yield [handle.name, handle]
  }

  [Symbol.asyncIterator]() {
    return this.entries()
  }
}

const TYPES: Record<string, string> = {
  json: 'application/json',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
}

function guessType(name: string): string {
  return TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? ''
}

export interface BridgeInfo {
  version: number
  root: string
  name: string
  recent: string[]
  platform: string
}

/** The bridge's workspace, or null when the app isn't served with a bridge. */
export async function connectWorkspaceBridge(): Promise<{
  info: BridgeInfo
  root: FileSystemDirectoryHandle
} | null> {
  try {
    const res = await fetch(`${BASE}/info`, { cache: 'no-store' })
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null
    const info = (await res.json()) as BridgeInfo
    return {
      info,
      root: new BridgeDirectoryHandle(info.name, '') as unknown as FileSystemDirectoryHandle,
    }
  } catch {
    return null
  }
}

export function isBridgeHandle(handle: unknown): boolean {
  return handle instanceof BridgeHandle
}

/** Switch workspace: a path, or `null` to open the macOS folder chooser. */
export async function setBridgeWorkspace(path: string | null): Promise<string | null> {
  const res = await fetch(path === null ? `${BASE}/workspace/choose` : `${BASE}/workspace`, {
    method: 'POST',
    body: path === null ? undefined : JSON.stringify({ path }),
  })
  if (res.status === 499) return null
  const body = (await res.json()) as { root?: string; message?: string }
  if (!res.ok) throw new Error(body.message ?? 'Could not change workspace')
  return body.root ?? null
}
