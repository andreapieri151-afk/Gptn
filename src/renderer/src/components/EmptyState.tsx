import type { ReactElement } from 'react'
import { BrandMark } from './Icons'

interface Suggestion {
  title: string
  text: string
  prompt: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    title: 'Explain something',
    text: 'Break a complex topic into clear steps',
    prompt: 'Explain how HTTPS works, in clear steps and without jargon.'
  },
  {
    title: 'Help me code',
    text: 'Write, review or debug a snippet',
    prompt: 'Write a small TypeScript function that debounces an async call, with a usage example.'
  },
  {
    title: 'Brainstorm ideas',
    text: 'Explore angles you have not considered',
    prompt: 'Give me 8 product ideas for a desktop AI assistant aimed at writers. Be specific.'
  },
  {
    title: 'Write something',
    text: 'Draft, rewrite or polish a text',
    prompt: 'Draft a short, friendly release-notes entry announcing a dark mode for a desktop app.'
  }
]

interface EmptyStateProps {
  onPick: (prompt: string) => void
}

/** First-run / new-chat screen: a short invitation plus four starting points. */
export function EmptyState({ onPick }: EmptyStateProps): ReactElement {
  return (
    <div className="empty-state">
      <div className="empty-mark">
        <BrandMark size={26} />
      </div>
      <h1 className="empty-title">How can I help you?</h1>
      <p className="empty-subtitle">
        GPTN is a desktop client for Google Gemini. Ask a question, paste code or start from one of these.
      </p>
      <div className="suggestion-grid">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion.title}
            type="button"
            className="suggestion"
            onClick={() => onPick(suggestion.prompt)}
          >
            <span className="suggestion-title">{suggestion.title}</span>
            <span className="suggestion-text">{suggestion.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
