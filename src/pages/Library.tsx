import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { useData } from '../store/data'
import type { CatalogItem, ItemStatus } from '../types'
import { Chip, Icon, ProgressBar, StatusSelect, cn } from '../components/ui'

const PRIORITY_TONE: Record<string, string> = {
  Core: 'border-amber-800 text-amber-400',
  Important: 'border-sky-900 text-sky-400',
}

function ItemRow({ item }: { item: CatalogItem }) {
  const navigate = useNavigate()
  const progress = useData((s) => s.progress[item.id])
  const setStatus = useData((s) => s.setStatus)
  const hasPdf = useData((s) => (item.pdfFile ? s.pdfsAvailable.has(item.pdfFile) : false))
  const status = progress?.status ?? 'not-started'

  return (
    <li
      className={cn(
        'group flex cursor-pointer items-center gap-3 rounded-lg border border-transparent px-3 py-2',
        'hover:border-neutral-800 hover:bg-neutral-900/60',
        status === 'done' && 'opacity-60',
      )}
      onClick={() => navigate(`/paper/${item.id}`)}
    >
      <span className="w-6 shrink-0 text-right font-mono text-[11px] text-neutral-600">{item.order}</span>
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', hasPdf ? 'bg-emerald-500' : 'bg-neutral-700')}
        title={hasPdf ? 'PDF imported' : item.pdfFile ? 'PDF not imported' : 'external resource'}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-neutral-200">
          <span className="font-medium text-neutral-100">{item.shortName}</span>
          <span className="mx-1.5 text-neutral-700">·</span>
          <span className="text-neutral-400">{item.title}</span>
        </p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[11px] text-neutral-600">{item.year}</span>
          {item.priority && (
            <Chip className={PRIORITY_TONE[item.priority] ?? undefined}>{item.priority}</Chip>
          )}
          {item.difficulty && <Chip>{item.difficulty.split(' ')[0]}★</Chip>}
          {progress?.lastPage && progress.totalPages && (
            <span className="font-mono text-[10px] text-neutral-600">
              p.{progress.lastPage}/{progress.totalPages}
            </span>
          )}
        </div>
      </div>
      <span onClick={(e) => e.stopPropagation()}>
        <StatusSelect value={status} onChange={(s) => setStatus(item.id, s)} />
      </span>
    </li>
  )
}

export default function Library() {
  const { collectionId } = useParams<{ collectionId?: string }>()
  const progress = useData((s) => s.progress)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | ItemStatus>('all')
  const [coreOnly, setCoreOnly] = useState(false)

  const collection = catalog.collections.find((c) => c.id === collectionId) ?? catalog.collections[0]

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return collection.items.filter((it) => {
      if (coreOnly && it.priority !== 'Core') return false
      const st = progress[it.id]?.status ?? 'not-started'
      if (statusFilter !== 'all' && st !== statusFilter) return false
      if (q && !`${it.shortName} ${it.title} ${it.authors ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [collection, query, statusFilter, coreOnly, progress])

  const byPhase = useMemo(() => {
    const m = new Map<string, CatalogItem[]>()
    for (const it of filtered) {
      const arr = m.get(it.phase) ?? []
      arr.push(it)
      m.set(it.phase, arr)
    }
    return m
  }, [filtered])

  const doneCount = collection.items.filter((i) => progress[i.id]?.status === 'done').length

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      {/* collection tabs */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {catalog.collections.map((c) => (
          <Link
            key={c.id}
            to={`/library/${c.id}`}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs whitespace-nowrap',
              c.id === collection.id
                ? 'border-amber-700 bg-amber-500/10 text-amber-300'
                : 'border-neutral-800 text-neutral-400 hover:border-neutral-700',
            )}
          >
            <Icon name={c.icon} className="h-3.5 w-3.5" />
            {c.title}
            <span className="text-neutral-600">{c.items.length}</span>
          </Link>
        ))}
      </div>

      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">{collection.title}</h1>
        <span className="text-xs text-neutral-500">
          {doneCount}/{collection.items.length} done
        </span>
      </div>
      <p className="text-xs text-neutral-500">{collection.subtitle}</p>
      <ProgressBar value={doneCount} max={collection.items.length} className="mt-2 mb-4" />

      {/* filters */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search…"
          className="w-48 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs"
        >
          <option value="all">All statuses</option>
          <option value="not-started">Not started</option>
          <option value="reading">Reading</option>
          <option value="implementing">Implementing</option>
          <option value="done">Done</option>
          <option value="skipped">Skipped</option>
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-400">
          <input
            type="checkbox"
            checked={coreOnly}
            onChange={(e) => setCoreOnly(e.target.checked)}
            className="accent-amber-500"
          />
          Core only
        </label>
        <span className="ml-auto text-[11px] text-neutral-600">{filtered.length} shown</span>
      </div>

      {/* phases */}
      {[...byPhase.entries()].map(([phase, items]) => (
        <section key={phase} className="mb-5">
          <h2 className="mb-1.5 px-3 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
            {phase}
            <span className="ml-2 font-normal text-neutral-700 normal-case">
              {items.filter((i) => progress[i.id]?.status === 'done').length}/{items.length}
            </span>
          </h2>
          <ul className="flex flex-col">
            {items.map((it) => (
              <ItemRow key={it.id} item={it} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
