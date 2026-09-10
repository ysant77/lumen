import { useState } from 'react'
import { Link } from 'react-router-dom'
import { catalog } from '../lib/catalog'
import { useData } from '../store/data'
import { Chip, Icon, cn } from '../components/ui'
import roadmapRaw from '../data/roadmap.json'

interface RoadmapData {
  collections: Record<string, { phases: Array<{ name: string; purpose: string }>; guidance: string[] }>
  capstones: Record<string, Array<Record<string, string | number>>>
  missionRefs: Array<Record<string, string | number>>
  starterWindows: Array<Record<string, string | number>>
}
const roadmap = roadmapRaw as unknown as RoadmapData

const CAPSTONE_LABELS: Record<string, string> = { cv: 'CV / SAR capstones', reg: 'Regulated AI capstones' }

function Table({ rows, columns }: { rows: Array<Record<string, string | number>>; columns: string[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-800">
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-neutral-800 bg-neutral-900/60">
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium whitespace-nowrap text-neutral-400">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-neutral-800/60 align-top last:border-0">
              {columns.map((c) => (
                <td key={c} className="px-3 py-2 text-neutral-300">
                  {c === 'URL' && r[c] ? (
                    <a href={String(r[c])} target="_blank" rel="noreferrer" className="text-amber-400 hover:underline">
                      link <Icon name="external" className="inline h-3 w-3 align-[-2px]" />
                    </a>
                  ) : (
                    (r[c] ?? '')
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Roadmap() {
  const progress = useData((s) => s.progress)
  const [openGuide, setOpenGuide] = useState<string | null>('llm')

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-lg font-semibold text-neutral-100">Roadmap</h1>
        <p className="mt-1 text-xs text-neutral-400">
          The workbook guidance behind the catalog: how to sequence phases, what each phase is for,
          and the capstones that turn reading into evidence. Progress lives in the{' '}
          <Link to="/library" className="text-amber-400 underline">
            Library
          </Link>
          ; evidence per paper lives in each workspace's Evidence tab.
        </p>
      </div>

      {/* per-collection guidance */}
      <section aria-label="Collection guidance" className="flex flex-col gap-3">
        {catalog.collections.map((c) => {
          const guide = roadmap.collections[c.id]
          if (!guide) return null
          const done = c.items.filter((i) => progress[i.id]?.status === 'done').length
          const open = openGuide === c.id
          return (
            <div key={c.id} className="rounded-xl border border-neutral-800">
              <button
                className="flex w-full items-center gap-2 px-4 py-3 text-left"
                onClick={() => setOpenGuide(open ? null : c.id)}
                aria-expanded={open}
              >
                <Icon name={c.icon} className="h-4 w-4 shrink-0 text-amber-400/80" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-200">{c.title}</span>
                <Chip>
                  {done}/{c.items.length}
                </Chip>
                <Icon name="chevron" className={cn('h-4 w-4 text-neutral-500 transition-transform', open && 'rotate-90')} />
              </button>
              {open && (
                <div className="border-t border-neutral-800 px-4 py-3">
                  {guide.guidance.length > 0 && (
                    <>
                      <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
                        How to use
                      </h3>
                      <ul className="mb-3 flex list-disc flex-col gap-1 pl-4 text-xs leading-relaxed text-neutral-300">
                        {guide.guidance.map((g) => (
                          <li key={g}>{g}</li>
                        ))}
                      </ul>
                    </>
                  )}
                  {guide.phases.length > 0 && (
                    <>
                      <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
                        Phases
                      </h3>
                      <ul className="flex flex-col gap-1">
                        {guide.phases.map((p) => (
                          <li key={p.name} className="text-xs">
                            <Link
                              to={`/library/${c.id}`}
                              className="font-medium text-neutral-200 hover:text-amber-300"
                            >
                              {p.name}
                            </Link>
                            <span className="text-neutral-400"> — {p.purpose}</span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* capstones */}
      {Object.entries(roadmap.capstones).map(([cid, caps]) =>
        caps.length ? (
          <section key={cid} aria-label={CAPSTONE_LABELS[cid]}>
            <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
              {CAPSTONE_LABELS[cid] ?? `${cid} capstones`}
            </h2>
            <div className="grid gap-2 md:grid-cols-2">
              {caps.map((cap, i) => (
                <div key={i} className="rounded-lg border border-neutral-800 p-3">
                  <p className="text-xs font-semibold text-amber-300">
                    {cap['#'] ?? i + 1}. {cap['Capstone']}
                  </p>
                  {(cap['Build'] ?? cap['Focus']) && (
                    <p className="mt-1 text-xs leading-relaxed text-neutral-300">
                      {cap['Build'] ?? cap['Focus']}
                    </p>
                  )}
                  {(cap['Suggested Inputs'] ?? cap['Data']) && (
                    <p className="mt-1.5 text-[11px] text-neutral-400">
                      <span className="text-neutral-500">Inputs: </span>
                      {cap['Suggested Inputs'] ?? cap['Data']}
                    </p>
                  )}
                  {(cap['Success Evidence'] ?? cap['Baseline Ladder']) && (
                    <p className="mt-1 rounded bg-neutral-900/70 p-1.5 text-[11px] text-emerald-300/80">
                      <span className="text-neutral-500">Evidence: </span>
                      {cap['Success Evidence'] ?? cap['Baseline Ladder']}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : null,
      )}

      {/* 16-week starter */}
      {roadmap.starterWindows.length > 0 && (
        <section aria-label="16-week starter path">
          <h2 className="mb-1 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            16-week starter path
          </h2>
          <p className="mb-2 text-[11px] text-neutral-500">
            A sequencing template, not a deadline — keeps foundations, implementation, SAR and systems moving together.
          </p>
          <Table rows={roadmap.starterWindows} columns={['Window', 'Primary Resources', 'Track', 'Focus', 'Required Output']} />
        </section>
      )}

      {/* mission references */}
      {roadmap.missionRefs.length > 0 && (
        <section aria-label="Mission references">
          <h2 className="mb-1 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            Mission / product references
          </h2>
          <p className="mb-2 text-[11px] text-neutral-500">
            Keep these open next to code — product levels, geometry and metadata semantics are part of the model.
          </p>
          <Table rows={roadmap.missionRefs} columns={['Mission', 'Reference', 'Type', 'Why Keep It Nearby', 'URL', 'Priority']} />
        </section>
      )}
    </div>
  )
}
