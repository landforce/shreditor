// Test helper: serve the workspace bridge for a scratch workspace on a free
// loopback port, for the length of one node:test test.
import http from 'node:http'
import { createWorkspaceBridge } from './workspace-bridge.mjs'

/** Serve the workspace bridge for `root`; resolves to its http://127.0.0.1:<port> origin. */
export async function startBridge(t, root) {
  const previous = process.env.SHREDITOR_WORKSPACE
  process.env.SHREDITOR_WORKSPACE = root
  const server = http.createServer(createWorkspaceBridge())
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => {
    server.close()
    if (previous === undefined) delete process.env.SHREDITOR_WORKSPACE
    else process.env.SHREDITOR_WORKSPACE = previous
  })
  return `http://127.0.0.1:${server.address().port}`
}
