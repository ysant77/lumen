import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import type { CatalogItem, CodeSnippet } from '../types'
import { useData } from '../store/data'
import { pyRunner, type RunOutput } from '../lib/pyodide'
import { Button, EmptyState, Icon, Spinner, cn } from './ui'

const DEFAULT_SOURCE = `import numpy as np

# Scratchpad for "%TITLE%"
# Runs fully in your browser (Pyodide). numpy is preloaded;
# matplotlib loads automatically when imported.

x = np.linspace(0, 2 * np.pi, 50)
np.round(np.sin(x[:5]), 4)
`

interface ConsoleLine {
  kind: 'stdout' | 'stderr' | 'status' | 'repr' | 'error'
  text: string
}

export default function CodePane({ item }: { item: CatalogItem }) {
  const snippetsRaw = useData((s) => s.code[item.id])
  const snippets = useMemo(() => snippetsRaw ?? [], [snippetsRaw])
  const saveSnippets = useData((s) => s.saveSnippets)
  const [activeId, setActiveId] = useState<string | null>(snippets[0]?.id ?? null)
  const [running, setRunning] = useState(false)
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([])
  const [images, setImages] = useState<string[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const active = snippets.find((s) => s.id === activeId) ?? snippets[0] ?? null

  useEffect(() => {
    if (!active && snippets.length > 0) setActiveId(snippets[0].id)
  }, [snippets, active])

  const addSnippet = () => {
    const snip: CodeSnippet = {
      id: crypto.randomUUID(),
      title: `experiment ${snippets.length + 1}`,
      language: 'python',
      source: DEFAULT_SOURCE.replace('%TITLE%', item.shortName),
      updatedAt: new Date().toISOString(),
    }
    saveSnippets(item.id, [...snippets, snip])
    setActiveId(snip.id)
  }

  const updateSource = (source: string) => {
    if (!active) return
    const next = snippets.map((s) =>
      s.id === active.id ? { ...s, source, updatedAt: new Date().toISOString() } : s,
    )
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => saveSnippets(item.id, next), 800)
  }

  const rename = () => {
    if (!active) return
    const title = prompt('Snippet name', active.title)
    if (!title) return
    saveSnippets(
      item.id,
      snippets.map((s) => (s.id === active.id ? { ...s, title } : s)),
    )
  }

  const remove = () => {
    if (!active) return
    if (!confirm(`Delete "${active.title}"?`)) return
    const next = snippets.filter((s) => s.id !== active.id)
    saveSnippets(item.id, next)
    setActiveId(next[0]?.id ?? null)
  }

  const run = async () => {
    if (!active || running) return
    // flush any pending edit
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const source = active.source
    setRunning(true)
    setConsoleLines([])
    setImages([])
    const onOutput = (o: RunOutput) =>
      setConsoleLines((prev) => [...prev, { kind: o.kind, text: o.text }])
    const result = await pyRunner.run(source, onOutput)
    if (result.error) setConsoleLines((prev) => [...prev, { kind: 'error', text: result.error! }])
    else if (result.repr != null)
      setConsoleLines((prev) => [...prev, { kind: 'repr', text: result.repr! }])
    setImages(result.images)
    setRunning(false)
  }

  if (snippets.length === 0) {
    return (
      <div className="p-4">
        <EmptyState title="No code experiments yet">
          <p className="mb-3">
            Python runs locally in your browser via Pyodide — numpy included, matplotlib on demand.
            First run downloads the runtime (~15 MB, then cached offline).
          </p>
          <Button variant="primary" onClick={addSnippet}>
            <Icon name="plus" className="h-3.5 w-3.5" /> New experiment
          </Button>
          {item.exercise && (
            <p className="mt-4 border-t border-neutral-800 pt-3 text-left">
              <span className="font-medium text-neutral-400">Suggested exercise:</span> {item.exercise}
            </p>
          )}
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 overflow-x-auto border-b border-neutral-800 px-2 py-1.5">
        {snippets.map((s) => (
          <button
            key={s.id}
            onClick={() => setActiveId(s.id)}
            className={cn(
              'rounded px-2.5 py-1 text-xs whitespace-nowrap',
              s.id === active?.id
                ? 'bg-amber-500/15 text-amber-300'
                : 'text-neutral-500 hover:text-neutral-300',
            )}
          >
            {s.title}
          </button>
        ))}
        <Button variant="ghost" onClick={addSnippet} className="px-2 py-0.5" title="New snippet">
          <Icon name="plus" className="h-3.5 w-3.5" />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" onClick={rename} className="px-2 py-0.5" title="Rename">
            <Icon name="note" className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" onClick={remove} className="px-2 py-0.5" title="Delete">
            <Icon name="trash" className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              pyRunner.restart()
              setRunning(false)
              setConsoleLines([{ kind: 'status', text: 'Python runtime restarted.' }])
            }}
            className="px-2 py-0.5"
            title="Restart Python runtime"
          >
            <Icon name="sync" className="h-3.5 w-3.5" />
          </Button>
          <Button variant="primary" onClick={run} disabled={running} title="Run (Cmd/Ctrl+Enter)">
            {running ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="play" className="h-3.5 w-3.5" />}
            Run
          </Button>
        </div>
      </div>

      <div
        className="min-h-0 flex-[3]"
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            void run()
          }
        }}
      >
        <CodeMirror
          key={active?.id}
          value={active?.source ?? ''}
          onChange={updateSource}
          theme={oneDark}
          extensions={[python()]}
          style={{ height: '100%' }}
        />
      </div>

      <div className="min-h-0 flex-[2] overflow-auto border-t border-neutral-800 bg-neutral-950 p-3 font-mono text-xs">
        {consoleLines.length === 0 && images.length === 0 && (
          <span className="text-neutral-600">output appears here — Cmd/Ctrl+Enter to run</span>
        )}
        {consoleLines.map((l, i) => (
          <pre
            key={i}
            className={cn(
              'whitespace-pre-wrap',
              l.kind === 'stderr' && 'text-orange-400',
              l.kind === 'error' && 'text-red-400',
              l.kind === 'status' && 'text-neutral-500 italic',
              l.kind === 'repr' && 'text-emerald-300',
              l.kind === 'stdout' && 'text-neutral-300',
            )}
          >
            {l.text}
          </pre>
        ))}
        {images.map((b64, i) => (
          <img
            key={i}
            src={`data:image/png;base64,${b64}`}
            alt={`figure ${i + 1}`}
            className="my-2 max-w-full rounded bg-white"
          />
        ))}
      </div>
    </div>
  )
}
