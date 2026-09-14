import { describe, expect, it } from 'vitest'
import { DEFAULT_TOPICS, dedupePapers, extractArxivId, mapWork, reconstructAbstract } from './radar'
import type { RadarPaper } from '../types'

const paper = (over: Partial<RadarPaper>): RadarPaper => ({
  id: 'W1',
  title: 'A Paper',
  abstract: null,
  date: '2026-09-01',
  venue: null,
  authors: [],
  landingUrl: null,
  doi: null,
  arxivId: null,
  citedBy: 0,
  ...over,
})

describe('radar (OpenAlex client)', () => {
  it('reconstructs abstracts from inverted indexes', () => {
    expect(
      reconstructAbstract({ Deep: [0], learning: [1], is: [2], fun: [3], and: [4], deep: [5] }),
    ).toBe('Deep learning is fun and deep')
    expect(reconstructAbstract(null)).toBeNull()
    expect(reconstructAbstract({})).toBeNull()
  })

  it('extracts arXiv ids from any location URL, including versions', () => {
    expect(extractArxivId('https://arxiv.org/abs/2412.14123')).toBe('2412.14123')
    expect(extractArxivId('https://arxiv.org/pdf/2412.14123v2')).toBe('2412.14123')
    expect(extractArxivId(null, undefined, 'https://doi.org/10.1234/x')).toBeNull()
    expect(extractArxivId('https://doi.org/x', 'http://arxiv.org/abs/1706.03762v5')).toBe('1706.03762')
  })

  it('maps OpenAlex works, preferring the arXiv landing page', () => {
    const paper = mapWork({
      id: 'https://openalex.org/W123',
      display_name: 'A Paper',
      publication_date: '2026-09-01',
      doi: 'https://doi.org/10.48550/arXiv.2509.00001',
      cited_by_count: 3,
      abstract_inverted_index: { Hello: [0], world: [1] },
      primary_location: {
        landing_page_url: 'https://arxiv.org/abs/2509.00001',
        pdf_url: null,
        source: { display_name: 'arXiv' },
      },
      locations: [],
      authorships: [{ author: { display_name: 'A. Author' } }, { author: null }],
    })
    expect(paper).toMatchObject({
      id: 'W123',
      arxivId: '2509.00001',
      abstract: 'Hello world',
      venue: 'arXiv',
      authors: ['A. Author'],
      landingUrl: 'https://arxiv.org/abs/2509.00001',
    })
  })

  it('REGRESSION: collapses the same paper indexed multiple times with different dates', () => {
    const out = dedupePapers([
      paper({ id: 'W1', title: 'ToshLLM: A Domain Model', date: '2026-09-08', citedBy: 1 }),
      paper({ id: 'W2', title: 'ToshLLM: a domain model.', date: '2026-09-02', arxivId: '2609.00001', citedBy: 4 }),
      paper({ id: 'W3', title: 'ToshLLM — A Domain Model', date: '2026-08-30', venue: 'arXiv' }),
      paper({ id: 'W4', title: 'A Different Paper', date: '2026-09-01' }),
    ])
    expect(out).toHaveLength(2)
    const tosh = out[0]
    expect(tosh.date).toBe('2026-09-08') // newest date shown
    expect(tosh.arxivId).toBe('2609.00001') // enriched from the duplicate
    expect(tosh.landingUrl).toBe('https://arxiv.org/abs/2609.00001')
    expect(tosh.venue).toBe('arXiv')
    expect(tosh.citedBy).toBe(4) // max across duplicates
    expect(out[1].title).toBe('A Different Paper')
  })

  it('dedupe keeps distinct papers and preserves date-desc order', () => {
    const out = dedupePapers([
      paper({ id: 'W1', title: 'Alpha', date: '2026-09-09' }),
      paper({ id: 'W2', title: 'Beta', date: '2026-09-08' }),
      paper({ id: 'W3', title: 'Gamma', date: '2026-09-07' }),
    ])
    expect(out.map((p) => p.title)).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('dedupe falls back to work id for untitled entries (no accidental merging)', () => {
    const out = dedupePapers([
      paper({ id: 'W1', title: '—' }),
      paper({ id: 'W2', title: '…' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('ships sensible default topics for the roadmap gaps', () => {
    expect(DEFAULT_TOPICS.length).toBeGreaterThanOrEqual(5)
    expect(new Set(DEFAULT_TOPICS.map((t) => t.id)).size).toBe(DEFAULT_TOPICS.length)
    for (const t of DEFAULT_TOPICS) {
      expect(t.query.length).toBeGreaterThan(5)
      expect(t.days).toBeGreaterThan(0)
    }
  })
})
