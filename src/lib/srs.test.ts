import { describe, expect, it } from 'vitest'
import { GRADE_LABELS, Rating, gradeCard, isDue, newSrsState, previewIntervals } from './srs'
import type { Flashcard } from '../types'

function card(srs = newSrsState()): Flashcard {
  const now = new Date().toISOString()
  return { id: 'c1', front: 'f', back: 'b', createdAt: now, updatedAt: now, srs }
}

describe('srs (FSRS wrapper)', () => {
  it('new cards are due immediately', () => {
    expect(isDue(card())).toBe(true)
  })

  it('grading Good pushes the due date into the future', () => {
    const now = new Date()
    const next = gradeCard(newSrsState(now), Rating.Good, now)
    expect(new Date(next.due).getTime()).toBeGreaterThan(now.getTime())
    expect(next.reps).toBe(1)
  })

  it('Again schedules sooner than Easy', () => {
    const now = new Date()
    const again = gradeCard(newSrsState(now), Rating.Again, now)
    const easy = gradeCard(newSrsState(now), Rating.Easy, now)
    expect(new Date(again.due).getTime()).toBeLessThan(new Date(easy.due).getTime())
  })

  it('survives a serialize/deserialize round-trip across reviews', () => {
    const now = new Date()
    let srs = newSrsState(now)
    srs = gradeCard(srs, Rating.Good, now)
    const later = new Date(new Date(srs.due).getTime() + 60_000)
    srs = gradeCard(JSON.parse(JSON.stringify(srs)), Rating.Good, later)
    expect(srs.reps).toBe(2)
    expect(new Date(srs.due).getTime()).toBeGreaterThan(later.getTime())
  })

  it('previews an interval for every grade', () => {
    const p = previewIntervals(newSrsState())
    for (const g of GRADE_LABELS) {
      expect(p[g.rating]).toMatch(/^\d+(\.\d+)?(m|h|d|mo|y)$/)
    }
  })
})
