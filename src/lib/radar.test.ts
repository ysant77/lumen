import { describe, expect, it } from 'vitest'
import { DEFAULT_TOPICS, extractArxivId, mapWork, reconstructAbstract } from './radar'

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

  it('ships sensible default topics for the roadmap gaps', () => {
    expect(DEFAULT_TOPICS.length).toBeGreaterThanOrEqual(5)
    expect(new Set(DEFAULT_TOPICS.map((t) => t.id)).size).toBe(DEFAULT_TOPICS.length)
    for (const t of DEFAULT_TOPICS) {
      expect(t.query.length).toBeGreaterThan(5)
      expect(t.days).toBeGreaterThan(0)
    }
  })
})
