import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { catalog, getItem } from '../lib/catalog'
import { useData } from '../store/data'
import { useTimer, fmtClock } from '../store/timer'
import { getSyncConfig } from '../lib/sync'
import { isDue } from '../lib/srs'
import { Button, Chip, Icon, ProgressBar, cn } from '../components/ui'

const dayKey = (d: Date) => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

/** streak = consecutive days (ending today or yesterday) with a completed focus session */
function computeStreak(days: Set<string>): number {
  let streak = 0
  const cursor = new Date()
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (days.has(dayKey(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }
  return streak
}

function heatTone(minutes: number): string {
  if (minutes <= 0) return 'bg-neutral-800/60'
  if (minutes < 15) return 'bg-amber-900/70'
  if (minutes < 40) return 'bg-amber-700'
  if (minutes < 90) return 'bg-amber-500'
  return 'bg-amber-300'
}

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

function OnboardingCard() {
  const pdfs = useData((s) => s.pdfsAvailable)
  const progress = useData((s) => s.progress)
  const sessions = useData((s) => s.sessions)
  const steps = [
    { done: pdfs.size > 0, label: 'Import your PDF library', to: '/settings' },
    { done: !!getSyncConfig(), label: 'Connect GitHub sync', to: '/settings' },
    {
      done: Object.values(progress).some((p) => p.status !== 'not-started'),
      label: 'Start your first paper',
      to: '/library',
    },
    { done: sessions.some((s) => s.kind === 'focus'), label: 'Finish one focus session', to: '/' },
  ]
  if (steps.every((s) => s.done)) return null
  return (
    <div className="mb-4 rounded-xl border border-amber-900/40 bg-amber-500/5 p-4">
      <p className="mb-2 text-xs font-semibold text-amber-300">Getting set up</p>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.label}>
            <Link
              to={s.to}
              className={cn(
                'flex items-center gap-2 text-xs',
                s.done ? 'text-neutral-600 line-through' : 'text-neutral-300 hover:text-amber-300',
              )}
            >
              <span
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded-full border',
                  s.done ? 'border-emerald-700 text-emerald-500' : 'border-neutral-700',
                )}
              >
                {s.done && <Icon name="check" className="h-2.5 w-2.5" />}
              </span>
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StreakCard({ sessions }: { sessions: ReturnType<typeof useData.getState>['sessions'] }) {
  const { streak, weeks, totalHours } = useMemo(() => {
    const minutesByDay = new Map<string, number>()
    let total = 0
    for (const s of sessions) {
      if (s.kind !== 'focus') continue
      const k = dayKey(new Date(s.endedAt))
      minutesByDay.set(k, (minutesByDay.get(k) ?? 0) + s.minutes)
      total += s.minutes
    }
    const streak = computeStreak(new Set(minutesByDay.keys()))
    // 12 weeks x 7 days, oldest week first, aligned so the last cell is today
    const weeks: Array<Array<{ key: string; min: number }>> = []
    const start = new Date()
    start.setDate(start.getDate() - (7 * 12 - 1))
    for (let w = 0; w < 12; w++) {
      const col: Array<{ key: string; min: number }> = []
      for (let d = 0; d < 7; d++) {
        const dt = new Date(start)
        dt.setDate(start.getDate() + w * 7 + d)
        const k = dayKey(dt)
        col.push({ key: k, min: minutesByDay.get(k) ?? 0 })
      }
      weeks.push(col)
    }
    return { streak, weeks, totalHours: Math.round(total / 6) / 10 }
  }, [sessions])

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-neutral-400">Focus rhythm · 12 weeks</span>
        <span className="flex items-center gap-1.5 text-xs">
          <Icon name="flame" className={cn('h-4 w-4', streak > 0 ? 'text-amber-400' : 'text-neutral-700')} />
          <span className={streak > 0 ? 'font-semibold text-amber-300' : 'text-neutral-600'}>
            {streak} day{streak === 1 ? '' : 's'}
          </span>
        </span>
      </div>
      <div className="flex justify-between gap-[3px]">
        {weeks.map((col, i) => (
          <div key={i} className="flex flex-1 flex-col gap-[3px]">
            {col.map((d) => (
              <div
                key={d.key}
                title={`${d.key}: ${d.min} min`}
                className={cn('aspect-square w-full rounded-[3px]', heatTone(d.min))}
              />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-neutral-600">{totalHours} focused hours logged in total</p>
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
    // gentle suggestions: the next untouched Core paper per collection
    const upNext = catalog.collections
      .map((c) =>
        c.items.find(
          (i) => i.priority === 'Core' && (progress[i.id]?.status ?? 'not-started') === 'not-started',
        ),
      )
      .filter((i): i is NonNullable<typeof i> => !!i)
      .slice(0, 3)
    return {
      total: all.length,
      done,
      active: active.length,
      dueCards,
      focusMin,
      recent: recent.slice(0, 6),
      upNext,
    }
  }, [progress, decks, sessions])

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <h1 className="mb-4 text-lg font-semibold text-neutral-100">Dashboard</h1>

      <OnboardingCard />

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

      <div className="mt-3">
        <StreakCard sessions={sessions} />
      </div>

      {stats.upNext.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
            Suggested next · Core
          </h2>
          <div className="flex flex-wrap gap-1.5">
            {stats.upNext.map((it) => (
              <Link
                key={it.id}
                to={`/paper/${it.id}`}
                className="rounded-full border border-neutral-800 px-3 py-1.5 text-xs text-neutral-300 hover:border-amber-700 hover:text-amber-300"
              >
                {it.shortName} <span className="text-neutral-600">· {it.phase.replace(/^\d+\.\s*/, '')}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

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
