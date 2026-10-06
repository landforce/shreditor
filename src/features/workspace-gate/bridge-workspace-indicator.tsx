/**
 * Workspace switcher when the app is served with the local workspace bridge.
 * Folders are chosen on the machine (a Finder dialog opened by the bridge),
 * and the bridge remembers recent ones. Switching reloads the page.
 */

import { useState } from 'react'
import { Check, ChevronDown, FolderOpen, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/shared/ui/cn'
import { createLogger } from '@/shared/logging/logger'
import {
  setBridgeWorkspace,
  type BridgeInfo,
} from '@/infrastructure/storage/bridge-fs/bridge-handles'

const logger = createLogger('BridgeWorkspaceIndicator')
const folderName = (p: string) => p.split('/').filter(Boolean).pop() ?? p
const tilde = (p: string) => p.replace(/^\/Users\/[^/]+/, '~')

export function BridgeWorkspaceIndicator({ info }: { info: BridgeInfo }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const go = async (path: string | null) => {
    setError(null)
    try {
      const root = await setBridgeWorkspace(path)
      if (root) window.location.reload()
    } catch (e) {
      logger.error('Workspace switch failed', e)
      setError(e instanceof Error ? e.message : 'Could not open that folder')
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="lg"
          className="gap-2 px-4 max-w-[240px]"
          data-tooltip={tilde(info.root)}
          data-tooltip-side="bottom"
          aria-haspopup="menu"
          aria-expanded={open}
        >
          <FolderOpen className="w-4 h-4 shrink-0" />
          <span className="truncate">{info.name}</span>
          <ChevronDown
            className={cn(
              'w-4 h-4 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-2" align="end">
        <div className="text-xs font-medium text-muted-foreground px-2 py-1">Workspace folders</div>
        <div className="flex flex-col">
          {info.recent.map((path) => {
            const active = path === info.root
            return (
              <button
                key={path}
                type="button"
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent text-left"
                onClick={() => (active ? setOpen(false) : void go(path))}
              >
                <FolderOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-sm">{folderName(path)}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {tilde(path)}
                  </span>
                </span>
                {active && (
                  <Check className="w-4 h-4 shrink-0 text-muted-foreground" aria-label="Active" />
                )}
              </button>
            )
          })}
        </div>
        <div className="h-px bg-border my-1" />
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => void go(null)}
        >
          <Plus className="w-4 h-4" />
          {info.platform === 'darwin'
            ? 'Choose another folder…'
            : 'Run `shreditor open <folder>` to switch'}
        </Button>
        {error && <p className="px-2 py-1 text-xs text-destructive">{error}</p>}
      </PopoverContent>
    </Popover>
  )
}
