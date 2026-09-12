import { memo, useCallback, type ReactElement } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'
import { api } from '@renderer/platform/api'

/**
 * Markdown renderer used for assistant answers: GFM (tables, task lists,
 * strikethrough) plus code blocks, with links opened in the default browser
 * instead of navigating the app window.
 */
export const Markdown = memo(function Markdown({ content }: { content: string }): ReactElement {
  const openLink = useCallback((event: React.MouseEvent<HTMLAnchorElement>, href: string): void => {
    event.preventDefault()
    void api.app.openExternal(href)
  }, [])

  const components: Components = {
    // Unwrap <pre>: CodeBlock already renders its own container.
    pre: ({ children }) => <>{children}</>,
    code({ className, children, node, ...props }) {
      const text = String(children ?? '').replace(/\n$/, '')
      const language = /language-([\w+#-]+)/.exec(className ?? '')?.[1]
      const spansLines =
        !!node?.position && node.position.start.line !== node.position.end.line
      const isBlock = !!language || text.includes('\n') || spansLines

      if (isBlock) return <CodeBlock code={text} language={language} />
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    },
    a({ href, children, ...props }) {
      const url = href ?? ''
      return (
        <a
          href={url}
          {...props}
          onClick={(event) => openLink(event, url)}
          title={url}
          rel="noreferrer noopener"
        >
          {children}
        </a>
      )
    },
    table({ children }) {
      return (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      )
    }
  }

  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        // Block remote images: the renderer only loads bundled assets.
        urlTransform={(url) => (url.startsWith('data:') ? url : url.startsWith('#') ? url : url)}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
