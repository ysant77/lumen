import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import type { CatalogItem } from '../types'
import { useData } from '../store/data'
import { usePendingSave } from '../lib/usePendingSave'
import { Markdown } from './Markdown'
import { cn } from './ui'

function template(item: CatalogItem): string {
  return [
    `# ${item.shortName} — ${item.title}`,
    '',
    item.why ? `> ${item.why}` : '',
    '',
    '## Key ideas',
    '',
    '- ',
    '',
    '## Questions',
    '',
    '- ',
    '',
    '## Exercise log',
    '',
    item.exercise ? `- [ ] ${item.exercise}` : '- [ ] ',
    '',
    '## Math scratchpad',
    '',
    'Inline: $x^2$ · Display:',
    '',
    '$$\\mathrm{Attention}(Q,K,V)=\\mathrm{softmax}\\!\\left(\\frac{QK^\\top}{\\sqrt{d_k}}\\right)V$$',
    '',
  ].join('\n')
}

const editorExtensions = [markdown(), EditorView.lineWrapping]

export default function NotesPane({
  item,
  onPageLink,
  insertPage,
  onInsertHandled,
}: {
  item: CatalogItem
  onPageLink?: (page: number) => void
  insertPage?: number | null
  onInsertHandled?: () => void
}) {
  const saved = useData((s) => s.notes[item.id])
  const saveNote = useData((s) => s.saveNote)
  const initial = useMemo(() => saved ?? template(item), [item.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [text, setText] = useState<string>(initial)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const { schedule, flush, hasPending } = usePendingSave<string>(
    (value) => saveNote(item.id, value),
    800,
  )
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    setText(initial)
  }, [initial])

  // adopt content that arrived from sync while we have no unsaved edits
  useEffect(() => {
    if (saved != null && !hasPending() && saved !== textRef.current) setText(saved)
  }, [saved, hasPending])

  // page-linked note insertion requested by the reader
  useEffect(() => {
    if (insertPage == null) return
    const line = `\n> p.${insertPage}: `
    const next = textRef.current.endsWith('\n') ? textRef.current + line.slice(1) : textRef.current + line
    setText(next)
    schedule(next)
    setMode('edit')
    onInsertHandled?.()
  }, [insertPage, schedule, onInsertHandled])

  const onChange = (value: string) => {
    setText(value)
    schedule(value)
  }

  // preview: make "p.12" jump the reader to that page
  const previewText = useMemo(
    () => text.replace(/(^|\s)p\.(\d{1,4})\b/g, '$1[p.$2](#page-$2)'),
    [text],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-neutral-800 px-3 py-1.5">
        {(['edit', 'preview'] as const).map((m) => (
          <button
            key={m}
            onClick={() => {
              if (m === 'preview') flush()
              setMode(m)
            }}
            className={cn(
              'rounded px-2.5 py-1 text-xs capitalize',
              mode === m ? 'bg-amber-500/15 text-amber-300' : 'text-neutral-400 hover:text-neutral-200',
            )}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-neutral-500">markdown + $\LaTeX$ · autosaves · p.N links pages</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {mode === 'edit' ? (
          <CodeMirror
            value={text}
            onChange={onChange}
            theme={oneDark}
            extensions={editorExtensions}
            basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false }}
            style={{ height: '100%' }}
          />
        ) : (
          <div className="p-4">
            <Markdown
              components={{
                a: (props: any) => {
                  const m = /^#page-(\d+)$/.exec(props.href ?? '')
                  if (m && onPageLink) {
                    return (
                      <button
                        className="rounded bg-amber-500/15 px-1 font-mono text-[11px] text-amber-300 hover:bg-amber-500/25"
                        onClick={() => onPageLink(Number(m[1]))}
                      >
                        {props.children}
                      </button>
                    )
                  }
                  return <a {...props} target="_blank" rel="noreferrer" />
                },
              }}
            >
              {previewText}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  )
}
