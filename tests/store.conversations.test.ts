import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConversationRepository } from '@main/store/conversations'
import { defaultSettings, normalizeSettings, SettingsRepository } from '@main/store/settings'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gptn-store-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('ConversationRepository', () => {
  it('creates, lists and orders conversations by recency', async () => {
    const repo = new ConversationRepository(join(dir, 'conversations.json'))
    await repo.load()

    const first = repo.create({ model: 'gemini-2.5-flash' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = repo.create({ model: 'gemini-2.5-pro' })

    const list = repo.list()
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe(second.id)
    expect(list[1].id).toBe(first.id)
    expect(list[0].title).toBe('New chat')
  })

  it('persists conversations to disk and reloads them', async () => {
    const file = join(dir, 'conversations.json')
    const repo = new ConversationRepository(file)
    await repo.load()
    const conversation = repo.create({ model: 'gemini-2.5-flash' })
    repo.save({
      ...conversation,
      title: 'Persisted chat',
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Remember me',
          createdAt: new Date().toISOString(),
          state: 'complete'
        }
      ]
    })
    await repo.flush()

    const reloaded = new ConversationRepository(file)
    await reloaded.load()
    const list = reloaded.list()
    expect(list).toHaveLength(1)
    expect(list[0].title).toBe('Persisted chat')
    expect(list[0].preview).toBe('Remember me')
    expect(reloaded.get(list[0].id)?.messages[0].content).toBe('Remember me')
  })

  it('recovers from a corrupted file using the backup copy', async () => {
    const file = join(dir, 'conversations.json')
    const repo = new ConversationRepository(file)
    await repo.load()
    repo.create({ model: 'gemini-2.5-flash', title: 'Backup me' })
    await repo.flush()
    // Writing twice produces a .bak of the previous good state.
    repo.create({ model: 'gemini-2.5-flash', title: 'Second' })
    await repo.flush()

    await writeFile(file, '{ this is not json', 'utf8')

    const recovered = new ConversationRepository(file)
    await recovered.load()
    expect(recovered.list().length).toBeGreaterThan(0)
    const restored = await readFile(`${file}.bak`, 'utf8')
    expect(restored).toContain('Backup me')
  })

  it('renames, deletes and clears conversations', async () => {
    const repo = new ConversationRepository(join(dir, 'conversations.json'))
    await repo.load()
    const conversation = repo.create({ model: 'gemini-2.5-flash' })

    const renamed = repo.rename(conversation.id, '  A better title  ')
    expect(renamed?.title).toBe('A better title')

    expect(repo.remove(conversation.id)).toBe(true)
    expect(repo.list()).toHaveLength(0)

    repo.create({ model: 'gemini-2.5-flash' })
    expect(repo.removeAll()).toBe(1)
    expect(repo.list()).toHaveLength(0)
  })

  it('searches titles and message bodies', async () => {
    const repo = new ConversationRepository(join(dir, 'conversations.json'))
    await repo.load()
    const conversation = repo.create({ model: 'gemini-2.5-flash', title: 'Kubernetes notes' })
    repo.save({
      ...conversation,
      messages: [
        { id: 'm1', role: 'user', content: 'How does a StatefulSet differ?', createdAt: new Date().toISOString(), state: 'complete' }
      ]
    })

    expect(repo.search('statefulset')[0]?.conversationId).toBe(conversation.id)
    expect(repo.search('kubernetes')[0]?.titleMatch).toBe(true)
    expect(repo.search('nothing here')).toHaveLength(0)
  })

  it('imports exported conversations and regenerates colliding ids', async () => {
    const repo = new ConversationRepository(join(dir, 'conversations.json'))
    await repo.load()
    const conversation = repo.create({ model: 'gemini-2.5-flash', title: 'Original' })

    const imported = repo.import([
      { ...conversation, title: 'Imported copy' },
      { title: 'invalid entry' }
    ])

    expect(imported).toBe(1)
    const list = repo.list()
    expect(list).toHaveLength(2)
    expect(list[0].title).toBe('Imported copy (imported)')
  })

  it('reports statistics for the data settings panel', async () => {
    const repo = new ConversationRepository(join(dir, 'conversations.json'))
    await repo.load()
    repo.create({ model: 'gemini-2.5-flash' })
    await repo.flush()

    const stats = await repo.stats()
    expect(stats.conversations).toBe(1)
    expect(stats.databaseBytes).toBeGreaterThan(0)
    expect(stats.databasePath).toContain('conversations.json')
  })
})

describe('SettingsRepository', () => {
  it('applies defaults and clamps out-of-range values', async () => {
    const repo = new SettingsRepository(join(dir, 'settings.json'))
    await repo.load()
    expect(repo.get()).toEqual(defaultSettings())

    repo.update({ temperature: 9, sidebarWidth: 5000, theme: 'dark' })
    const settings = repo.get()
    expect(settings.temperature).toBe(2)
    expect(settings.sidebarWidth).toBe(460)
    expect(settings.theme).toBe('dark')
  })

  it('repairs invalid values coming from disk', () => {
    const repaired = normalizeSettings({
      theme: 'neon',
      model: '',
      sidebarCollapsed: 'yes',
      customModels: [{ id: '  ' }, { id: 'gemini-x', label: '' }, 'nope'],
      topP: 4,
      maxOutputTokens: -10
    })
    expect(repaired.theme).toBe('system')
    expect(repaired.model).toBe(defaultSettings().model)
    expect(repaired.sidebarCollapsed).toBe(false)
    expect(repaired.customModels).toEqual([{ id: 'gemini-x', label: 'gemini-x' }])
    expect(repaired.topP).toBe(1)
    expect(repaired.maxOutputTokens).toBeNull()
  })

  it('persists settings between launches', async () => {
    const file = join(dir, 'settings.json')
    const repo = new SettingsRepository(file)
    await repo.load()
    repo.update({ model: 'gemini-2.5-pro', systemInstruction: 'Be brief' })
    await repo.flush()

    const reloaded = new SettingsRepository(file)
    await reloaded.load()
    expect(reloaded.get().model).toBe('gemini-2.5-pro')
    expect(reloaded.get().systemInstruction).toBe('Be brief')
  })
})
