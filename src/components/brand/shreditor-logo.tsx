import { cn } from '@/shared/ui/cn'

interface ShreditorLogoProps {
  variant?: 'full' | 'icon'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizeConfig = {
  sm: {
    icon: 'w-5 h-5',
    text: 'text-base',
    gap: 'gap-1.5',
  },
  md: {
    icon: 'w-7 h-7',
    text: 'text-xl',
    gap: 'gap-2',
  },
  lg: {
    icon: 'w-10 h-10',
    text: 'text-3xl',
    gap: 'gap-3',
  },
}

// A frame cut into offset strips: the edit, shredded.
function ShredMark({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
    >
      <g fill="currentColor">
        <rect x="56" y="72" width="360" height="104" rx="28" />
        <rect x="120" y="204" width="360" height="104" rx="28" />
        <rect x="32" y="336" width="360" height="104" rx="28" />
      </g>
    </svg>
  )
}

export function ShreditorLogo({ variant = 'full', size = 'md', className }: ShreditorLogoProps) {
  const config = sizeConfig[size]

  if (variant === 'icon') {
    return <ShredMark className={cn(config.icon, 'text-primary', className)} />
  }

  return (
    <div className={cn('flex items-center', config.gap, className)}>
      <ShredMark className={cn(config.icon, 'text-primary')} />
      <span className={cn(config.text, 'font-semibold tracking-tight text-foreground')}>
        Shreditor
      </span>
    </div>
  )
}
