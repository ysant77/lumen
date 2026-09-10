import { describe, expect, it } from 'vitest'
import roadmap from '../data/roadmap.json'
import { allItems } from './catalog'

const rm = roadmap as any

describe('roadmap.json (guidance imported from the workbooks)', () => {
  it('carries guidance + phase purposes for all four collections', () => {
    for (const cid of ['llm', 'cv', 'reg', 'lib']) {
      expect(rm.collections[cid], cid).toBeTruthy()
      expect(rm.collections[cid].phases.length, `${cid} phases`).toBeGreaterThan(3)
      expect(rm.collections[cid].guidance.length, `${cid} guidance`).toBeGreaterThan(0)
      for (const p of rm.collections[cid].phases) {
        expect(p.name).toMatch(/^\d+\./)
        expect(p.purpose.length).toBeGreaterThan(10)
      }
    }
  })

  it('imports capstones, mission references and the 16-week starter', () => {
    expect(rm.capstones.cv.length).toBeGreaterThanOrEqual(5)
    expect(rm.capstones.reg.length).toBeGreaterThanOrEqual(5)
    expect(rm.missionRefs.length).toBeGreaterThanOrEqual(5)
    expect(rm.starterWindows.length).toBe(8)
    expect(rm.starterWindows[0]['Window']).toMatch(/Weeks/)
  })

  it('id aliases are a (possibly empty) old->new map with valid targets', () => {
    expect(typeof rm.idAliases).toBe('object')
    const ids = new Set(allItems().map((i) => i.id))
    for (const [oldId, newId] of Object.entries(rm.idAliases as Record<string, string>)) {
      expect(ids.has(newId), `alias target ${newId} must exist`).toBe(true)
      expect(ids.has(oldId), `alias source ${oldId} must no longer exist`).toBe(false)
    }
  })
})

describe('stable identity separate from ordering', () => {
  it('every item has a unique slug independent of its order number', () => {
    const items = allItems()
    const slugs = items.map((i) => (i as any).slug)
    expect(slugs.every((s) => typeof s === 'string' && s.includes(':'))).toBe(true)
    expect(new Set(slugs).size).toBe(items.length)
  })
})
