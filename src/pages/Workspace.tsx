import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { resolveItem } from '../lib/catalog'
import { useData } from '../store/data'
import { useTimer } from '../store/timer'
import PdfReader from '../components/PdfReader'
import NotesPane from '../components/NotesPane'
import CodePane from '../components/CodePane'
import CardsPane from '../components/CardsPane'
import InfoPane from '../components/InfoPane'
import EvidencePane from '../components/EvidencePane'
import { Icon, StatusSelect, cn } from '../components/ui'

type Tab = 'notes' | 'code' | 'cards' | 'lab' | 'info'
type LayoutMode = 'split' | 'reader' | 'work'

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'notes', label: 'Notes', icon: 'note' },
  { id: 'code', label: 'Code', icon: 'code' },
  { id: 'cards', label: 'Cards', icon: 'cards' },
  { id: 'lab', label: 'Evidence', icon: 'beaker' },
  { id: 'info', label: 'Info', icon: 'info' },
]

const SPLIT_KEY = 'lumen.splitRatio'

export default function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const customItems = useData((s) => s.customItems)
  const found = id ? resolveItem(id, customItems) : undefined
  const progress = useData((s) => (id ? s.progress[id] : undefined))
  const setStatus = useData((s) => s.setStatus)
  const weekQueue = useData((s) => s.weekQueue)
  const setWeekQueue = useData((s) => s.setWeekQueue)
  const attach = useTimer((s) => s.attach)
  const [tab, setTab] = useState<Tab>('notes')
  const [layout, setLayout] = useState<LayoutMode>(() => (window.innerWidth < 900 ? 'reader' : 'split'))
  const [requestedPage, setRequestedPage] = useState<number | null>(null)
  const [insertPage, setInsertPage] = useState<number | null>(null)

  // adjustable reader/workspace split (persisted per device)
  const [splitRatio, setSplitRatio] = useState<number>(() => {
    const saved = Number(localStorage.getItem(SPLIT_KEY))
    return saved >= 0.25 && saved <= 0.75 ? saved : 0.5
  })
  const bodyRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const onDividerPointerDown = (e: React.PointerEvent) => {
    dragging.current = true
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDividerPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current || !bodyRef.current) return
    const rect = bodyRef.current.getBoundingClientRect()
    const ratio = Math.min(0.75, Math.max(0.25, (e.clientX - rect.left) / rect.width))
    setSplitRatio(ratio)
  }
  const onDividerPointerUp = () => {
    if (!dragging.current) return
    dragging.current = false
    localStorage.setItem(SPLIT_KEY, String(splitRatio))
  }

  useEffect(() => {
    if (id) attach(id)
  }, [id, attach])

  // reader page requested from a note link — make the reader visible first
  const goToPage = useCallback((page: number) => {
    setLayout((prev) => (prev === 'work' ? (window.innerWidth < 768 ? 'reader' : 'split') : prev))
    setRequestedPage(page)
  }, [])

  // "add page note" from the reader — make the notes pane visible
  const addPageNote = useCallback((page: number) => {
    setTab('notes')
    setLayout((prev) => (prev === 'reader' ? (window.innerWidth < 768 ? 'work' : 'split') : prev))
    setInsertPage(page)
  }, [])

  if (!found || !id) {
    return (
      <div className="p-6 text-sm text-neutral-400">
        Unknown item.{' '}
        <button className="text-amber-400 underline" onClick={() => navigate('/library')}>
          Back to library
        </button>
      </div>
    )
  }
  const { item, collection } = found
  const status = progress?.status ?? 'not-started'
  const queued = weekQueue.items.includes(id)

  const showReader = layout !== 'work'
  const showWork = layout !== 'reader'

  return (
    <div className="flex h-full flex-col">
      {/* header: title row + controls row (controls wrap below title on phones) */}
      <div className="border-b border-neutral-800 px-3 py-2 sm:px-4">
        <div className="flex items-start gap-2">
          <Link
            to={`/library/${collection.id}`}
            className="mt-0.5 flex shrink-0 items-center gap-1 text-xs text-neutral-400 hover:text-neutral-200"
            aria-label={`Back to ${collection.title}`}
          >
            <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
            <span className="hidden md:inline">{collection.title}</span>
          </Link>
          <h1
            className="min-w-0 flex-1 text-sm leading-snug font-semibold text-neutral-100 max-sm:line-clamp-2 sm:truncate"
            title={item.title}
          >
            <span className="text-amber-400">{item.shortName}</span>
            <span className="mx-2 text-neutral-700">·</span>
            <span className="font-normal text-neutral-300">{item.title}</span>
          </h1>
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <StatusSelect value={status} onChange={(s) => setStatus(id, s)} />
          <button
            onClick={() =>
              setWeekQueue(queued ? weekQueue.items.filter((i) => i !== id) : [...weekQueue.items, id])
            }
            className={cn(
              'flex h-8 items-center gap-1 rounded-md border px-2 text-[11px]',
              queued
                ? 'border-amber-700 text-amber-300'
                : 'border-neutral-800 text-neutral-400 hover:text-neutral-200',
            )}
            aria-pressed={queued}
            title={queued ? 'Remove from “This week”' : 'Add to “This week”'}
          >
            <Icon name="bookmark" className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{queued ? 'Queued' : 'This week'}</span>
          </button>
          {progress?.lastPage && progress.totalPages && (
            <span className="font-mono text-[11px] text-neutral-500">
              p.{progress.lastPage}/{progress.totalPages}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* layout toggle */}
            <div className="hidden items-center rounded-md border border-neutral-800 md:flex">
              {(
                [
                  ['reader', 'Reader'],
                  ['split', 'Split'],
                  ['work', 'Workspace'],
                ] as Array<[LayoutMode, string]>
              ).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => setLayout(m)}
                  className={cn(
                    'px-2 py-1.5 text-[11px]',
                    layout === m ? 'bg-neutral-800 text-amber-300' : 'text-neutral-400 hover:text-neutral-200',
                  )}
                  aria-pressed={layout === m}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="min-h-8 rounded-md border border-neutral-800 px-2.5 py-1 text-[11px] text-neutral-300 md:hidden"
              onClick={() => setLayout(layout === 'reader' ? 'work' : 'reader')}
            >
              {layout === 'reader' ? 'Workspace' : 'Reader'}
            </button>
          </div>
        </div>
      </div>

      {/* body */}
      <div ref={bodyRef} className="flex min-h-0 flex-1">
        {showReader && (
          <div
            className={cn('min-w-0', showWork ? 'hidden md:block' : 'flex-1')}
            style={showWork ? { flexBasis: `${splitRatio * 100}%`, flexGrow: 0, flexShrink: 0 } : undefined}
          >
            <PdfReader
              itemId={id}
              pdfFile={item.pdfFile}
              pdfUrl={item.pdfUrl}
              requestedPage={requestedPage}
              onPageHandled={() => setRequestedPage(null)}
              onAddPageNote={addPageNote}
            />
          </div>
        )}
        {showReader && showWork && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize reader and workspace"
            className="hidden w-2 shrink-0 cursor-col-resize touch-none items-center justify-center border-x border-neutral-800/60 bg-neutral-900/40 hover:bg-amber-500/20 md:flex"
            onPointerDown={onDividerPointerDown}
            onPointerMove={onDividerPointerMove}
            onPointerUp={onDividerPointerUp}
            onDoubleClick={() => {
              setSplitRatio(0.5)
              localStorage.setItem(SPLIT_KEY, '0.5')
            }}
          >
            <span className="h-8 w-0.5 rounded bg-neutral-700" />
          </div>
        )}
        {showWork && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center overflow-x-auto border-b border-neutral-800 px-2" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex min-h-10 items-center gap-1.5 border-b-2 px-3 py-2 text-xs whitespace-nowrap',
                    tab === t.id
                      ? 'border-amber-500 font-medium text-amber-300'
                      : 'border-transparent text-neutral-400 hover:text-neutral-200',
                  )}
                >
                  <Icon name={t.icon} className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {tab === 'notes' && (
                <NotesPane
                  item={item}
                  onPageLink={goToPage}
                  insertPage={insertPage}
                  onInsertHandled={() => setInsertPage(null)}
                />
              )}
              {tab === 'code' && <CodePane item={item} />}
              {tab === 'cards' && <CardsPane item={item} />}
              {tab === 'lab' && <EvidencePane key={item.id} item={item} />}
              {tab === 'info' && <InfoPane item={item} collection={collection} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
