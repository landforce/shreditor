import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { TextItem } from '@/types/timeline'
import type { CoordinateParams, Transform } from '../types/gizmo'
import { executeTimelineCommand, useTimelineStore } from '@/features/preview/deps/timeline-store'
import { buildTextItemLabelFromText } from '@/shared/utils/text-item-spans'
import { loadFont } from '@/shared/typography/font-loader'
import { resolveSpanStyles, resolveTextStyle } from '@/shared/typography/text-style'
import {
  getEffectiveScale,
  getScreenTransformOrigin,
  transformToScreenBounds,
} from '../utils/coordinate-transform'

let editSessions = 0

const FLEX_ALIGN = { left: 'flex-start', center: 'center', right: 'flex-end' } as const
const FLEX_VERTICAL = { top: 'flex-start', middle: 'center', bottom: 'flex-end' } as const

function isDarkColor(color: string): boolean {
  const match = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim())
  if (!match) return false
  const hex = match[1]!.length === 3 ? [...match[1]!].map((c) => c + c).join('') : match[1]!
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return (0.299 * r! + 0.587 * g! + 0.114 * b!) / 255 < 0.5
}

interface TextInlineEditorProps {
  item: TextItem
  transform: Transform
  coordParams: CoordinateParams
  /** Called once when editing ends, however it ends. */
  onExit: () => void
}

/**
 * Edits a text item in place over the preview. Every keystroke updates the
 * item through one coalesced undo entry. Escape restores the text from when
 * editing began; blur and Cmd/Ctrl+Enter keep the edit.
 */
export function TextInlineEditor({ item, transform, coordParams, onExit }: TextInlineEditorProps) {
  const updateItem = useTimelineStore((s) => s.updateItem)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const originalTextRef = useRef(item.text)
  const sessionKeyRef = useRef(`inline-text-edit-${item.id}-${++editSessions}`)
  const doneRef = useRef(false)
  const [value, setValue] = useState(item.text)

  const commit = useCallback(
    (text: string) => {
      executeTimelineCommand(
        'EDIT_TEXT',
        () =>
          updateItem(item.id, {
            text,
            textSpans: undefined,
            label: buildTextItemLabelFromText(text),
          }),
        { coalesce: sessionKeyRef.current },
      )
    },
    [item.id, updateItem],
  )

  const finish = useCallback(
    (restore: boolean) => {
      if (doneRef.current) return
      doneRef.current = true
      if (restore && originalTextRef.current !== value) commit(originalTextRef.current)
      onExit()
    },
    [commit, onExit, value],
  )

  const scale = getEffectiveScale(coordParams)
  const bounds = useMemo(
    () => transformToScreenBounds(transform, coordParams),
    [transform, coordParams],
  )
  const transformOrigin = useMemo(
    () => getScreenTransformOrigin(transform, coordParams),
    [transform, coordParams],
  )

  const style = resolveTextStyle(item)
  const span = resolveSpanStyles({ ...item, text: value, textSpans: undefined })[0]!
  const dark = isDarkColor(span.color)

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.select()
  }, [])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [value, scale, span.fontSize])

  return (
    <div
      data-testid="text-inline-editor"
      className="absolute"
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
        transform: `rotate(${transform.rotation}deg)`,
        transformOrigin,
        zIndex: 110,
        display: 'flex',
        alignItems: FLEX_VERTICAL[style.verticalAlign] ?? 'center',
        justifyContent: FLEX_ALIGN[style.textAlign] ?? 'center',
        boxSizing: 'border-box',
        padding: `${style.paddingY * scale}px ${style.paddingX * scale}px`,
        // Backing hides the rendered title beneath so the two never read as a double.
        backgroundColor: dark ? 'rgba(245, 245, 247, 0.92)' : 'rgba(10, 10, 14, 0.84)',
        outline: '2px solid hsl(var(--primary, 24 95% 53%))',
        outlineOffset: 1,
        pointerEvents: 'auto',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        aria-label="Edit text"
        value={value}
        rows={1}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value)
          commit(e.target.value)
        }}
        onBlur={() => finish(false)}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            finish(true)
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            finish(false)
          }
        }}
        style={{
          width: '100%',
          resize: 'none',
          overflow: 'hidden',
          border: 0,
          outline: 0,
          padding: 0,
          margin: 0,
          background: 'transparent',
          display: 'block',
          boxSizing: 'border-box',
          textAlign: style.textAlign,
          color: span.color,
          fontFamily: loadFont(span.fontFamily),
          fontSize: span.fontSize * scale,
          fontWeight: span.fontWeight,
          fontStyle: span.fontStyle,
          textDecoration: span.underline ? 'underline' : 'none',
          lineHeight: style.lineHeight,
          letterSpacing: span.letterSpacing * scale,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          caretColor: span.color,
        }}
      />
    </div>
  )
}
