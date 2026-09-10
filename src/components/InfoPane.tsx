import type { CatalogItem, Collection } from '../types'
import { Chip, Icon } from './ui'

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value == null || value === '') return null
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 text-xs">
      <span className="text-neutral-500">{label}</span>
      <span className="text-neutral-300">{value}</span>
    </div>
  )
}

export default function InfoPane({ item, collection }: { item: CatalogItem; collection: Collection }) {
  const relevance = item.relevance
    ? Object.entries(item.relevance).filter(([, v]) => v != null && Number(v) > 0)
    : []
  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4">
      <div>
        <h2 className="text-sm leading-snug font-semibold text-neutral-100">{item.title}</h2>
        <p className="mt-1 text-xs text-neutral-500">
          {[item.authors, item.year].filter(Boolean).join(' · ')}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {item.priority && <Chip className="border-amber-800 text-amber-400">{item.priority}</Chip>}
        {item.difficulty && <Chip>{item.difficulty}</Chip>}
        {item.readDepth && <Chip>{item.readDepth}</Chip>}
        {(item.category ?? item.resourceType) && <Chip>{item.category ?? item.resourceType}</Chip>}
        {item.domain && <Chip>{item.domain}</Chip>}
        {relevance.map(([k, v]) => (
          <Chip key={k} className="border-sky-900 text-sky-400">
            {k}: {v}/3
          </Chip>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <Row label="Collection" value={collection.title} />
        <Row label="Phase" value={item.phase} />
        <Row label="Effort" value={item.effort} />
        <Row label="Focus" value={item.focus} />
      </div>

      {item.why && (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
            Why it matters
          </h3>
          <p className="text-xs leading-relaxed text-neutral-300">{item.why}</p>
        </section>
      )}

      {item.exercise && (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
            Hands-on exercise
          </h3>
          <p className="rounded-md border border-amber-900/50 bg-amber-500/5 p-2.5 text-xs leading-relaxed text-amber-200/90">
            {item.exercise}
          </p>
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h3 className="text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">Links</h3>
        {item.pageUrl && (
          <a
            href={item.pageUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:underline"
          >
            <Icon name="external" className="h-3.5 w-3.5" /> Source page
          </a>
        )}
        {item.pdfUrl && item.pdfUrl !== item.pageUrl && (
          <a
            href={item.pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs text-amber-400 hover:underline"
          >
            <Icon name="file" className="h-3.5 w-3.5" /> PDF / companion
          </a>
        )}
        {item.pdfFile && (
          <p className="text-[11px] text-neutral-600">
            local file: <code>{item.pdfFile}</code>
          </p>
        )}
      </section>
    </div>
  )
}
