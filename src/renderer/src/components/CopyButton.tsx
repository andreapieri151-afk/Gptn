import { useState, type ReactElement, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from './Icons'
import { copyText } from '@renderer/lib/clipboard'

interface CopyButtonProps {
  text: string
  label?: string
  className?: string
  iconSize?: number
  children?: ReactNode
}

/** Copy-to-clipboard control with a short "Copied" confirmation. */
export function CopyButton({
  text,
  label = 'Copy',
  className = 'message-action',
  iconSize = 13,
  children
}: CopyButtonProps): ReactElement {
  const [copied, setCopied] = useState(false)

  const onCopy = async (): Promise<void> => {
    if (await copyText(text)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <button type="button" className={className} onClick={() => void onCopy()} aria-label={label}>
      {copied ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
      {children ?? (copied ? 'Copied' : label)}
    </button>
  )
}
