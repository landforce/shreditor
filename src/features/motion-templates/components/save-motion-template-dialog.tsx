import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Palette, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FORMAT_ROLES, type FormatRole } from '@formats/registry.mjs'
import {
  MOTION_TEMPLATE_CATEGORIES,
  type MotionTemplate,
  type MotionTemplateCategory,
  type MotionTemplateControlInput,
} from '@/shared/motion-templates/template-core.mjs'
import { getCompositionControlCandidates } from '@/shared/utils/composition-controls'
import { useMotionTemplateSaveStore } from '@/shared/state/motion-template-save'
import {
  findTemplateByName,
  getLiveComposition,
  saveCompositionAsTemplate,
} from '../services/motion-template-service'

const NO_ROLE = 'none'

interface ControlRow extends MotionTemplateControlInput {
  key: string
  label: string
  kind: 'text' | 'color'
  enabled: boolean
}

/** Every exposable text/colour field; the composition's published controls start on. */
function initialRows(compositionId: string): ControlRow[] {
  const composition = getLiveComposition(compositionId)
  if (!composition) return []
  const published = composition.compositionControls?.controls ?? []
  return getCompositionControlCandidates(composition.items).map((candidate) => {
    const control = published.find(
      (entry) =>
        entry.targetItemId === candidate.targetItemId && entry.property === candidate.property,
    )
    return {
      key: `${candidate.targetItemId}:${candidate.property}`,
      id: control?.id,
      name:
        control?.name ??
        (candidate.kind === 'text' ? candidate.targetLabel : `${candidate.targetLabel} colour`),
      label: `${candidate.targetLabel} · ${candidate.property}`,
      targetItemId: candidate.targetItemId,
      property: candidate.property,
      kind: candidate.kind,
      enabled: Boolean(control),
    }
  })
}

function ControlRowEditor({
  row,
  onChange,
}: {
  row: ControlRow
  onChange: (next: ControlRow) => void
}) {
  const Icon = row.kind === 'text' ? Type : Palette
  return (
    <div className="flex items-center gap-2 py-1">
      <Switch
        checked={row.enabled}
        onCheckedChange={(enabled) => onChange({ ...row, enabled })}
        aria-label={row.label}
      />
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <Input
          value={row.name}
          disabled={!row.enabled}
          onChange={(event) => onChange({ ...row, name: event.target.value })}
          className="h-7 text-xs"
          aria-label={row.label}
        />
        <div className="truncate px-1 pt-0.5 text-[10px] text-muted-foreground">{row.label}</div>
      </div>
    </div>
  )
}

function useExistingTemplate(name: string, open: boolean): MotionTemplate | null {
  const [existing, setExisting] = useState<MotionTemplate | null>(null)
  useEffect(() => {
    if (!open || !name.trim()) return setExisting(null)
    let cancelled = false
    void findTemplateByName(name)
      .then((template) => !cancelled && setExisting(template))
      .catch(() => !cancelled && setExisting(null))
    return () => {
      cancelled = true
    }
  }, [name, open])
  return existing
}

/** "Save as template": name, category, role and which fields stay editable per instance. */
export function SaveMotionTemplateDialog({ onSaved }: { onSaved: () => void }) {
  const { t } = useTranslation()
  const compositionId = useMotionTemplateSaveStore((state) => state.compositionId)
  const close = useMotionTemplateSaveStore((state) => state.close)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<MotionTemplateCategory>('lower-third')
  const [role, setRole] = useState<string>(NO_ROLE)
  const [rows, setRows] = useState<ControlRow[]>([])
  const [saving, setSaving] = useState(false)
  const existing = useExistingTemplate(name, compositionId !== null)

  useEffect(() => {
    if (!compositionId) return
    setName(getLiveComposition(compositionId)?.name ?? '')
    setRows(initialRows(compositionId))
  }, [compositionId])

  const controls = useMemo(() => rows.filter((row) => row.enabled), [rows])

  const save = async () => {
    if (!compositionId) return
    setSaving(true)
    try {
      const template = await saveCompositionAsTemplate({
        compositionId,
        name,
        category,
        role: role === NO_ROLE ? undefined : (role as FormatRole),
        controls: controls.map(({ id, name: controlName, targetItemId, property }) => ({
          id,
          name: controlName,
          targetItemId,
          property,
        })),
      })
      toast.success(t('motionTemplates.saved', { name: template.name, version: template.version }))
      close()
      onSaved()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={compositionId !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('motionTemplates.saveTitle')}</DialogTitle>
          <DialogDescription>{t('motionTemplates.saveDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="motion-template-name">{t('motionTemplates.name')}</Label>
            <Input
              id="motion-template-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={100}
            />
            {existing && (
              <p className="text-[11px] text-muted-foreground">
                {t('motionTemplates.newVersionHint', {
                  name: existing.name,
                  version: existing.version + 1,
                })}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>{t('motionTemplates.category')}</Label>
              <Select
                value={category}
                onValueChange={(value) => setCategory(value as MotionTemplateCategory)}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOTION_TEMPLATE_CATEGORIES.map((id) => (
                    <SelectItem key={id} value={id} className="text-xs">
                      {t(`motionTemplates.categories.${id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>{t('motionTemplates.role')}</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ROLE} className="text-xs">
                    {t('motionTemplates.noRole')}
                  </SelectItem>
                  {FORMAT_ROLES.map((id) => (
                    <SelectItem key={id} value={id} className="text-xs">
                      {id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t('motionTemplates.controls')}</Label>
            <p className="text-[11px] text-muted-foreground">{t('motionTemplates.controlsHint')}</p>
            <div className="max-h-56 overflow-y-auto">
              {rows.map((row) => (
                <ControlRowEditor
                  key={row.key}
                  row={row}
                  onChange={(next) =>
                    setRows((current) =>
                      current.map((entry) => (entry.key === row.key ? next : entry)),
                    )
                  }
                />
              ))}
              {rows.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  {t('motionTemplates.noCandidates')}
                </p>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={close} disabled={saving}>
            {t('motionTemplates.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving || !name.trim()}>
            {existing ? t('motionTemplates.saveNewVersion') : t('motionTemplates.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
