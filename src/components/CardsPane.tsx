import { useMemo, useState } from 'react'
import type { CatalogItem, Flashcard } from '../types'
import { useData } from '../store/data'
import { newSrsState, isDue, isNew } from '../lib/srs'
import { Markdown } from './Markdown'
import { Button, Chip, EmptyState, Icon } from './ui'
import ReviewSession from './ReviewSession'
import starterDecks from '../data/starter-decks.json'

const starters = starterDecks as Record<string, Array<{ front: string; back: string }>>

export default function CardsPane({ item }: { item: CatalogItem }) {
  const deckRaw = useData((s) => s.decks[item.id])
  const deck = useMemo(() => deckRaw ?? [], [deckRaw])
  const saveDeck = useData((s) => s.saveDeck)
  const [front, setFront] = useState('')
  const [back, setBack] = useState('')
  const [adding, setAdding] = useState(false)
  const [reviewing, setReviewing] = useState(false)

  const due = useMemo(() => deck.filter((c) => isDue(c)), [deck])
  const starter = starters[item.id]

  const addCard = () => {
    if (!front.trim() || !back.trim()) return
    const now = new Date().toISOString()
    const card: Flashcard = {
      id: crypto.randomUUID(),
      front: front.trim(),
      back: back.trim(),
      createdAt: now,
      updatedAt: now,
      srs: newSrsState(),
    }
    saveDeck(item.id, [...deck, card])
    setFront('')
    setBack('')
  }

  const importStarter = () => {
    const now = new Date().toISOString()
    const cards: Flashcard[] = starter.map((s) => ({
      id: crypto.randomUUID(),
      front: s.front,
      back: s.back,
      createdAt: now,
      updatedAt: now,
      srs: newSrsState(),
    }))
    saveDeck(item.id, [...deck, ...cards])
  }

  const removeCard = (id: string) => {
    saveDeck(
      item.id,
      deck.filter((c) => c.id !== id),
    )
  }

  if (reviewing) {
    return (
      <ReviewSession
        cards={due.map((c) => ({ itemId: item.id, card: c }))}
        onDone={() => setReviewing(false)}
      />
    )
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip>{deck.length} cards</Chip>
        <Chip className={due.length ? 'border-amber-700 text-amber-400' : undefined}>
          {due.length} due
        </Chip>
        <Chip>{deck.filter(isNew).length} new</Chip>
        <div className="ml-auto flex gap-2">
          {starter && deck.length === 0 && (
            <Button onClick={importStarter}>
              <Icon name="download" className="h-3.5 w-3.5" /> Add {starter.length} starter cards
            </Button>
          )}
          <Button variant="primary" disabled={due.length === 0} onClick={() => setReviewing(true)}>
            <Icon name="cards" className="h-3.5 w-3.5" /> Review due
          </Button>
        </div>
      </div>

      {/* add card */}
      <div className="rounded-lg border border-neutral-800 p-3">
        <button
          className="flex w-full items-center gap-2 text-left text-xs font-medium text-neutral-400"
          onClick={() => setAdding(!adding)}
        >
          <Icon name="plus" className="h-3.5 w-3.5" />
          New card <span className="text-neutral-600">(markdown + $\LaTeX$)</span>
        </button>
        {adding && (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div>
              <textarea
                value={front}
                onChange={(e) => setFront(e.target.value)}
                placeholder="Front — e.g. State the scaled dot-product attention formula"
                rows={3}
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-2 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
              />
              {front && <Markdown className="mt-1 rounded bg-neutral-900/60 p-2 text-xs">{front}</Markdown>}
            </div>
            <div>
              <textarea
                value={back}
                onChange={(e) => setBack(e.target.value)}
                placeholder={'Back — e.g. $$\\mathrm{softmax}(QK^\\top/\\sqrt{d_k})V$$'}
                rows={3}
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 p-2 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
              />
              {back && <Markdown className="mt-1 rounded bg-neutral-900/60 p-2 text-xs">{back}</Markdown>}
            </div>
            <div className="md:col-span-2">
              <Button variant="primary" onClick={addCard} disabled={!front.trim() || !back.trim()}>
                Add card
              </Button>
            </div>
          </div>
        )}
      </div>

      {deck.length === 0 ? (
        <EmptyState title="No cards yet">
          Turn formulas, definitions and derivations from this paper into cards — they surface in
          Review when due.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {deck.map((c) => (
            <li key={c.id} className="group rounded-lg border border-neutral-800 p-3">
              <div className="flex items-start justify-between gap-2">
                <Markdown className="text-xs">{c.front}</Markdown>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-[10px] text-neutral-600">
                    {isDue(c) ? 'due now' : `due ${new Date(c.srs.due).toLocaleDateString()}`}
                  </span>
                  <button
                    onClick={() => removeCard(c.id)}
                    className="text-neutral-700 opacity-0 group-hover:opacity-100 hover:text-red-400"
                    title="Delete card"
                  >
                    <Icon name="trash" className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-2 border-t border-neutral-800/70 pt-2">
                <Markdown className="text-xs opacity-80">{c.back}</Markdown>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
