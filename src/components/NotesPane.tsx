import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import type { CatalogItem } from '../types'
import { useData } from '../store/data'
import { Markdown } from './Markdown'
import { Button, cn } from './ui'

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

export default function NotesPane({ item }: { item: CatalogItem }) {
  const saved = useData((s) => s.notes[item.id])
  const saveNote = useData((s) => s.saveNote)
  const [text, setText] = useState<string>(saved ?? '')
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const initial = useMemo(() => saved ?? template(item), [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setText(initial)
  }, [initial])

  const onChange = (value: string) => {
    setText(value)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveNote(item.id, value), 800)
  }

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    },
    [],
  )

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-neutral-800 px-3 py-1.5">
        {(['edit', 'preview'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={cn(
              'rounded px-2.5 py-1 text-xs capitalize',
              mode === m ? 'bg-amber-500/15 text-amber-300' : 'text-neutral-500 hover:text-neutral-300',
            )}
          >
            {m}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-neutral-600">
          markdown + $\LaTeX$ · autosaves
        </span>
        {saved !== text && text !== initial && (
          <Button variant="ghost" className="px-2 py-0.5" onClick={() => saveNote(item.id, text)}>
            save now
          </Button>
        )}
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
            <Markdown>{text}</Markdown>
          </div>
        )}
      </div>
    </div>
  )
}
