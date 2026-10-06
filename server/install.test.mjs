// shreditor install / update / self-starting shred: plists, prerequisite
// checks, the restart guard, update steps and start decisions.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { compareLockfiles, staleBuild, treeDirty, changedFiles } from './install/build-state.mjs'
import { checkRestartSafe, restartBlockers, updateSteps } from './install/guard.mjs'
import {
  THROTTLE_SECONDS,
  jobPlan,
  parsePrint,
  plistPort,
  plistXml,
  readPlist,
} from './install/launchd.mjs'
import { checkPrereqs, planFixes } from './install/prereqs.mjs'
import { createAutostart, startPlan } from './install/self-start.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `shreditor-${name}-`))

// ── plists ────────────────────────────────────────────────────────────────

const plan = jobPlan({
  repo: '/r/shreditor',
  nodePath: '/n/bin/node',
  home: '/h',
  prefix: 'app.shreditor.test',
  ports: { editor: 5631, service: 8731 },
  workspace: '/w/scratch',
  config: '/w/config.json',
})

test('jobs get labels, plist paths, ports, URLs and logs', () => {
  assert.equal(plan.editor.label, 'app.shreditor.test.editor')
  assert.equal(plan.service.label, 'app.shreditor.test.service')
  assert.equal(plan.editor.plistPath, '/h/Library/LaunchAgents/app.shreditor.test.editor.plist')
  assert.equal(plan.editor.url, 'http://localhost:5631')
  assert.equal(plan.service.url, 'http://127.0.0.1:8731')
  assert.equal(plan.editor.log, '/h/Library/Logs/Shreditor/editor.log')
  assert.equal(plan.service.plist.StandardErrorPath, '/h/Library/Logs/Shreditor/service.log')
  const custom = jobPlan({ repo: '/r', home: '/h', logDir: '/tmp/logs' })
  assert.equal(custom.editor.label, 'app.shreditor.editor')
  assert.equal(custom.service.port, 8787)
  assert.equal(custom.editor.log, '/tmp/logs/editor.log')
})

test('the editor runs the built preview and the service resolves its workspace at start', () => {
  assert.deepEqual(plan.editor.plist.ProgramArguments, [
    '/n/bin/node',
    '/r/shreditor/node_modules/.bin/vp',
    'preview',
    '--port',
    '5631',
    '--strictPort',
  ])
  assert.deepEqual(plan.service.plist.ProgramArguments, [
    '/n/bin/node',
    '/r/shreditor/server/install/run-service.mjs',
    '--port',
    '8731',
  ])
  assert.equal(plan.editor.plist.WorkingDirectory, '/r/shreditor')
  assert.equal(plistPort(plan.service.plist), 8731)
})

test('jobs stay up, throttled, with Homebrew on PATH and the workspace pinned only when asked', () => {
  for (const job of [plan.editor, plan.service]) {
    assert.equal(job.plist.RunAtLoad, true)
    assert.equal(job.plist.KeepAlive, true)
    assert.equal(job.plist.ThrottleInterval, THROTTLE_SECONDS)
    assert.ok(THROTTLE_SECONDS >= 10)
    const env = job.plist.EnvironmentVariables
    assert.deepEqual(env.PATH.split(':').slice(0, 3), [
      '/n/bin',
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ])
    assert.equal(env.SHREDITOR_WORKSPACE, '/w/scratch')
    assert.equal(env.SHREDITOR_CONFIG, '/w/config.json')
  }
  const free = jobPlan({ repo: '/r', home: '/h' })
  assert.equal(free.service.plist.EnvironmentVariables.SHREDITOR_WORKSPACE, undefined)
  assert.equal(free.service.plist.EnvironmentVariables.SHREDITOR_CONFIG, undefined)
})

test(
  'plist XML escapes values and reads back with plutil',
  { skip: process.platform !== 'darwin' },
  () => {
    const dir = tmp('plist')
    const file = path.join(dir, 'job.plist')
    fs.writeFileSync(file, plistXml({ ...plan.service.plist, Note: 'a < b & "c"' }))
    execFileSync('plutil', ['-lint', file])
    const back = readPlist(file)
    assert.deepEqual(back.ProgramArguments, plan.service.plist.ProgramArguments)
    assert.equal(back.KeepAlive, true)
    assert.equal(back.ThrottleInterval, THROTTLE_SECONDS)
    assert.equal(back.Note, 'a < b & "c"')
    assert.equal(readPlist(path.join(dir, 'missing.plist')), null)
  },
)

test('launchctl print is parsed for state, pid and last exit', () => {
  assert.deepEqual(
    parsePrint(
      'gui/501/x = {\n\tstate = running\n\tpid = 4242\n\tlast exit code = (never exited)\n}',
    ),
    { state: 'running', pid: 4242, lastExit: null },
  )
  assert.deepEqual(parsePrint('\tstate = not running\n\tlast exit code = 1\n'), {
    state: 'not running',
    pid: null,
    lastExit: '1',
  })
})

// ── prerequisites ─────────────────────────────────────────────────────────

const machine = (overrides = {}) => {
  const tools = {
    brew: '/opt/homebrew/bin/brew',
    ffmpeg: '/opt/homebrew/bin/ffmpeg',
    ffprobe: '/opt/homebrew/bin/ffprobe',
    'whisper-cli': '/opt/homebrew/bin/whisper-cli',
    ...overrides.tools,
  }
  return {
    nodeVersion: '22.11.0',
    chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    which: (command) => tools[command] ?? null,
    whisperCli: 'whisper-cli',
    model: { path: '/m/ggml-large-v3-turbo.bin', size: 1_624_555_275, isDefault: true },
    deps: null,
    depsLinkedTo: null,
    build: null,
    ...overrides,
  }
}
const failing = (checks) => checks.filter((c) => !c.ok).map((c) => c.id)

test('a ready machine needs nothing', () => {
  const checks = checkPrereqs(machine())
  assert.deepEqual(failing(checks), [])
  assert.deepEqual(planFixes(checks), { auto: [], manual: [] })
})

test('missing Homebrew formulas become one brew install', () => {
  const checks = checkPrereqs(machine({ tools: { ffprobe: null, 'whisper-cli': null } }))
  assert.deepEqual(failing(checks), ['ffmpeg', 'whisper'])
  assert.deepEqual(
    planFixes(checks).auto.map((f) => f.command),
    ['brew install ffmpeg whisper-cpp'],
  )
})

test('Chrome, Node and Homebrew are never installed, only explained', () => {
  const checks = checkPrereqs(
    machine({ nodeVersion: '20.18.0', chrome: null, tools: { brew: null, ffmpeg: null } }),
  )
  const { auto, manual } = planFixes(checks)
  assert.deepEqual(
    manual.map((c) => c.id),
    ['node', 'chrome', 'brew', 'ffmpeg'],
  )
  assert.match(manual.find((c) => c.id === 'chrome').manual, /google\.com\/chrome/)
  assert.match(manual.find((c) => c.id === 'brew').manual, /brew\.sh/)
  assert.deepEqual(auto, [])
  // Homebrew alone missing is not a blocker when nothing needs it.
  assert.deepEqual(planFixes(checkPrereqs(machine({ tools: { brew: null } }))).manual, [])
})

test('model, dependencies and build are fixed in order; a linked node_modules is not reinstalled', () => {
  const checks = checkPrereqs(
    machine({
      model: { path: '/m/ggml-large-v3-turbo.bin', size: 0, isDefault: true },
      deps: 'vite is 7.0.0, package-lock wants 7.1.0',
      build: 'no build yet',
    }),
  )
  assert.deepEqual(
    planFixes(checks).auto.map((f) => f.kind),
    ['model', 'npm-ci', 'build'],
  )
  const linked = checkPrereqs(
    machine({ deps: 'x is not installed', depsLinkedTo: '/other/node_modules' }),
  )
  assert.match(planFixes(linked).manual[0].manual, /link to \/other\/node_modules/)
  const custom = checkPrereqs(
    machine({ model: { path: '/custom.bin', size: 0, isDefault: false } }),
  )
  assert.deepEqual(
    planFixes(custom).manual.map((c) => c.id),
    ['model'],
  )
})

test('node_modules is compared with package-lock.json', () => {
  const lock = {
    packages: {
      '': {},
      'node_modules/a': { version: '1.0.0' },
      'node_modules/b': { version: '2.0.0', optional: true },
    },
  }
  assert.equal(
    compareLockfiles(lock, { packages: { 'node_modules/a': { version: '1.0.0' } } }),
    null,
  )
  assert.match(
    compareLockfiles(lock, { packages: { 'node_modules/a': { version: '0.9.0' } } }),
    /a is 0\.9\.0, package-lock wants 1\.0\.0/,
  )
  assert.match(compareLockfiles(lock, { packages: {} }), /a is not installed/)
  assert.match(compareLockfiles(lock, null), /missing/)
})

// ── update guard ──────────────────────────────────────────────────────────

/** A fake editor (info + editor-state per project) and service (/health) for fetchImpl. */
function fakeServers({ root, states = {}, inFlight = [0] }) {
  let healthCalls = 0
  return async (url) => {
    const u = new URL(url)
    const json = (body) => ({ ok: true, json: async () => body })
    if (u.pathname === '/__shreditor/info') return json({ root })
    if (u.pathname === '/__shreditor/editor-state')
      return json(
        states[u.searchParams.get('project')] ?? { open: false, dirty: false, conflict: false },
      )
    if (u.pathname === '/health')
      return json({ ok: true, inFlight: inFlight[Math.min(healthCalls++, inFlight.length - 1)] })
    throw new Error('refused')
  }
}

function workspaceWith(...ids) {
  const root = tmp('ws')
  for (const id of ids) {
    fs.mkdirSync(path.join(root, 'projects', id), { recursive: true })
    fs.writeFileSync(path.join(root, 'projects', id, 'project.json'), '{}')
  }
  return root
}

const urls = { editor: 'http://localhost:5631', service: 'http://127.0.0.1:8731' }

test('an open project with unsaved changes or a conflict blocks a restart', async () => {
  const root = workspaceWith('p1', 'p2', 'p3')
  const fetchImpl = fakeServers({
    root,
    states: { p1: { open: true, dirty: true }, p2: { open: true, conflict: true } },
  })
  const { blockers } = await checkRestartSafe(urls, { fetchImpl })
  assert.equal(blockers.length, 2)
  assert.match(blockers[0], /p1 has unsaved changes.*save it/)
  assert.match(blockers[1], /p2 shows a conflict/)
  assert.deepEqual((await checkRestartSafe(urls, { fetchImpl, force: true })).blockers, [])
})

test('a clean editor and an idle service are safe; nothing running is safe', async () => {
  const root = workspaceWith('p1')
  assert.deepEqual(
    (
      await checkRestartSafe(urls, {
        fetchImpl: fakeServers({ root, states: { p1: { open: true, dirty: false } } }),
      })
    ).blockers,
    [],
  )
  const down = async () => {
    throw new Error('refused')
  }
  const result = await checkRestartSafe(urls, { fetchImpl: down })
  assert.equal(result.editor.running, false)
  assert.deepEqual(result.blockers, [])
})

test('a busy service is waited for, and blocks when it stays busy', async () => {
  const root = workspaceWith()
  const settles = await checkRestartSafe(
    { service: urls.service },
    { fetchImpl: fakeServers({ root, inFlight: [2, 1, 0] }), idleTimeoutMs: 2000 },
  )
  assert.deepEqual(settles.blockers, [])
  const stays = await checkRestartSafe(
    { service: urls.service },
    { fetchImpl: fakeServers({ root, inFlight: [1] }), idleTimeoutMs: 1 },
  )
  assert.match(stays.blockers[0], /still working on 1 request/)
  assert.deepEqual(
    restartBlockers({ editor: { unsaved: [], unknown: true, url: urls.editor } }).length,
    1,
  )
})

test('update: lockfile change runs npm ci, nothing moved does nothing, a linked node_modules only warns', () => {
  assert.deepEqual(updateSteps({ from: 'a', to: 'a' }), {
    moved: false,
    npmCi: false,
    depsLinkedWarning: false,
    build: false,
    restart: false,
  })
  assert.deepEqual(updateSteps({ from: 'a', to: 'b', changed: ['src/x.ts'] }), {
    moved: true,
    npmCi: false,
    depsLinkedWarning: false,
    build: true,
    restart: true,
  })
  assert.equal(
    updateSteps({ from: 'a', to: 'b', changed: ['package-lock.json', 'package.json'] }).npmCi,
    true,
  )
  assert.equal(updateSteps({ from: 'a', to: 'a', depsMismatch: 'x is not installed' }).npmCi, true)
  const linked = updateSteps({
    from: 'a',
    to: 'b',
    changed: ['package-lock.json'],
    linkedDeps: '/other',
  })
  assert.equal(linked.npmCi, false)
  assert.equal(linked.depsLinkedWarning, true)
  assert.equal(updateSteps({ from: 'a', to: 'a', stale: 'no build yet' }).build, true)
})

test('update: a dirty tree is refused; changed files and build staleness come from git', () => {
  const repo = tmp('git')
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: repo,
      encoding: 'utf8',
    }).trim()
  git('init', '-q')
  fs.writeFileSync(path.join(repo, 'package-lock.json'), '{}')
  git('add', '.')
  git('commit', '-qm', 'one')
  const first = git('rev-parse', 'HEAD')
  assert.equal(treeDirty(repo), false)
  fs.writeFileSync(path.join(repo, 'package-lock.json'), '{"lockfileVersion":3}')
  fs.writeFileSync(path.join(repo, 'untracked.txt'), 'x')
  assert.equal(treeDirty(repo), true)
  git('commit', '-qam', 'two')
  assert.equal(treeDirty(repo), false)
  assert.deepEqual(changedFiles(repo, first, git('rev-parse', 'HEAD')), ['package-lock.json'])
  assert.equal(staleBuild(repo), 'no build yet')
  fs.mkdirSync(path.join(repo, 'dist'))
  fs.writeFileSync(path.join(repo, 'dist', 'index.html'), '')
  fs.writeFileSync(
    path.join(repo, 'dist', '.shreditor-build.json'),
    JSON.stringify({ sha: first.slice(0, 7), full: first }),
  )
  assert.match(staleBuild(repo), /^build is of /)
  fs.writeFileSync(
    path.join(repo, 'dist', '.shreditor-build.json'),
    JSON.stringify({ full: git('rev-parse', 'HEAD') }),
  )
  assert.equal(staleBuild(repo), null)
})

// ── self-start ────────────────────────────────────────────────────────────

test('start plan: none when up, launchd when its login item serves that port, else spawn', () => {
  const job = { installed: true, loaded: true, port: 8731 }
  assert.equal(startPlan({ up: true, job, port: 8731 }), 'none')
  assert.equal(startPlan({ up: false, job, port: '8731' }), 'kickstart')
  assert.equal(startPlan({ up: false, job: { ...job, loaded: false }, port: 8731 }), 'bootstrap')
  assert.equal(startPlan({ up: false, job: { ...job, port: 8787 }, port: 8731 }), 'spawn')
  assert.equal(startPlan({ up: false, job: { installed: false }, port: 8731 }), 'spawn')
  assert.equal(startPlan({ up: false, job, port: 8731, autostart: false }), 'refuse')
})

function autostartWith({ job, autostart = true }) {
  const calls = []
  let up = false
  const lines = []
  const target = (name) => ({
    name,
    port: 8731,
    up: async () => up,
    spawn: async () => (calls.push('spawn'), (up = true)),
    timeoutMs: 1000,
  })
  const a = createAutostart({
    targets: { service: target('the agent service'), editor: target('the editor') },
    autostart,
    prefix: 'app.shreditor.test',
    say: (line) => lines.push(line),
    launchd: {
      status: () => job,
      bootstrap: async () => (calls.push('bootstrap'), (up = true)),
      kickstart: () => (calls.push('kickstart'), (up = true)),
    },
  })
  return { a, calls, lines }
}

test('autostart spawns once without a login item and says so in one line', async () => {
  const { a, calls, lines } = autostartWith({ job: { installed: false } })
  await Promise.all([a.ensure('service'), a.ensure('service')])
  assert.deepEqual(calls, ['spawn'])
  assert.deepEqual(lines, ['started the agent service'])
})

test('autostart goes through launchd when the login item is installed', async () => {
  const loaded = autostartWith({
    job: { label: 'app.shreditor.test.service', installed: true, loaded: true, port: 8731 },
  })
  await loaded.a.ensure('service')
  assert.deepEqual(loaded.calls, ['kickstart'])
  assert.deepEqual(loaded.lines, ['started the agent service (login item)'])
  const unloaded = autostartWith({
    job: { installed: true, loaded: false, port: 8731, plistPath: '/p' },
  })
  await unloaded.a.ensure('service')
  assert.deepEqual(unloaded.calls, ['bootstrap'])
})

test('autostart off refuses, but shred up / start still start', async () => {
  const { a, calls } = autostartWith({ job: { installed: false }, autostart: false })
  await assert.rejects(a.ensure('editor'), /not running on port 8731 \(SHRED_AUTOSTART=0/)
  const explicit = autostartWith({ job: { installed: false }, autostart: false })
  await explicit.a.ensure('editor', { explicit: true })
  assert.deepEqual(explicit.calls, ['spawn'])
  assert.deepEqual(explicit.lines, [])
  assert.deepEqual(calls, [])
})

// Which shred commands try to start something: run them against closed ports
// with autostart off; the ones that need the service or the editor say so.
const SHRED = path.join(REPO, 'skills/shreditor-edit/scripts/shred.mjs')
function shred(args, workspace) {
  const r = spawnSync(process.execPath, [SHRED, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      SHRED_AUTOSTART: '0',
      SHRED_SERVICE: 'http://127.0.0.1:9',
      SHRED_EDITOR: 'http://localhost:9',
      SHRED_WORKSPACE: workspace,
      SHREDITOR_LABEL_PREFIX: 'app.shreditor.unit-test-none',
    },
  })
  const wants = /the agent service is not running/.test(r.stderr)
    ? 'service'
    : /the editor is not running/.test(r.stderr)
      ? 'editor'
      : 'nothing'
  return wants
}

test('shred commands start only what they need', () => {
  const ws = workspaceWith()
  const cases = {
    nothing: [
      ['format', 'list'],
      ['format', 'graphic-yap'],
      ['effects'],
      ['lut', 'list'],
      ['grade', 'list'],
      ['styles', 'list'],
      ['qc'],
      ['master'],
      ['transcript', 'm1'],
      ['status'],
    ],
    service: [
      ['new', '--name', 'x'],
      ['draft', 'p1'],
      ['format', 'set', 'p1', 'vlog'],
      ['frames', 'p1', '--at', '1'],
    ],
    editor: [
      ['sync', 'p1'],
      ['changes', 'p1'],
      ['project', 'p1'],
      ['check', 'p1'],
    ],
  }
  for (const [wants, list] of Object.entries(cases)) {
    for (const args of list) assert.equal(shred(args, ws), wants, `shred ${args.join(' ')}`)
  }
})

test('the service launcher finds only orphaned browsers it marked', async () => {
  const { orphansWith } = await import('./install/run-service.mjs')
  const ps = [
    '  101     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --shreditor-job=app.shreditor.service',
    '  102   500 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --shreditor-job=app.shreditor.service',
    '  103     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --shreditor-job=app.shreditor.test.service',
    '  104     1 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless',
  ].join('\n')
  assert.deepEqual(orphansWith(ps, '--shreditor-job=app.shreditor.service'), [101])
})
