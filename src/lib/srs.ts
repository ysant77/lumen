import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card as FsrsCard } from 'ts-fsrs'
import type { Flashcard, SrsState } from '../types'

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }))

export { Rating }

export const GRADE_LABELS: Array<{ rating: Rating; label: string; key: string; tone: string }> = [
  { rating: Rating.Again, label: 'Again', key: '1', tone: 'text-red-400 border-red-900 hover:bg-red-950' },
  { rating: Rating.Hard, label: 'Hard', key: '2', tone: 'text-orange-400 border-orange-900 hover:bg-orange-950' },
  { rating: Rating.Good, label: 'Good', key: '3', tone: 'text-emerald-400 border-emerald-900 hover:bg-emerald-950' },
  { rating: Rating.Easy, label: 'Easy', key: '4', tone: 'text-sky-400 border-sky-900 hover:bg-sky-950' },
]

function serialize(card: FsrsCard): SrsState {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? card.last_review.toISOString() : undefined,
  }
}

function deserialize(s: SrsState): FsrsCard {
  return {
    due: new Date(s.due),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsed_days,
    scheduled_days: s.scheduled_days,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state as FsrsCard['state'],
    last_review: s.last_review ? new Date(s.last_review) : undefined,
  }
}

export function newSrsState(now = new Date()): SrsState {
  return serialize(createEmptyCard(now))
}

/** Apply a review grade; returns the updated SRS state. */
export function gradeCard(srs: SrsState, rating: Rating, now = new Date()): SrsState {
  const record = scheduler.repeat(deserialize(srs), now) as unknown as Record<
    number,
    { card: FsrsCard }
  >
  return serialize(record[rating].card)
}

export function isDue(card: Flashcard, now = new Date()): boolean {
  return new Date(card.srs.due).getTime() <= now.getTime()
}

export function isNew(card: Flashcard): boolean {
  return card.srs.state === State.New
}

/** Human preview of the interval each grade would produce (e.g. "3d"). */
export function previewIntervals(srs: SrsState, now = new Date()): Record<number, string> {
  const record = scheduler.repeat(deserialize(srs), now) as unknown as Record<
    number,
    { card: FsrsCard }
  >
  const out: Record<number, string> = {}
  for (const g of GRADE_LABELS) {
    const due = record[g.rating].card.due.getTime()
    out[g.rating] = humanInterval(due - now.getTime())
  }
  return out
}

function humanInterval(ms: number): string {
  const min = Math.round(ms / 60000)
  if (min < 60) return `${Math.max(min, 1)}m`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d`
  const mo = Math.round(d / 30)
  if (mo < 12) return `${mo}mo`
  return `${(d / 365).toFixed(1)}y`
}
