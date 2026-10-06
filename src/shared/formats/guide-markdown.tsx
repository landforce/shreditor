import { Fragment, type ReactNode } from 'react'

// A small Markdown renderer for the vendored format guides (formats/<id>/guide.md):
// headings, paragraphs, bullet and numbered lists, tables, block quotes, rules,
// and inline bold, italics, code and links. The vendoring comment and the
// skill front matter are dropped.

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'quote'; text: string }
  | { kind: 'rule' }

function stripPreamble(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^\s*---\n[\s\S]*?\n---\n/, '')
    .trim()
}

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())

const isTableDivider = (line: string) => /^\s*\|?\s*:?-{2,}/.test(line) && line.includes('|')
const LIST_ITEM = /^\s*(?:[-*]|(\d+)\.)\s+(.*)$/

function takeWhile(lines: string[], start: number, test: (line: string) => boolean): string[] {
  const taken: string[] = []
  for (let i = start; i < lines.length && test(lines[i]!); i += 1) taken.push(lines[i]!)
  return taken
}

function readList(lines: string[], start: number): { block: Block; used: number } {
  const ordered = Boolean(LIST_ITEM.exec(lines[start]!)?.[1])
  const items: string[] = []
  let i = start
  for (; i < lines.length && lines[i]!.trim(); i += 1) {
    const match = LIST_ITEM.exec(lines[i]!)
    if (match) items.push(match[2]!)
    else items[items.length - 1] += ` ${lines[i]!.trim()}`
  }
  return { block: { kind: 'list', ordered, items }, used: i - start }
}

function readBlock(lines: string[], i: number): { block: Block; used: number } {
  const line = lines[i]!
  const heading = /^(#{1,6})\s+(.*)$/.exec(line)
  if (heading)
    return { block: { kind: 'heading', level: heading[1]!.length, text: heading[2]! }, used: 1 }
  if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) return { block: { kind: 'rule' }, used: 1 }
  if (line.trim().startsWith('|')) {
    const rows = takeWhile(lines, i, (l) => l.trim().startsWith('|'))
    const body = rows.filter((row) => !isTableDivider(row)).map(cells)
    return { block: { kind: 'table', rows: body }, used: rows.length }
  }
  if (line.startsWith('>')) {
    const quote = takeWhile(lines, i, (l) => l.startsWith('>'))
    const text = quote.map((l) => l.replace(/^>\s?/, '')).join(' ')
    return { block: { kind: 'quote', text }, used: quote.length }
  }
  if (LIST_ITEM.test(line)) return readList(lines, i)
  const para = takeWhile(
    lines,
    i,
    (l) => Boolean(l.trim()) && !/^(#|\||>)/.test(l) && !LIST_ITEM.test(l),
  )
  return { block: { kind: 'paragraph', text: para.join(' ') }, used: Math.max(1, para.length) }
}

function parseGuideMarkdown(markdown: string): Block[] {
  const lines = stripPreamble(markdown).split('\n')
  const blocks: Block[] = []
  for (let i = 0; i < lines.length; ) {
    if (!lines[i]!.trim()) {
      i += 1
      continue
    }
    const { block, used } = readBlock(lines, i)
    blocks.push(block)
    i += used
  }
  return blocks
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g

function Inline({ text }: { text: string }) {
  const parts = text.split(INLINE)
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>{renderInline(part)}</Fragment>
      ))}
    </>
  )
}

const wrapped = (part: string, mark: string) =>
  part.length > mark.length * 2 && part.startsWith(mark) && part.endsWith(mark)

function renderLink(text: string, href: string): ReactNode {
  // Links to the plugin's own reference files don't resolve here: keep the text.
  if (!/^https?:\/\//.test(href)) return <span className="font-medium">{text}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-primary-text underline"
    >
      {text}
    </a>
  )
}

function renderInline(part: string): ReactNode {
  if (wrapped(part, '**')) {
    return <strong className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
  }
  if (wrapped(part, '`')) {
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
        {part.slice(1, -1)}
      </code>
    )
  }
  const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
  if (link) return renderLink(link[1]!, link[2]!)
  if (/^(\*[^*]+\*|_[^_]+_)$/.test(part)) return <em>{part.slice(1, -1)}</em>
  return part
}

const HEADING_CLASS: Record<number, string> = {
  1: 'font-display text-xl font-extrabold tracking-tight text-foreground',
  2: 'mt-2 text-base font-bold text-foreground',
  3: 'text-sm font-semibold text-foreground',
}

function GuideBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2'
      return (
        <Tag className={HEADING_CLASS[block.level] ?? HEADING_CLASS[3]}>
          <Inline text={block.text} />
        </Tag>
      )
    }
    case 'paragraph':
      return (
        <p>
          <Inline text={block.text} />
        </p>
      )
    case 'quote':
      return (
        <blockquote className="border-l-2 border-primary/50 pl-3 text-muted-foreground">
          <Inline text={block.text} />
        </blockquote>
      )
    case 'rule':
      return <hr className="border-border" />
    case 'list':
      return <GuideList ordered={block.ordered} items={block.items} />
    case 'table':
      return <GuideTable rows={block.rows} />
  }
}

function GuideList({ ordered, items }: { ordered: boolean; items: string[] }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={ordered ? 'list-decimal space-y-1.5 pl-5' : 'list-disc space-y-1.5 pl-5'}>
      {items.map((item, index) => (
        <li key={index}>
          <Inline text={item} />
        </li>
      ))}
    </Tag>
  )
}

function GuideTable({ rows }: { rows: string[][] }) {
  const [head, ...body] = rows
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-xs">
        {head && (
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              {head.map((cell, index) => (
                <th key={index} className="px-2.5 py-1.5 font-semibold text-foreground">
                  <Inline text={cell} />
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-0">
              {row.map((cell, index) => (
                <td key={index} className="px-2.5 py-1.5 align-top">
                  <Inline text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** A format guide rendered from its Markdown source. */
export function GuideMarkdown({ markdown }: { markdown: string }) {
  const blocks = parseGuideMarkdown(markdown)
  return (
    <div className="space-y-3 text-sm leading-relaxed text-secondary-foreground">
      {blocks.map((block, index) => (
        <GuideBlock key={index} block={block} />
      ))}
    </div>
  )
}
