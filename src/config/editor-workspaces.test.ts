import { describe, expect, it } from 'vite-plus/test'
import { isConciseWorkspace, normalizeEditorWorkspaceId } from './editor-workspaces'

describe('normalizeEditorWorkspaceId', () => {
  it('uses Motion as the workspace id and migrates former Animate and Compose ids', () => {
    expect(normalizeEditorWorkspaceId('motion')).toBe('motion')
    expect(normalizeEditorWorkspaceId('animate')).toBe('motion')
    expect(normalizeEditorWorkspaceId('compose')).toBe('motion')
  })

  it('recognizes concise, keeps edit and falls back to concise for unknown ids', () => {
    expect(normalizeEditorWorkspaceId('concise')).toBe('concise')
    expect(normalizeEditorWorkspaceId('edit')).toBe('edit')
    expect(normalizeEditorWorkspaceId(null)).toBe('concise')
    expect(normalizeEditorWorkspaceId('nope')).toBe('concise')
    expect(isConciseWorkspace('concise')).toBe(true)
    expect(isConciseWorkspace('edit')).toBe(false)
  })
})
