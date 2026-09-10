import { useMemo, useState } from 'react'
import { useData } from '../store/data'
import { getItem } from '../lib/catalog'
import { isDue } from '../lib/srs'
import ReviewSession, { type QueueEntry } from '../components/ReviewSession'
import { EmptyState } from '../components/ui'

export default function Review() {
  const decks = useData((s) => s.decks)
  const [sessionKey, setSessionKey] = useState(0)

  const due: QueueEntry[] = useMemo(
    () =>
      Object.entries(decks).flatMap(([itemId, cards]) =>
        cards.filter((c) => isDue(c)).map((card) => ({ itemId, card })),
      ),
    // recompute when a new session starts, not on every grade
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionKey],
  )

  if (due.length === 0) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <h1 className="mb-4 text-lg font-semibold text-neutral-100">Review</h1>
        <EmptyState title="No cards due">
          Add cards from any paper's Cards tab — FSRS schedules them so you review just before you
          forget.
        </EmptyState>
      </div>
    )
  }

  return (
    <div className="mx-auto h-full max-w-2xl">
      <ReviewSession
        key={sessionKey}
        cards={due}
        onDone={() => setSessionKey((k) => k + 1)}
        labelFor={(id) => getItem(id)?.item.shortName ?? id}
      />
    </div>
  )
}
