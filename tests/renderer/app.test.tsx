// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@renderer/platform/api', async () => {
  const { createFakePlatform, registerFakePlatform } = await import('../helpers/fakePlatform')
  const platform = createFakePlatform()
  registerFakePlatform(platform)
  return { api: platform.api, isDesktop: true }
})

import App from '@renderer/App'
import { useChatStore } from '@renderer/state/store'
import { getFakePlatform } from '../helpers/fakePlatform'

const platform = getFakePlatform()

beforeEach(() => {
  cleanup()
  platform.reset()
  useChatStore.setState({
    ready: false,
    settings: null,
    secrets: null,
    models: [],
    conversations: [],
    activeId: null,
    messages: [],
    requestId: null,
    streamingMessageId: null,
    lastError: null,
    settingsOpen: false,
    paletteOpen: false,
    toasts: []
  })
})

describe('GPTN application shell', () => {
  it('boots into the chat screen with sidebar, empty state and composer', async () => {
    render(<App />)

    await waitFor(() => expect(screen.getByText('How can I help you?')).toBeInTheDocument())

    // Sidebar
    expect(screen.getByRole('button', { name: /New chat\s*⌘N/ })).toBeInTheDocument()
    expect(screen.getAllByText('Gemini 2.5 Flash').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /Settings/ })).toBeInTheDocument()

    // Composer + starting points
    expect(screen.getByLabelText('Message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Help me code/ })).toBeInTheDocument()
  })

  it('sends a message with Enter and renders the answer as it streams', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument())

    const textarea = screen.getByLabelText('Message')
    fireEvent.change(textarea, { target: { value: 'Summarise SSE' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })

    await waitFor(() => expect(screen.getAllByText('Summarise SSE').length).toBeGreaterThan(0))
    await waitFor(() => expect(platform.requests).toHaveLength(1))

    const requestId = platform.requests[0].requestId
    platform.emitDelta({ requestId, text: '**Streaming** ' })
    platform.emitDelta({ requestId, text: 'works.' })
    await waitFor(() => expect(screen.getByText('Streaming')).toBeInTheDocument())

    platform.emitDone({
      requestId,
      conversationId: platform.requests[0].conversationId,
      text: '**Streaming** works.',
      model: 'gemini-2.5-flash',
      durationMs: 500,
      interrupted: false
    })

    // The finished answer shows the copy control and no caret.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy answer' })).toBeInTheDocument())
    expect(document.querySelector('.streaming-caret')).toBeNull()
  })

  it('shows Shift+Enter as a newline instead of sending', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeInTheDocument())

    const textarea = screen.getByLabelText('Message')
    fireEvent.change(textarea, { target: { value: 'first line' } })
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
    expect(platform.requests).toHaveLength(0)
  })

  it('opens the command palette with ⌘K and lists recent chats', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('How can I help you?')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: 'k', metaKey: true })

    const input = await screen.findByLabelText('Search conversations')
    expect(input).toBeInTheDocument()
    expect(screen.getAllByText('New chat').length).toBeGreaterThan(0)

    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByLabelText('Search conversations')).toBeNull())
  })

  it('opens Settings with ⌘, and switches between sections', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('How can I help you?')).toBeInTheDocument())

    fireEvent.keyDown(window, { key: ',', metaKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'GPTN settings' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText('Appearance')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /AI \/ Gemini/ }))
    await waitFor(() => expect(screen.getByText('Gemini API key')).toBeInTheDocument())
    expect(screen.getByLabelText('Gemini API key')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Data/ }))
    await waitFor(() => expect(screen.getByText('Local database')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /About/ }))
    await waitFor(() => expect(screen.getByText('Version')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'GPTN settings' })).toBeNull())
  })

  it('fills the composer when a starting point is chosen', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('How can I help you?')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Brainstorm ideas/ }))
    const textarea = screen.getByLabelText('Message') as HTMLTextAreaElement
    expect(textarea.value).toContain('product ideas')
    expect(platform.requests).toHaveLength(0)
  })

  it('explains that a key is needed when none is stored', async () => {
    await platform.api.secrets.clearApiKey()
    const secrets = await platform.api.secrets.status()
    useChatStore.setState({ secrets })
    render(<App />)

    await waitFor(() =>
      expect(screen.getByPlaceholderText(/Add your Gemini API key in Settings/)).toBeInTheDocument()
    )
    expect(screen.getByText(/Add your Gemini API key in Settings → AI to start chatting/)).toBeInTheDocument()
  })
})
