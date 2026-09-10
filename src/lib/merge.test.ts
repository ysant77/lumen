import { describe, expect, it } from 'vitest'
import { mergeDocs } from './merge'

const j = (o: unknown) => JSON.stringify(o, null, 1)

describe('mergeDocs — record-level sync merge', () => {
  it('preserves distinct progress records from two devices', () => {
    const local = j({
      version: 1,
      items: {
        'llm-01': { status: 'done', updatedAt: '2026-09-10T10:00:00Z' },
        'llm-02': { status: 'reading', lastPage: 4, updatedAt: '2026-09-10T09:00:00Z' },
      },
    })
    const remote = j({
      version: 1,
      items: {
        'llm-02': { status: 'reading', lastPage: 9, updatedAt: '2026-09-10T11:00:00Z' },
        'cv-07': { status: 'implementing', updatedAt: '2026-09-10T08:00:00Z' },
      },
    })
    const res = mergeDocs('progress.json', local, remote)
    expect(res.kind).toBe('merged')
    const merged = JSON.parse((res as any).content).items
    expect(merged['llm-01'].status).toBe('done') // local-only record survives
    expect(merged['cv-07'].status).toBe('implementing') // remote-only record survives
    expect(merged['llm-02'].lastPage).toBe(9) // newer record wins per item
  })

  it('unions sessions from both devices without duplicates', () => {
    const a = { id: 'a', kind: 'focus', minutes: 25, startedAt: 'x', endedAt: '2026-09-10T10:00:00Z' }
    const b = { id: 'b', kind: 'focus', minutes: 10, startedAt: 'y', endedAt: '2026-09-10T11:00:00Z' }
    const res = mergeDocs(
      'sessions.json',
      j({ version: 1, sessions: [a] }),
      j({ version: 1, sessions: [a, b] }),
    )
    expect(res.kind).toBe('takeRemote') // local ⊆ remote -> identical after merge
    const res2 = mergeDocs(
      'sessions.json',
      j({ version: 1, sessions: [a, { ...b, id: 'c' }] }),
      j({ version: 1, sessions: [a, b] }),
    )
    expect(res2.kind).toBe('merged')
    expect(JSON.parse((res2 as any).content).sessions).toHaveLength(3)
  })

  it('merges decks per card, newest updatedAt wins', () => {
    const c1 = { id: 'c1', front: 'f', back: 'b', updatedAt: '2026-09-01T00:00:00Z' }
    const res = mergeDocs(
      'decks/llm-01.json',
      j({ version: 1, cards: [{ ...c1, back: 'local', updatedAt: '2026-09-03T00:00:00Z' }] }),
      j({ version: 1, cards: [c1, { id: 'c2', front: 'g', back: 'h', updatedAt: '2026-09-02T00:00:00Z' }] }),
    )
    expect(res.kind).toBe('merged')
    const cards = JSON.parse((res as any).content).cards
    expect(cards).toHaveLength(2)
    expect(cards.find((c: any) => c.id === 'c1').back).toBe('local')
  })

  it('keeps both versions of a conflicting note instead of overwriting', () => {
    const res = mergeDocs('notes/llm-01.md', '# local edits', '# remote edits')
    expect(res.kind).toBe('conflict')
    const c = res as Extract<typeof res, { kind: 'conflict' }>
    expect(c.conflictPath).toMatch(/^notes\/llm-01\.conflict-\d{14}\.md$/)
    expect(c.conflictContent).toBe('# remote edits')
  })

  it('keeps both versions of conflicting code docs', () => {
    const res = mergeDocs('code/cv-02.json', j({ snippets: [1] }), j({ snippets: [2] }))
    expect(res.kind).toBe('conflict')
    expect((res as any).conflictPath).toMatch(/^code\/cv-02\.conflict-\d{14}\.json$/)
  })

  it('respects custom-item tombstones across devices', () => {
    const item = { id: 'x-1', title: 't', addedAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z' }
    const res = mergeDocs(
      'custom.json',
      j({ version: 1, items: [], deleted: { 'x-1': '2026-09-05T00:00:00Z' } }), // deleted here
      j({ version: 1, items: [item], deleted: {} }), // still present there
    )
    expect(res.kind).toBe('merged')
    const merged = JSON.parse((res as any).content)
    expect(merged.items).toHaveLength(0) // deletion wins (newer than the add)
    expect(merged.deleted['x-1']).toBeTruthy()
  })

  it('takes remote when contents are identical', () => {
    expect(mergeDocs('progress.json', j({ items: {} }), j({ items: {} })).kind).toBe('takeRemote')
  })

  it('queue merges whole-doc by updatedAt', () => {
    const res = mergeDocs(
      'queue.json',
      j({ items: ['a'], updatedAt: '2026-09-10T10:00:00Z' }),
      j({ items: ['b'], updatedAt: '2026-09-10T11:00:00Z' }),
    )
    expect(res.kind).toBe('takeRemote')
  })

  it('treats unparseable structured docs as conflicts (nothing lost)', () => {
    const res = mergeDocs('progress.json', 'not-json{{{', j({ items: {} }))
    expect(res.kind).toBe('conflict')
  })
})
