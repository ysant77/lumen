import { describe, expect, it } from 'vitest'
import { openAlexFilterUrl, parseRef } from './lookup'

describe('paper reference parsing (add-specific-paper)', () => {
  it('parses arXiv ids, urls and versioned forms', () => {
    expect(parseRef('2412.14123')).toEqual({ kind: 'arxiv', value: '2412.14123' })
    expect(parseRef('arXiv:2412.14123')).toEqual({ kind: 'arxiv', value: '2412.14123' })
    expect(parseRef('https://arxiv.org/abs/2412.14123v2')).toEqual({ kind: 'arxiv', value: '2412.14123' })
    expect(parseRef('https://arxiv.org/pdf/1706.03762')).toEqual({ kind: 'arxiv', value: '1706.03762' })
  })

  it('parses DOIs in bare, prefixed and url forms', () => {
    expect(parseRef('10.1038/s42254-021-00314-5')).toEqual({ kind: 'doi', value: '10.1038/s42254-021-00314-5' })
    expect(parseRef('doi:10.3390/rs9070676')).toEqual({ kind: 'doi', value: '10.3390/rs9070676' })
    expect(parseRef('https://doi.org/10.3390/rs9070676')).toEqual({ kind: 'doi', value: '10.3390/rs9070676' })
  })

  it('returns null for book titles / arbitrary urls (manual-entry path)', () => {
    expect(parseRef('Deep Learning with Python')).toBeNull()
    expect(parseRef('https://mml-book.github.io/')).toBeNull()
    expect(parseRef('')).toBeNull()
  })

  it('builds the OpenAlex filter url (arXiv ids via the 10.48550 DOI space)', () => {
    expect(openAlexFilterUrl({ kind: 'arxiv', value: '2412.14123' })).toContain(
      'filter=doi%3A10.48550%2Farxiv.2412.14123',
    )
    expect(openAlexFilterUrl({ kind: 'doi', value: '10.3390/rs9070676' })).toContain(
      'filter=doi%3A10.3390%2Frs9070676',
    )
  })
})
