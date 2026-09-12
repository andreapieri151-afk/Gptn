import { describe, expect, it } from 'vitest'
import { conversationsToJson, conversationsToMarkdown, fileNameFor } from '@main/exporter'
import type { Conversation } from '@shared/types'

const conversation: Conversation = {
  id: 'c1',
  title: 'Indexes in Postgres',
  createdAt: '2026-01-02T10:00:00.000Z',
  updatedAt: '2026-01-02T10:05:00.000Z',
  model: 'gemini-2.5-flash',
  messages: [
    { id: 'm1', role: 'user', content: 'How do partial indexes work?', createdAt: '2026-01-02T10:00:00.000Z', state: 'complete' },
    {
      id: 'm2',
      role: 'assistant',
      content: 'They index a subset of rows.\n\n```sql\nCREATE INDEX ON t (c) WHERE c IS NOT NULL;\n```',
      createdAt: '2026-01-02T10:00:05.000Z',
      state: 'complete'
    }
  ]
}

describe('conversationsToMarkdown', () => {
  it('writes a readable document with both roles', () => {
    const markdown = conversationsToMarkdown([conversation], '1.0.0')
    expect(markdown).toContain('# GPTN export')
    expect(markdown).toContain('## Indexes in Postgres')
    expect(markdown).toContain('### You')
    expect(markdown).toContain('### GPTN')
    expect(markdown).toContain('CREATE INDEX ON t (c) WHERE c IS NOT NULL;')
    expect(markdown).toContain('gemini-2.5-flash')
  })
})

describe('conversationsToJson', () => {
  it('produces a re-importable payload', () => {
    const payload = JSON.parse(conversationsToJson([conversation], '1.0.0')) as {
      app: string
      conversations: Conversation[]
    }
    expect(payload.app).toBe('GPTN')
    expect(payload.conversations).toHaveLength(1)
    expect(payload.conversations[0].messages[1].content).toContain('CREATE INDEX')
  })
})

describe('fileNameFor', () => {
  it('sanitises titles for the file system', () => {
    expect(fileNameFor('Postgres: indexes / queries?', 'md')).toBe('Postgres-indexes-queries.md')
    expect(fileNameFor('   ', 'json')).toBe('gptn-chat.json')
  })
})
