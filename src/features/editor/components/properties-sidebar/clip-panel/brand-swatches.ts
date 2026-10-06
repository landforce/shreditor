import { useMemo } from 'react'
import { useProjectStore } from '@/features/editor/deps/projects'

/**
 * The project's brand colours (from its creator kit, when the kit turns them
 * on), as swatches for the text colour pickers. Undefined when there are none.
 */
export function useBrandSwatches(): string[] | undefined {
  const colors = useProjectStore((s) => s.currentProject?.kit?.brandColors)
  return useMemo(
    () => (colors && colors.length > 0 ? colors.map((color) => color.hex) : undefined),
    [colors],
  )
}
