import { describe, expect, it } from 'vitest'
import { pageFromScroll, scrollTopForPage } from './readerMath'
import { remapDocPath, remapKeys, remapList } from './migrate'

describe('reader position math (zoom/layout independent)', () => {
  it('reports page 1 at the top', () => {
    expect(pageFromScroll(0, 800, 1000, 12, 30)).toBe(1)
  })

  it('is stable across zoom because geometry scales together', () => {
    const gap = 12
    for (const page of [1, 3, 17, 30]) {
      for (const scale of [0.5, 1, 1.7, 3]) {
        const pageH = 1000 * scale
        const top = scrollTopForPage(page, pageH, gap, 30)
        expect(pageFromScroll(top, 800, pageH, gap, 30)).toBe(page)
      }
    }
  })

  it('clamps to document bounds', () => {
    expect(pageFromScroll(10_000_000, 800, 1000, 12, 30)).toBe(30)
    expect(pageFromScroll(-50, 800, 1000, 12, 30)).toBe(1)
    expect(pageFromScroll(0, 800, 0, 12, 0)).toBe(1)
  })

  it('round-trips scrollTopForPage -> pageFromScroll', () => {
    for (let p = 1; p <= 12; p++) {
      const top = scrollTopForPage(p, 842, 12, 12)
      expect(pageFromScroll(top, 600, 842, 12, 12)).toBe(p)
    }
  })
})

describe('id alias migration (never blind renumbering)', () => {
  it('remaps record keys and never clobbers existing data at the new id', () => {
    const { out, changed } = remapKeys(
      { 'llm-old': { a: 1 }, 'llm-02': { a: 2 } },
      { 'llm-old': 'llm-99' },
    )
    expect(changed).toBe(true)
    expect(out['llm-99']).toEqual({ a: 1 })
    expect(out['llm-02']).toEqual({ a: 2 })
    const collision = remapKeys({ old: { a: 1 }, new: { a: 2 } }, { old: 'new' })
    expect(collision.out['new']).toEqual({ a: 2 }) // existing survives
  })

  it('remaps queue lists and dedupes', () => {
    expect(remapList(['a', 'b', 'a2'], { a2: 'a' }).out).toEqual(['a', 'b'])
  })

  it('remaps per-item doc paths including conflict copies', () => {
    expect(remapDocPath('notes/llm-old.md', { 'llm-old': 'llm-99' })).toBe('notes/llm-99.md')
    expect(remapDocPath('decks/llm-old.conflict-20260910101010.json', { 'llm-old': 'llm-99' })).toBe(
      'decks/llm-99.conflict-20260910101010.json',
    )
    expect(remapDocPath('notes/untouched.md', { 'llm-old': 'llm-99' })).toBeNull()
    expect(remapDocPath('progress.json', { 'llm-old': 'llm-99' })).toBeNull()
  })
})
