// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@renderer/platform/api', async () => {
  const { createFakePlatform, registerFakePlatform } = await import('../helpers/fakePlatform')
  const platform = createFakePlatform()
  registerFakePlatform(platform)
  return { api: platform.api, isDesktop: true }
})

import { Markdown } from '@renderer/components/Markdown'
import { getFakePlatform } from '../helpers/fakePlatform'

const platform = getFakePlatform()

beforeEach(() => {
  cleanup()
})

describe('Markdown rendering', () => {
  it('renders headings, paragraphs and lists', () => {
    render(<Markdown content={'## Title\n\nSome **bold** text.\n\n- one\n- two\n'} />)
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Title')
    expect(screen.getByText('bold')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('renders fenced code with language label, highlighting and a copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const { container } = render(
      <Markdown content={'Before\n\n```ts\nconst total: number = 42\n```\n\nAfter'} />
    )

    const block = container.querySelector('.code-block')
    expect(block).not.toBeNull()
    expect(container.querySelector('.code-block-lang')).toHaveTextContent('TypeScript')
    expect(container.querySelector('code.hljs .hljs-keyword')).not.toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('const total: number = 42')

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('const total: number = 42'))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Copy code' })).toHaveTextContent('Copied'))
  })

  it('keeps inline code inline', () => {
    const { container } = render(<Markdown content={'Use the `settings.json` file.'} />)
    expect(container.querySelector('.code-block')).toBeNull()
    const inline = container.querySelector('p code')
    expect(inline).toHaveTextContent('settings.json')
  })

  it('renders GitHub flavoured tables', () => {
    const { container } = render(
      <Markdown content={'| Model | Speed |\n| --- | --- |\n| Flash | fast |\n| Pro | slow |\n'} />
    )
    expect(container.querySelector('table')).not.toBeNull()
    expect(screen.getByText('Flash')).toBeInTheDocument()
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2)
  })

  it('opens links in the default browser instead of navigating the window', () => {
    platform.openedUrls.length = 0
    render(<Markdown content={'See the [docs](https://ai.google.dev/gemini-api/docs).'} />)
    fireEvent.click(screen.getByRole('link'))
    expect(platform.openedUrls).toEqual(['https://ai.google.dev/gemini-api/docs'])
  })

  it('shows code without a language tag as plain code', () => {
    const { container } = render(<Markdown content={'```\nplain text block\n```'} />)
    expect(container.querySelector('.code-block-lang')).toHaveTextContent('Code')
  })
})
