import type { FormatId } from '@formats/registry.mjs'
import { cn } from '@/shared/ui/cn'

// Tiny 9:16 sketches of each format's layout, for the format cards and panel.

const TITLE = 'fill-foreground'
const CAPTION = 'fill-foreground/35'
const IMAGE = 'fill-primary/70'
const SPEAKER = 'fill-secondary-foreground/55'

function Speaker({ cx, cy, scale = 1 }: { cx: number; cy: number; scale?: number }) {
  return (
    <g className={SPEAKER}>
      <circle cx={cx} cy={cy} r={8 * scale} />
      <rect
        x={cx - 14 * scale}
        y={cy + 10 * scale}
        width={28 * scale}
        height={30}
        rx={12 * scale}
      />
    </g>
  )
}

function GraphicYap() {
  return (
    <>
      <rect x="8" y="8" width="38" height="6" rx="2" className={TITLE} />
      <rect x="7" y="20" width="24" height="20" rx="2" className={IMAGE} />
      <rect x="33" y="25" width="14" height="15" rx="2" className="fill-primary/45" />
      <Speaker cx={27} cy={58} />
      <rect x="13" y="84" width="28" height="3" rx="1.5" className={CAPTION} />
    </>
  )
}

function Greenscreen() {
  return (
    <>
      <rect x="0" y="0" width="54" height="96" className="fill-primary/20" />
      <rect x="7" y="20" width="40" height="30" rx="2" className="fill-card" />
      <rect x="11" y="25" width="26" height="3" rx="1.5" className="fill-primary/60" />
      <rect x="11" y="31" width="32" height="2.5" rx="1.25" className={CAPTION} />
      <rect x="11" y="36" width="22" height="2.5" rx="1.25" className={CAPTION} />
      <rect x="8" y="8" width="38" height="6" rx="2" className={TITLE} />
      <Speaker cx={31} cy={66} scale={1.1} />
    </>
  )
}

function Vlog() {
  return (
    <>
      <rect x="0" y="0" width="54" height="96" className="fill-secondary-foreground/15" />
      <path d="M0 70 L16 48 L27 60 L38 42 L54 64 L54 96 L0 96 Z" className="fill-primary/55" />
      <rect x="6" y="9" width="42" height="8" rx="2" className={TITLE} />
      <rect x="12" y="74" width="30" height="3" rx="1.5" className="fill-card" />
      <g className="fill-card">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <rect
            key={i}
            x={13 + i * 3.3}
            y={86 - (i % 3) * 1.5}
            width="1.6"
            height={3 + (i % 3) * 3}
            rx="0.8"
          />
        ))}
      </g>
    </>
  )
}

function TenShot() {
  const cells = [0, 1, 2, 3, 4, 5]
  return (
    <>
      <rect x="0" y="0" width="54" height="96" className="fill-primary/35" />
      <circle cx="40" cy="22" r="7" className="fill-card/70" />
      <rect x="9" y="42" width="36" height="8" rx="2" className={TITLE} />
      <g>
        {cells.map((i) => (
          <rect
            key={i}
            x={4 + i * 8}
            y="78"
            width="7"
            height="10"
            rx="1.5"
            className={i % 2 ? 'fill-card/80' : 'fill-card/55'}
          />
        ))}
      </g>
      <g className="fill-foreground/70">
        {cells.map((i) => (
          <circle key={i} cx={4 + i * 8} cy="91.5" r="0.9" />
        ))}
      </g>
    </>
  )
}

const CUES: Record<FormatId, () => React.ReactElement> = {
  'graphic-yap': GraphicYap,
  greenscreen: Greenscreen,
  vlog: Vlog,
  'ten-shot': TenShot,
}

/** A small 9:16 picture of how the format lays out the frame. */
export function FormatLayoutCue({ id, className }: { id: FormatId; className?: string }) {
  const Cue = CUES[id]
  return (
    <svg
      viewBox="0 0 54 96"
      aria-hidden="true"
      className={cn('shrink-0 overflow-hidden rounded-md', className)}
    >
      <defs>
        <clipPath id={`format-cue-${id}`}>
          <rect x="0" y="0" width="54" height="96" rx="6" />
        </clipPath>
      </defs>
      <g clipPath={`url(#format-cue-${id})`}>
        <rect x="0" y="0" width="54" height="96" className="fill-card" />
        <Cue />
      </g>
      <rect x="0.5" y="0.5" width="53" height="95" rx="5.5" className="fill-none stroke-border" />
    </svg>
  )
}
