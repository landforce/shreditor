import { useState, useEffect, useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useForm, type UseFormSetValue } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Link } from '@tanstack/react-router'
import {
  createProjectFormSchema,
  type ProjectFormData,
  type ProjectTemplate,
  DEFAULT_PROJECT_VALUES,
  PROJECT_TEMPLATES,
} from '../utils/validation'
import { getProjectFpsOptions } from '../utils/project-fps'
import { ProjectTemplatePicker } from './project-template-picker'

/** A canvas set by something else (a format): shown instead of the size and fps pickers. */
export interface LockedCanvas {
  width: number
  height: number
  fps: number
  title: string
  summary: string
  cue?: ReactNode
}

interface ProjectFormBaseProps {
  onSubmit: (data: ProjectFormData) => Promise<void> | void
  onCancel?: () => void
  defaultValues?: Partial<ProjectFormData>
  isSubmitting?: boolean
  mode: 'create' | 'edit'
  surface: 'page' | 'inline'
  lockedCanvas?: LockedCanvas
  /** Shown next to a disabled submit button while something else must be chosen first. */
  blockedHint?: string
}

type ProjectFormProps = Omit<ProjectFormBaseProps, 'mode' | 'surface'>

export function InlineCreateProjectForm(props: ProjectFormProps) {
  return <ProjectFormBase {...props} mode="create" surface="inline" />
}

export function EditProjectForm(props: ProjectFormProps) {
  return <ProjectFormBase {...props} mode="edit" surface="inline" />
}

function ProjectFormBase({
  onSubmit,
  onCancel,
  defaultValues,
  isSubmitting = false,
  mode,
  surface,
  lockedCanvas,
  blockedHint,
}: ProjectFormBaseProps) {
  const { t } = useTranslation()
  const isEditing = mode === 'edit'
  const isInlineSurface = surface === 'inline'
  const resolvedDefaultValues = useMemo(
    () => ({
      ...DEFAULT_PROJECT_VALUES,
      ...defaultValues,
    }),
    [defaultValues],
  )
  const validationSchema = useMemo(() => createProjectFormSchema((key) => t(key)), [t])

  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
    watch,
    setValue,
    reset,
  } = useForm<ProjectFormData>({
    resolver: zodResolver(validationSchema),
    defaultValues: resolvedDefaultValues,
    mode: 'onChange',
  })

  const matchTemplateId = (width: number, height: number) =>
    PROJECT_TEMPLATES.find((t) => t.width === width && t.height === height)?.id ?? 'custom'

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>(() =>
    matchTemplateId(resolvedDefaultValues.width, resolvedDefaultValues.height),
  )

  useEffect(() => {
    reset(resolvedDefaultValues)
  }, [reset, resolvedDefaultValues])

  useEffect(() => {
    setSelectedTemplateId(
      matchTemplateId(resolvedDefaultValues.width, resolvedDefaultValues.height),
    )
  }, [resolvedDefaultValues.height, resolvedDefaultValues.width])

  const fps = watch('fps')
  const fpsOptions = useMemo(() => getProjectFpsOptions(fps), [fps])

  useLockedCanvasValues(lockedCanvas, setValue)
  const canvasLocked = lockedCanvas !== undefined

  const handleSelectTemplate = (template: ProjectTemplate) => {
    setSelectedTemplateId(template.id)
    setValue('width', template.width, { shouldValidate: true })
    setValue('height', template.height, { shouldValidate: true })
    setValue('fps', template.fps, { shouldValidate: true })
  }

  const handleCustomSelect = () => {
    setSelectedTemplateId('custom')
  }

  return (
    <div className="bg-background">
      {/* Header */}
      {!isInlineSurface && (
        <div className="panel-header border-b border-border">
          <div className="max-w-[1400px] mx-auto px-6 py-5">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground mb-1">
              {isEditing ? t('projects.form.editTitle') : t('projects.form.createTitle')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {isEditing ? t('projects.form.editSubtitle') : t('projects.form.createSubtitle')}
            </p>
          </div>
        </div>
      )}

      {/* Form */}
      <div className={isInlineSurface ? '' : 'max-w-[1400px] mx-auto px-6 py-8'}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,420px)_1fr] gap-6 items-start">
            {/* Project Details */}
            <div
              className={`panel-bg border border-border rounded-lg p-6 ${isInlineSurface ? '' : 'lg:sticky lg:top-6'}`}
            >
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-1 bg-primary rounded-full" />
                <h2 className="text-lg font-medium text-foreground">
                  {t('projects.form.projectDetails')}
                </h2>
              </div>

              <div className="space-y-5">
                {/* Project Name */}
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-foreground mb-2">
                    {t('projects.form.projectName')} <span className="text-destructive">*</span>
                  </label>
                  <input
                    id="name"
                    type="text"
                    {...register('name')}
                    className="w-full px-3 py-2 bg-secondary border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-[color,border-color,box-shadow] duration-150"
                    placeholder={t('projects.form.projectNamePlaceholder')}
                  />
                  {errors.name && (
                    <p className="mt-1.5 text-sm text-destructive">{errors.name.message}</p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label
                    htmlFor="description"
                    className="block text-sm font-medium text-foreground mb-2"
                  >
                    {t('projects.form.description')}
                  </label>
                  <textarea
                    id="description"
                    rows={4}
                    {...register('description')}
                    className="w-full px-3 py-2 bg-secondary border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-[color,border-color,box-shadow] duration-150 resize-none"
                    placeholder={t('projects.form.descriptionPlaceholder')}
                  />
                  {errors.description && (
                    <p className="mt-1.5 text-sm text-destructive">{errors.description.message}</p>
                  )}
                </div>

                {/* Frame Rate */}
                <div hidden={canvasLocked}>
                  <label htmlFor="fps" className="block text-sm font-medium text-foreground mb-2">
                    {t('projects.form.frameRate')}
                  </label>
                  <Select
                    value={fps.toString()}
                    onValueChange={(value) =>
                      setValue('fps', Number(value), { shouldValidate: true })
                    }
                  >
                    <SelectTrigger id="fps">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {fpsOptions.map((preset) => (
                        <SelectItem key={preset.value} value={preset.value.toString()}>
                          {preset.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.fps && (
                    <p className="mt-1.5 text-sm text-destructive">{errors.fps.message}</p>
                  )}
                </div>
              </div>
            </div>

            {lockedCanvas && <LockedCanvasPanel canvas={lockedCanvas} />}

            {/* Video Settings */}
            <div className="panel-bg border border-border rounded-lg p-6" hidden={canvasLocked}>
              <div className="flex items-center gap-3 mb-6">
                <div className="h-8 w-1 bg-primary rounded-full" />
                <h2 className="text-lg font-medium text-foreground">
                  {t('projects.form.resolution')}
                </h2>
              </div>

              <ProjectTemplatePicker
                selectedTemplateId={selectedTemplateId}
                onSelectTemplate={handleSelectTemplate}
                onSelectCustom={handleCustomSelect}
              />
              {selectedTemplateId === 'custom' && (
                <div className="mt-5 flex items-center gap-3">
                  <div className="flex-1">
                    <label
                      htmlFor="width"
                      className="block text-xs font-medium text-muted-foreground mb-1"
                    >
                      {t('projects.form.widthPx')}
                    </label>
                    <input
                      id="width"
                      type="number"
                      {...register('width', { valueAsNumber: true })}
                      className="w-full px-3 py-2 bg-secondary border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-[color,border-color,box-shadow] duration-150"
                      placeholder="1920"
                      min={320}
                    />
                    {errors.width && (
                      <p className="mt-1 text-xs text-destructive">{errors.width.message}</p>
                    )}
                  </div>
                  <span className="text-muted-foreground mt-4">×</span>
                  <div className="flex-1">
                    <label
                      htmlFor="height"
                      className="block text-xs font-medium text-muted-foreground mb-1"
                    >
                      {t('projects.form.heightPx')}
                    </label>
                    <input
                      id="height"
                      type="number"
                      {...register('height', { valueAsNumber: true })}
                      className="w-full px-3 py-2 bg-secondary border border-input rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-[color,border-color,box-shadow] duration-150"
                      placeholder="1080"
                      min={240}
                    />
                    {errors.height && (
                      <p className="mt-1 text-xs text-destructive">{errors.height.message}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          <Separator />

          <FormActions
            isEditing={isEditing}
            isSubmitting={isSubmitting}
            canSubmit={isValid && !blockedHint}
            blockedHint={blockedHint}
            onCancel={onCancel}
          />
        </form>
      </div>
    </div>
  )
}

function LockedCanvasPanel({ canvas }: { canvas: LockedCanvas }) {
  return (
    <div className="panel-bg flex items-center gap-5 rounded-lg border border-border p-6">
      {canvas.cue}
      <div className="space-y-1">
        <h2 className="text-lg font-medium text-foreground">{canvas.title}</h2>
        <p className="font-mono text-sm text-muted-foreground">{canvas.summary}</p>
      </div>
    </div>
  )
}

/** Keep the form's canvas fields on the locked canvas (they're hidden meanwhile). */
function useLockedCanvasValues(
  lockedCanvas: LockedCanvas | undefined,
  setValue: UseFormSetValue<ProjectFormData>,
) {
  useEffect(() => {
    if (!lockedCanvas) return
    setValue('width', lockedCanvas.width, { shouldValidate: true })
    setValue('height', lockedCanvas.height, { shouldValidate: true })
    setValue('fps', lockedCanvas.fps, { shouldValidate: true })
  }, [lockedCanvas, setValue])
}

function FormActions({
  isEditing,
  isSubmitting,
  canSubmit,
  blockedHint,
  onCancel,
}: {
  isEditing: boolean
  isSubmitting: boolean
  canSubmit: boolean
  blockedHint?: string
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const submitLabel = isSubmitting
    ? t('common.saving')
    : isEditing
      ? t('projects.form.updateProject')
      : t('projects.form.createProject')
  const cancel = (
    <Button type="button" variant="outline" size="lg" disabled={isSubmitting} onClick={onCancel}>
      {t('common.cancel')}
    </Button>
  )
  return (
    <div className="flex items-center gap-3 justify-end">
      {blockedHint && <p className="mr-auto text-sm text-muted-foreground">{blockedHint}</p>}
      {onCancel ? cancel : <Link to="/projects">{cancel}</Link>}
      <Button
        type="submit"
        size="lg"
        className="min-w-[160px]"
        disabled={!canSubmit || isSubmitting}
      >
        {submitLabel}
      </Button>
    </div>
  )
}
