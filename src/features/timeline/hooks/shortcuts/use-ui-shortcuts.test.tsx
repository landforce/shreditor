import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { HOTKEYS } from '@/config/hotkeys'
import { useUIShortcuts } from './use-ui-shortcuts'

const { useHotkeysMock } = vi.hoisted(() => ({ useHotkeysMock: vi.fn() }))

vi.mock('react-hotkeys-hook', () => ({ useHotkeys: useHotkeysMock }))

function ShortcutHarness() {
  useUIShortcuts({})
  return null
}

type Options = { enableOnFormTags?: boolean; ignoreEventWhen?: (e: KeyboardEvent) => boolean }

function historyOptions(binding: string): Options {
  const registration = useHotkeysMock.mock.calls.find(([keys]) => keys === binding)
  expect(registration).toBeDefined()
  return registration![2] as Options
}

const keyOn = (target: HTMLElement) => ({ target }) as unknown as KeyboardEvent

describe('useUIShortcuts undo/redo', () => {
  it('leaves Cmd+Z to text fields but still undoes from sliders, buttons and panels', () => {
    render(<ShortcutHarness />)
    const make = (html: string) => {
      const host = document.createElement('div')
      host.innerHTML = html
      return host.firstElementChild as HTMLElement
    }
    for (const binding of [HOTKEYS.UNDO, HOTKEYS.REDO]) {
      const { enableOnFormTags, ignoreEventWhen } = historyOptions(binding)
      expect(enableOnFormTags).toBe(true)
      expect(ignoreEventWhen?.(keyOn(make('<input type="text">')))).toBe(true)
      expect(ignoreEventWhen?.(keyOn(make('<input type="search">')))).toBe(true)
      expect(ignoreEventWhen?.(keyOn(make('<textarea></textarea>')))).toBe(true)
      expect(ignoreEventWhen?.(keyOn(make('<input type="range">')))).toBe(false)
      expect(ignoreEventWhen?.(keyOn(make('<button>Undo</button>')))).toBe(false)
      expect(ignoreEventWhen?.(keyOn(make('<div tabindex="0"></div>')))).toBe(false)
    }
  })
})
