import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { catalog, getItem } from '../lib/catalog'
import { useData } from '../store/data'
import { useTimer, fmtClock } from '../store/timer'
import { isDue } from '../lib/srs'
import { Button, Chip, Icon, ProgressBar, cn } from '../components/ui'

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <p className="text-2xl font-semibold text-neutral-100">{value}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{label}</p>
      {sub && <p className="text-[11px] text-neutral-600">{sub}</p>}
    </div>
  )
}

function FocusCard() {
  const timer = useTimer()
  const itemLabel = timer.itemId ? (getItem(timer.itemId)?.item.shortName ?? '') : ''
  return (
    <div className="flex flex-col rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-400">
          {timer.mode === 'focus' ? 'Focus session' : 'Break'}
          {itemLabel && timer.mode === 'focus' && (
            <span className="ml-1.5 text-neutral-600">· {itemLabel}</span>
          )}
        </span>
        <div className="flex items-center gap-1 text-[11px] text-neutral-600">
          <input
            type="number"
            min={5}
            max={120}
            value={timer.focusMinutes}
            onChange={(e) => timer.setDurations(Number(e.target.value) || 25, timer.breakMinutes)}
            className="w-12 rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 text-center"
          />
          <span>min /</span>
          <input
            type="number"
            min={1}
            max={60}
            value={timer.breakMinutes}
            onChange={(e) => timer.setDurations(timer.focusMinutes, Number(e.target.value) || 5)}
            className="w-10 rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 text-center"
          />
          <span>brk</span>
        </div>
      </div>
      <p
        className={cn(
          'my-3 text-center font-mono text-5xl font-light tabular-nums',
          timer.mode === 'focus' ? 'text-amber-300' : 'text-sky-300',
        )}
      >
        {fmtClock(timer.secondsLeft)}
      </p>
      <div className="flex justify-center gap-2">
        {!timer.running && timer.startedAt == null && (
          <Button variant="primary" onClick={() => timer.start()}>
            <Icon name="play" className="h-3.5 w-3.5" /> Start
          </Button>
        )}
        {timer.running && (
          <Button onClick={() => timer.pause()}>
            <Icon name="pause" className="h-3.5 w-3.5" /> Pause
          </Button>
        )}
        {!timer.running && timer.startedAt != null && (
          <Button variant="primary" onClick={() => timer.resume()}>
            <Icon name="play" className="h-3.5 w-3.5" /> Resume
          </Button>
        )}
        {timer.startedAt != null && (
          <>
            <Button onClick={() => timer.skip()}>finish</Button>
            <Button variant="ghost" onClick={() => timer.reset()}>
              reset
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const progress = useData((s) => s.progress)
  const decks = useData((s) => s.decks)
  const sessions = useData((s) => s.sessions)

  const stats = useMemo(() => {
    const all = catalog.collections.flatMap((c) => c.items)
    const done = all.filter((i) => progress[i.id]?.status === 'done').length
    const active = all.filter(
      (i) => progress[i.id]?.status === 'reading' || progress[i.id]?.status === 'implementing',
    )
    const dueCards = Object.values(decks)
      .flat()
      .filter((c) => isDue(c)).length
    const weekAgo = Date.now() - 7 * 864e5
    const focusMin = sessions
      .filter((s) => s.kind === 'focus' && new Date(s.endedAt).getTime() > weekAgo)
      .reduce((acc, s) => acc + s.minutes, 0)
    const recent = [...active].sort((a, b) =>
      (progress[b.id]?.updatedAt ?? '').localeCompare(progress[a.id]?.updatedAt ?? ''),
    )
    return { total: all.length, done, active: active.length, dueCards, focusMin, recent: recent.slice(0, 6) }
  }, [progress, decks, sessions])

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-100">Dashboard</h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="papers done" value={stats.done} sub={`of ${stats.total}`} />
        <Stat label="in progress" value={stats.active} />
        <Stat label="cards due" value={stats.dueCards} />
        <Stat label="focus min · 7d" value={stats.focusMin} />
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <FocusCard />

        <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-neutral-400">Review queue</span>
            <Chip className={stats.dueCards ? 'border-amber-700 text-amber-400' : undefined}>
              {stats.dueCards} due
            </Chip>
          </div>
          <p className="mb-3 text-xs text-neutral-500">
            Spaced repetition (FSRS) across all paper decks — formulas, definitions, derivations.
          </p>
          <Link to="/review">
            <Button variant="primary" disabled={stats.dueCards === 0}>
              <Icon name="cards" className="h-3.5 w-3.5" /> Review now
            </Button>
          </Link>
        </div>
      </div>

      {/* continue reading */}
      <section className="mt-6">
        <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
          Continue
        </h2>
        {stats.recent.length === 0 ? (
          <p className="text-xs text-neutral-600">
            Nothing in progress —{' '}
            <Link to="/library" className="text-amber-400 underline">
              pick a paper
            </Link>{' '}
            and set it to “Reading”.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {stats.recent.map((it) => {
              const p = progress[it.id]
              return (
                <li key={it.id}>
                  <Link
                    to={`/paper/${it.id}`}
                    className="flex items-center gap-3 rounded-lg border border-neutral-800 px-3 py-2 hover:bg-neutral-900/60"
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        p?.status === 'implementing' ? 'bg-sky-400' : 'bg-amber-400',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      <span className="font-medium text-neutral-200">{it.shortName}</span>
                      <span className="mx-1.5 text-neutral-700">·</span>
                      <span className="text-neutral-400">{it.title}</span>
                    </span>
                    {p?.lastPage && p.totalPages && (
                      <span className="shrink-0 font-mono text-[10px] text-neutral-600">
                        p.{p.lastPage}/{p.totalPages}
                      </span>
                    )}
                    {p?.lastPage && p.totalPages && (
                      <ProgressBar value={p.lastPage} max={p.totalPages} className="w-16 shrink-0" />
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* collection overview */}
      <section className="mt-6">
        <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
          Collections
        </h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {catalog.collections.map((c) => {
            const done = c.items.filter((i) => progress[i.id]?.status === 'done').length
            return (
              <Link
                key={c.id}
                to={`/library/${c.id}`}
                className="rounded-lg border border-neutral-800 p-3 hover:bg-neutral-900/60"
              >
                <div className="flex items-center gap-2">
                  <Icon name={c.icon} className="h-4 w-4 text-amber-400/80" />
                  <span className="flex-1 truncate text-[13px] font-medium text-neutral-200">
                    {c.title}
                  </span>
                  <span className="text-[11px] text-neutral-500">
                    {done}/{c.items.length}
                  </span>
                </div>
                <ProgressBar value={done} max={c.items.length} className="mt-2" />
              </Link>
            )
          })}
        </div>
      </section>
    </div>
  )
}
