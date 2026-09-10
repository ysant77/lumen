import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getItem } from '../lib/catalog'
import { useData } from '../store/data'
import { useTimer } from '../store/timer'
import PdfReader from '../components/PdfReader'
import NotesPane from '../components/NotesPane'
import CodePane from '../components/CodePane'
import CardsPane from '../components/CardsPane'
import InfoPane from '../components/InfoPane'
import { Icon, StatusSelect, cn } from '../components/ui'

type Tab = 'notes' | 'code' | 'cards' | 'info'
type LayoutMode = 'split' | 'reader' | 'work'

const TABS: Array<{ id: Tab; label: string; icon: string }> = [
  { id: 'notes', label: 'Notes', icon: 'note' },
  { id: 'code', label: 'Code', icon: 'code' },
  { id: 'cards', label: 'Cards', icon: 'cards' },
  { id: 'info', label: 'Info', icon: 'info' },
]

export default function Workspace() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const found = id ? getItem(id) : undefined
  const progress = useData((s) => (id ? s.progress[id] : undefined))
  const setStatus = useData((s) => s.setStatus)
  const attach = useTimer((s) => s.attach)
  const [tab, setTab] = useState<Tab>('notes')
  const [layout, setLayout] = useState<LayoutMode>(() =>
    window.innerWidth < 900 ? 'reader' : 'split',
  )

  useEffect(() => {
    if (id) attach(id)
  }, [id, attach])

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

  const showReader = layout !== 'work'
  const showWork = layout !== 'reader'

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-800 px-4 py-2">
        <Link
          to={`/library/${collection.id}`}
          className="flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-300"
        >
          <Icon name="chevron" className="h-3.5 w-3.5 rotate-180" />
          {collection.title}
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-100" title={item.title}>
          <span className="text-amber-400">{item.shortName}</span>
          <span className="mx-2 text-neutral-700">·</span>
          <span className="font-normal text-neutral-300">{item.title}</span>
        </h1>
        <div className="flex items-center gap-2">
          {progress?.lastPage && progress.totalPages && (
            <span className="hidden font-mono text-[11px] text-neutral-500 sm:inline">
              p.{progress.lastPage}/{progress.totalPages}
            </span>
          )}
          <StatusSelect value={status} onChange={(s) => setStatus(id, s)} />
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
                  'px-2 py-1 text-[11px]',
                  layout === m ? 'bg-neutral-800 text-amber-300' : 'text-neutral-500 hover:text-neutral-300',
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {/* mobile toggle */}
          <button
            className="rounded-md border border-neutral-800 px-2 py-1 text-[11px] text-neutral-400 md:hidden"
            onClick={() => setLayout(layout === 'reader' ? 'work' : 'reader')}
          >
            {layout === 'reader' ? 'Workspace' : 'Reader'}
          </button>
        </div>
      </div>

      {/* body */}
      <div className="flex min-h-0 flex-1">
        {showReader && (
          <div className={cn('min-w-0', showWork ? 'hidden flex-1 border-r border-neutral-800 md:block' : 'flex-1')}>
            <PdfReader itemId={id} pdfFile={item.pdfFile} />
          </div>
        )}
        {showWork && (
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center border-b border-neutral-800 px-2">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    'flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs',
                    tab === t.id
                      ? 'border-amber-500 font-medium text-amber-300'
                      : 'border-transparent text-neutral-500 hover:text-neutral-300',
                  )}
                >
                  <Icon name={t.icon} className="h-3.5 w-3.5" />
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {tab === 'notes' && <NotesPane item={item} />}
              {tab === 'code' && <CodePane item={item} />}
              {tab === 'cards' && <CardsPane item={item} />}
              {tab === 'info' && <InfoPane item={item} collection={collection} />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
