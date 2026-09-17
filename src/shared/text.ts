import type { SearchHit } from './types'

/**
 * Conversation titles are derived locally from the first user message:
 * deterministic, instant, no extra API call.
 */
export function deriveTitle(text: string, maxLength = 60): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'New chat'
  if (cleaned.length <= maxLength) return cleaned

  const sliced = cleaned.slice(0, maxLength)
  const lastSpace = sliced.lastIndexOf(' ')
  const trimmed = (lastSpace > maxLength * 0.6 ? sliced.slice(0, lastSpace) : sliced).trimEnd()
  return `${trimmed}…`
}

/** Compact single line preview used by the sidebar list. */
export function previewOf(text: string, maxLength = 140): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Case/diacritic-insensitive search across conversation titles and bodies.
 * Implemented in the main process so the renderer only receives small results.
 */
export function searchConversations(
  conversations: Array<{
    id: string
    title: string
    updatedAt: string
    messages: Array<{ role: string; content: string }>
  }>,
  query: string,
  limit = 40
): SearchHit[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const tokens = needle.split(/\s+/).filter(Boolean)
  const hits: Array<SearchHit & { score: number }> = []

  for (const conversation of conversations) {
    const titleLower = conversation.title.toLowerCase()
    const bodyLower = conversation.messages.map((m) => m.content).join('\n').toLowerCase()

    let score = 0
    let titleMatch = false
    let snippet: string | undefined

    if (titleLower.includes(needle)) {
      score += 100
      titleMatch = true
      if (titleLower.startsWith(needle)) score += 25
    } else if (tokens.length > 1 && tokens.every((token) => titleLower.includes(token))) {
      score += 60
      titleMatch = true
    }

    for (const token of tokens) {
      if (!bodyLower.includes(token)) continue
      const at = bodyLower.indexOf(token)
      score += titleMatch ? 4 : 12
      if (!snippet) {
        const start = Math.max(0, at - 40)
        snippet = `${start > 0 ? '…' : ''}${conversation.messages
          .map((m) => m.content)
          .join(' ')
          .slice(start, at + 90)
          .replace(/\s+/g, ' ')
          .trim()}…`
      }
    }

    // Recency only orders real matches — it never makes an unrelated chat a hit.
    if (score > 0) {
      const ageDays = Math.max(0, (Date.now() - Date.parse(conversation.updatedAt)) / 86_400_000)
      score += Math.max(0, 10 - ageDays / 3)
    }

    if (score > 0) {
      const hit: SearchHit & { score: number } = {
        conversationId: conversation.id,
        title: conversation.title,
        updatedAt: conversation.updatedAt,
        titleMatch,
        score
      }
      if (snippet && !titleMatch) hit.snippet = snippet
      hits.push(hit)
    }
  }

  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...hit }) => hit)
}

/** Highlights the matched part of a title in the palette (used by the UI). */
export function highlightMatches(text: string, query: string): Array<{ text: string; match: boolean }> {
  const needle = query.trim()
  if (!needle) return [{ text, match: false }]
  const parts = text.split(new RegExp(`(${escapeRegExp(needle)})`, 'ig'))
  return parts
    .filter((part) => part !== '')
    .map((part) => ({ text: part, match: part.toLowerCase() === needle.toLowerCase() }))
}
