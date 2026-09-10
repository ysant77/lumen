import { describe, expect, it } from 'vitest'
import { allItems, catalog, difficultyLevel, getItem } from './catalog'

describe('catalog integrity', () => {
  it('has the four roadmap collections', () => {
    expect(catalog.collections.map((c) => c.id)).toEqual(['llm', 'cv', 'reg', 'lib'])
  })

  it('has 164 items with globally unique ids', () => {
    const items = allItems()
    expect(items).toHaveLength(164)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
  })

  it('local PDF basenames are globally unique (used as OPFS keys)', () => {
    const files = allItems()
      .map((i) => i.pdfFile)
      .filter((f): f is string => !!f)
    expect(files.length).toBeGreaterThanOrEqual(141)
    expect(new Set(files).size).toBe(files.length)
  })

  it('every item has phase, title and at least one link', () => {
    for (const item of allItems()) {
      expect(item.phase).toBeTruthy()
      expect(item.title).toBeTruthy()
      expect(item.pageUrl || item.pdfUrl).toBeTruthy()
    }
  })

  it('items resolve through the index with their collection', () => {
    const hit = getItem('llm-01')
    expect(hit?.item.shortName).toBe('Transformer')
    expect(hit?.collection.id).toBe('llm')
  })

  it('difficultyLevel parses the numeric prefix', () => {
    const hit = getItem('llm-01')!
    expect(difficultyLevel(hit.item)).toBeGreaterThanOrEqual(1)
  })
})
