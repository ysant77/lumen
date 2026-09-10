import { useCallback, useEffect, useState } from 'react'
import type { Flashcard } from '../types'
import { useData } from '../store/data'
import { GRADE_LABELS, gradeCard, previewIntervals, type Rating } from '../lib/srs'
import { Markdown } from './Markdown'
import { Button, Kbd, cn } from './ui'

export interface QueueEntry {
  itemId: string
  card: Flashcard
}

/** Shared review UI: used per-deck (CardsPane) and globally (Review page). */
export default function ReviewSession({
  cards,
  onDone,
  labelFor,
}: {
  cards: QueueEntry[]
  onDone: () => void
  labelFor?: (itemId: string) => string
}) {
  const [queue] = useState(() => [...cards].sort((a, b) => a.card.srs.due.localeCompare(b.card.srs.due)))
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [reviewed, setReviewed] = useState(0)
  const saveDeck = useData((s) => s.saveDeck)

  const entry = queue[index]

  const grade = useCallback(
    (rating: Rating) => {
      if (!entry) return
      const decks = useData.getState().decks
      const deck = decks[entry.itemId] ?? []
      const updated = deck.map((c) =>
        c.id === entry.card.id
          ? { ...c, srs: gradeCard(c.srs, rating), updatedAt: new Date().toISOString() }
          : c,
      )
      saveDeck(entry.itemId, updated)
      setReviewed((r) => r + 1)
      setFlipped(false)
      setIndex((i) => i + 1)
    },
    [entry, saveDeck],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        setFlipped(true)
      } else if (flipped && ['1', '2', '3', '4'].includes(e.key)) {
        const g = GRADE_LABELS[Number(e.key) - 1]
        grade(g.rating)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flipped, grade])

  if (!entry) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-lg font-semibold text-emerald-400">Review complete</p>
        <p className="text-sm text-neutral-400">
          {reviewed} card{reviewed === 1 ? '' : 's'} reviewed.
        </p>
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    )
  }

  const intervals = flipped ? previewIntervals(entry.card.srs) : null

  return (
    <div className="flex h-full flex-col p-4">
      <div className="mb-3 flex items-center justify-between text-xs text-neutral-500">
        <span>
          {index + 1} / {queue.length}
          {labelFor && <span className="ml-2 text-neutral-600">· {labelFor(entry.itemId)}</span>}
        </span>
        <Button variant="ghost" onClick={onDone} className="px-2 py-0.5">
          exit
        </Button>
      </div>

      <div
        className="flex min-h-0 flex-1 cursor-pointer flex-col overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900/50 p-6"
        onClick={() => setFlipped(true)}
      >
        <Markdown className="text-[15px]">{entry.card.front}</Markdown>
        {flipped && (
          <>
            <div className="my-4 border-t border-dashed border-neutral-700" />
            <Markdown className="text-[15px]">{entry.card.back}</Markdown>
          </>
        )}
        {!flipped && (
          <p className="mt-auto pt-6 text-center text-xs text-neutral-600">
            tap or press <Kbd>space</Kbd> to reveal
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        {GRADE_LABELS.map((g) => (
          <button
            key={g.rating}
            disabled={!flipped}
            onClick={() => grade(g.rating)}
            className={cn(
              'flex flex-col items-center rounded-lg border py-2 text-xs font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-30',
              g.tone,
            )}
          >
            {g.label}
            <span className="mt-0.5 font-mono text-[10px] opacity-70">
              {intervals ? intervals[g.rating] : ' '}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
