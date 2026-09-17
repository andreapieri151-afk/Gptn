// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('@renderer/platform/api', async () => {
  const { createFakePlatform, registerFakePlatform } = await import('../helpers/fakePlatform')
  // First run: no key stored yet.
  const platform = createFakePlatform(false)
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
  platform.setHasApiKey(false)
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

const boot = async (): Promise<void> => {
  render(<App />)
  await waitFor(() => expect(screen.getByText('Connect Gemini')).toBeInTheDocument())
}

describe('first-run onboarding', () => {
  it('guides the user to their own key instead of the empty chat screen', async () => {
    await boot()

    expect(screen.queryByText('How can I help you?')).not.toBeInTheDocument()
    expect(screen.getByText(/Create a free API key/)).toBeInTheDocument()
    expect(screen.getByLabelText('Gemini API key')).toBeInTheDocument()

    // The message is honest about where the key lives.
    expect(screen.getByText(/macOS Keychain/)).toBeInTheDocument()
  })

  it('opens Google AI Studio when asked for a key', async () => {
    await boot()
    fireEvent.click(screen.getByTestId('connect-create-key'))
    await waitFor(() => expect(platform.openedUrls).toEqual(['https://aistudio.google.com/apikey']))
  })

  it('keeps the send button disabled until a key works', async () => {
    await boot()

    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Ciao' } })
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' })

    expect(platform.requests).toHaveLength(0)
    expect(screen.getByText('Paste your Gemini API key above to start chatting')).toBeInTheDocument()
  })

  it('verifies the key with a real request, then stores it and unlocks the chat', async () => {
    await boot()

    fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'AIzaFakeKeyForTests' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & test' }))

    // The key is proven before it is written to the Keychain…
    await waitFor(() => expect(platform.testedKeys).toEqual(['AIzaFakeKeyForTests']))
    await waitFor(() => expect(platform.savedKeys).toEqual(['AIzaFakeKeyForTests']))
    expect(platform.testedKeys[0]).toBe(platform.savedKeys[0])

    // …and the confirmation arrives while the onboarding gives way to the chat.
    await waitFor(() =>
      expect(useChatStore.getState().toasts.map((toast) => toast.message)).toEqual([
        'Connected — Gemini 2.5 Flash replied in 123 ms'
      ])
    )
    expect(screen.getByText('Connected — Gemini 2.5 Flash replied in 123 ms')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('How can I help you?')).toBeInTheDocument())
    expect(screen.queryByText('Connect Gemini')).not.toBeInTheDocument()
    expect(useChatStore.getState().secrets?.hasApiKey).toBe(true)
  })

  it('does not keep a key that Gemini rejects, and explains why', async () => {
    platform.setKeyTestResult({
      ok: false,
      latencyMs: 180,
      error: {
        code: 'INVALID_API_KEY',
        title: 'Invalid API key',
        message: 'Gemini rejected this key. Check it in Google AI Studio.',
        detail: '400 INVALID_ARGUMENT — API key not valid. Please pass a valid API key.',
        retryable: false
      }
    })

    await boot()
    fireEvent.change(screen.getByLabelText('Gemini API key'), { target: { value: 'AIzaWrong' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save & test' }))

    const status = await screen.findByTestId('connect-status')
    expect(status).toHaveTextContent('Invalid API key')
    expect(status).toHaveTextContent('Nothing was saved.')

    // Nothing was written, and the screen stays so a correct key can be pasted.
    expect(platform.savedKeys).toEqual([])
    expect(useChatStore.getState().secrets?.hasApiKey).toBe(false)
    expect(screen.getByText('Connect Gemini')).toBeInTheDocument()
    expect(screen.getByText(/Technical details/)).toBeInTheDocument()
  })

  it('warns when the key cannot be encrypted on this Mac', async () => {
    platform.setHasApiKey(false)
    const original = platform.api.secrets.status
    platform.api.secrets.status = async () => ({
      hasApiKey: false,
      maskedKey: null,
      storage: 'memory',
      encryptionAvailable: false
    })

    await boot()
    await waitFor(() =>
      expect(screen.getByText(/Encryption is unavailable on this Mac/)).toBeInTheDocument()
    )

    platform.api.secrets.status = original
  })

  it('offers Settings for users who prefer to paste the key there', async () => {
    await boot()
    fireEvent.click(screen.getByRole('button', { name: /I already have a key/ }))

    expect(useChatStore.getState().settingsOpen).toBe(true)
    expect(useChatStore.getState().settingsSection).toBe('ai')
  })
})
