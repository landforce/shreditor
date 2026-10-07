import { useProjectStore } from '@/features/editor/deps/projects'
import { useTimelineStore } from '@/features/editor/deps/timeline-store'
import { DEFAULT_PROJECT_HEIGHT, DEFAULT_PROJECT_WIDTH } from '@/shared/projects/defaults'

export function useProjectFps(): number {
  return useTimelineStore((s) => s.fps) || 30
}

export function useProjectCanvas() {
  const width = useProjectStore((s) => s.currentProject?.metadata.width ?? DEFAULT_PROJECT_WIDTH)
  const height = useProjectStore((s) => s.currentProject?.metadata.height ?? DEFAULT_PROJECT_HEIGHT)
  const fps = useProjectFps()
  return { width, height, fps }
}

export function formatSeconds(frames: number, fps: number): string {
  return `${(frames / fps).toFixed(2)}s`
}

/** Scroll a block into view and focus its first control. */
export function focusWithin(element: HTMLElement | null): void {
  if (!element) return
  element.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  element.querySelector<HTMLElement>('textarea, input, button')?.focus({ preventScroll: true })
}
