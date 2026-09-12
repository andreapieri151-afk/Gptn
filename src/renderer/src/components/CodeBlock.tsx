import { memo, useMemo, useState, type ReactElement } from 'react'
import { CheckIcon, CopyIcon } from './Icons'
import { highlightCode, languageLabel } from '@renderer/lib/highlight'
import { copyText } from '@renderer/lib/clipboard'

interface CodeBlockProps {
  code: string
  language?: string
}

/**
 * Fenced code block with a language label, syntax highlighting and a copy
 * button. The raw text is what gets copied, never the highlighted markup.
 */
export const CodeBlock = memo(function CodeBlock({ code, language }: CodeBlockProps): ReactElement {
  const [copied, setCopied] = useState(false)
  const html = useMemo(() => highlightCode(code, language), [code, language])

  const onCopy = async (): Promise<void> => {
    if (await copyText(code)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{languageLabel(language)}</span>
        <button
          type="button"
          className={`code-block-copy${copied ? ' copied' : ''}`}
          onClick={() => void onCopy()}
          aria-label="Copy code"
        >
          {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  )
})
