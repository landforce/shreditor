import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { FORMAT_IDS, FORMATS } from '@formats/registry.mjs'
import { loadFormatGuide } from './format-guides'
import { GuideMarkdown } from './guide-markdown'

describe('format guides', () => {
  it.each(FORMAT_IDS)('loads and renders the %s guide without its preamble', async (id) => {
    const markdown = await loadFormatGuide(id)
    expect(markdown).toContain('Vendored from the ai-video-editor plugin')

    const { container } = render(<GuideMarkdown markdown={markdown} />)

    const name = FORMATS.find((format) => format.id === id)!.name
    expect(
      screen.getByRole('heading', { level: 2, name: new RegExp(name.split(' ')[0]!) }),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0)
    expect(container.textContent).not.toContain('Vendored from')
    expect(container.textContent).not.toContain('description:')
    expect(container.textContent).not.toContain('**')
  })

  it('renders inline Markdown and keeps local links as text', () => {
    render(
      <GuideMarkdown
        markdown={
          'Cut **every** pause, see `edit.md` and [the research](references/x.md).\n\n- one\n- two'
        }
      />,
    )
    expect(screen.getByText('every').tagName).toBe('STRONG')
    expect(screen.getByText('edit.md').tagName).toBe('CODE')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
