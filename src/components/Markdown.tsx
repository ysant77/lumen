import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { cn } from './ui'

/** Markdown with GFM + KaTeX ($inline$ and $$display$$ math). */
export const Markdown = memo(function Markdown({
  children,
  className,
  components,
}: {
  children: string
  className?: string
  components?: Components
}) {
  return (
    <div className={cn('prose-lumen text-neutral-300', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          ...components,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
})
