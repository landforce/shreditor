import { describe, expect, it } from 'vite-plus/test'
import { changesSincePass } from './changes-since-pass'

const entry = (type: string, n = 0) => ({ command: { type }, n })

describe('changesSincePass', () => {
  it('returns every entry, newest first, when no pass has landed', () => {
    const stack = [entry('A', 1), entry('B', 2)]
    expect(changesSincePass(stack).map((e) => e.n)).toEqual([2, 1])
  })

  it('keeps only the entries after the last EXTERNAL_CHANGE', () => {
    const stack = [
      entry('A'),
      entry('EXTERNAL_CHANGE'),
      entry('B', 1),
      entry('EXTERNAL_CHANGE'),
      entry('C', 2),
      entry('D', 3),
    ]
    expect(changesSincePass(stack).map((e) => e.command.type)).toEqual(['D', 'C'])
  })

  it('is empty right after a pass', () => {
    expect(changesSincePass([entry('A'), entry('EXTERNAL_CHANGE')])).toEqual([])
    expect(changesSincePass([])).toEqual([])
  })

  it('caps the list at 8 by default', () => {
    const stack = Array.from({ length: 12 }, (_, i) => entry('A', i))
    const result = changesSincePass(stack)
    expect(result).toHaveLength(8)
    expect(result[0]!.n).toBe(11)
  })
})
