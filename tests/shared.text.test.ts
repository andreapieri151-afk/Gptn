import { describe, expect, it } from 'vitest'
import { deriveTitle, highlightMatches, previewOf, searchConversations } from '@shared/text'

describe('deriveTitle', () => {
  it('uses the first sentence of the message', () => {
    expect(deriveTitle('How do I center a div in CSS?')).toBe('How do I center a div in CSS?')
  })

  it('strips markdown noise', () => {
    expect(deriveTitle('## Refactor this\n\n```ts\nconst a = 1\n```\nplease')).toBe('Refactor this please')
    expect(deriveTitle('**bold** and _italic_')).toBe('bold and italic')
    expect(deriveTitle('[label](https://example.com) text')).toBe('label text')
  })

  it('truncates long messages on a word boundary', () => {
    const long = 'word '.repeat(40)
    const title = deriveTitle(long, 30)
    expect(title.length).toBeLessThanOrEqual(31)
    expect(title.endsWith('…')).toBe(true)
    expect(title).not.toMatch(/wor…$/)
  })

  it('falls back for empty input', () => {
    expect(deriveTitle('   ')).toBe('New chat')
  })
})

describe('previewOf', () => {
  it('collapses whitespace and limits length', () => {
    expect(previewOf('a\n\nb   c')).toBe('a b c')
    expect(previewOf('x'.repeat(300), 20)).toHaveLength(20)
  })
})

describe('searchConversations', () => {
  const conversations = [
    {
      id: '1',
      title: 'Postgres indexes',
      updatedAt: new Date().toISOString(),
      messages: [{ role: 'user', content: 'How do partial indexes work?' }]
    },
    {
      id: '2',
      title: 'Trip planning',
      updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      messages: [{ role: 'user', content: 'Find me a hotel in Lisbon and check the postgres venue' }]
    }
  ]

  it('ranks title matches above body matches', () => {
    const hits = searchConversations(conversations, 'postgres')
    expect(hits[0].conversationId).toBe('1')
    expect(hits[0].titleMatch).toBe(true)
    expect(hits).toHaveLength(2)
  })

  it('returns a snippet when the match is in the body only', () => {
    const hits = searchConversations(conversations, 'lisbon')
    expect(hits).toHaveLength(1)
    expect(hits[0].snippet).toContain('Lisbon')
  })

  it('returns nothing for an empty query', () => {
    expect(searchConversations(conversations, '   ')).toEqual([])
  })
})

describe('highlightMatches', () => {
  it('splits around the match, case insensitively', () => {
    const parts = highlightMatches('Postgres indexes', 'postgres')
    expect(parts).toEqual([
      { text: 'Postgres', match: true },
      { text: ' indexes', match: false }
    ])
  })

  it('returns the whole text when the query is empty', () => {
    expect(highlightMatches('abc', '')).toEqual([{ text: 'abc', match: false }])
  })
})
