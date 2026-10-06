import test from 'node:test'
import assert from 'node:assert/strict'
import {
  capabilities,
  lifecycleEditRequestSchema,
  mediaProbeRequestSchema,
  projectCreateRequestSchema,
  projectSaveRequestSchema,
  projectUpdateRequestSchema,
} from './lib/contract.mjs'

test('lifecycle project requests are strict and revision guarded', () => {
  assert.equal(
    projectCreateRequestSchema.safeParse({ name: 'Demo', surprise: true }).success,
    false,
  )
  const project = {
    id: 'demo',
    name: 'Demo',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    schemaVersion: 14,
    metadata: { width: 1920, height: 1080, fps: 30 },
  }
  assert.equal(projectSaveRequestSchema.safeParse({ project, force: true }).success, true)
  assert.equal(projectSaveRequestSchema.safeParse({ project: {}, force: true }).success, false)
  assert.equal(
    projectSaveRequestSchema.safeParse({
      project: { ...project, rootFolderHandle: {} },
      force: true,
    }).success,
    false,
  )
  assert.equal(
    projectSaveRequestSchema.safeParse({ project: { ...project, surprise: true }, force: true })
      .success,
    false,
  )
  assert.equal(projectSaveRequestSchema.safeParse({ project: {} }).success, false)
  assert.equal(mediaProbeRequestSchema.safeParse({ persist: true }).success, false)
  assert.equal(mediaProbeRequestSchema.safeParse({ persist: true, force: true }).success, true)
})

test('projects carry an optional format: create, update and save', () => {
  const ok = (schema, value) => schema.safeParse(value).success
  assert.equal(ok(projectCreateRequestSchema, { name: 'A', format: { id: 'vlog' } }), true)
  assert.equal(
    ok(projectCreateRequestSchema, { name: 'A', format: { id: 'vlog', variant: 'slow' } }),
    true,
  )
  assert.equal(
    ok(projectCreateRequestSchema, { name: 'A', format: { id: 'vlog', variant: 'standard' } }),
    false,
  )
  assert.equal(ok(projectCreateRequestSchema, { name: 'A', format: { id: 'yap' } }), false)
  assert.equal(
    ok(projectCreateRequestSchema, { name: 'A', format: { id: 'vlog', extra: 1 } }),
    false,
  )
  assert.equal(
    ok(projectUpdateRequestSchema, {
      updates: { format: { id: 'ten-shot', variant: 'beat' } },
      force: true,
    }),
    true,
  )
  assert.equal(ok(projectUpdateRequestSchema, { updates: { format: null }, force: true }), true)
  const project = {
    id: 'demo',
    name: 'Demo',
    description: '',
    createdAt: 1,
    updatedAt: 1,
    duration: 0,
    metadata: { width: 1080, height: 1920, fps: 30 },
  }
  const stored = { id: 'greenscreen', reviewedHash: 'sha256:abc' }
  assert.equal(
    ok(projectSaveRequestSchema, { project, force: true }),
    true,
    'older projects have none',
  )
  assert.equal(
    ok(projectSaveRequestSchema, { project: { ...project, format: stored }, force: true }),
    true,
  )
  assert.equal(
    ok(projectSaveRequestSchema, { project: { ...project, format: { id: 'nope' } }, force: true }),
    false,
  )
})

test('lifecycle edits require unique caller ids and accept id references', () => {
  const valid = lifecycleEditRequestSchema.safeParse({
    ops: [
      { callerId: 'create', op: 'addText', text: 'hello', from: 0 },
      { callerId: 'move', op: 'moveItem', id: { $ref: 'create#/detail/created/0/id' }, from: 4 },
    ],
  })
  assert.equal(valid.success, true, JSON.stringify(valid.error?.issues))
  assert.equal(
    lifecycleEditRequestSchema.safeParse({
      ops: [
        { callerId: 'same', op: 'addText', text: 'a', from: 0 },
        { callerId: 'same', op: 'addText', text: 'b', from: 1 },
      ],
    }).success,
    false,
  )
  assert.equal(
    lifecycleEditRequestSchema.safeParse({
      ops: [{ callerId: 'bad', op: 'addText', text: 'a', from: 0, surprise: true }],
    }).success,
    false,
  )
  assert.equal(
    lifecycleEditRequestSchema.safeParse({
      ops: [
        {
          callerId: 'bad',
          op: 'addText',
          text: { $ref: 'later#/detail/id' },
          from: 0,
        },
        { callerId: 'later', op: 'addText', text: 'later', from: 1 },
      ],
    }).success,
    false,
  )
})

test('capabilities publish lifecycle constraints', () => {
  const result = capabilities()
  assert.equal(result.lifecycle.httpMediaUpload, false)
  assert.equal(result.lifecycle.deleteProject, false)
  assert.equal(result.lifecycle.writerMode, 'exclusive')
  assert.ok(result.lifecycle.routes.includes('POST /v1/projects/:id/edit'))
})
