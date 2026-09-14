import { describe, expect, it } from 'vitest'
import { buildManualItem, findDuplicateByTitle, isHttpUrl, openAlexFilterUrl, parseRef } from './lookup'

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

describe('url validation (Sources + manual Inbox entries)', () => {
  it('accepts http(s) and rejects other schemes and garbage', () => {
    expect(isHttpUrl('https://ocw.mit.edu/')).toBe(true)
    expect(isHttpUrl('http://example.org/x')).toBe(true)
    expect(isHttpUrl('javascript:alert(1)')).toBe(false)
    expect(isHttpUrl('ftp://host/file')).toBe(false)
    expect(isHttpUrl('notaurl')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('manual items — REGRESSION: unicode titles & collision-safe ids', () => {
  it('non-Latin titles get unique ids and sane short names', () => {
    const a = buildManualItem({ title: '深層学習：第2版', url: '', year: '2024', authors: '岡谷貴之' }, 1)
    const b = buildManualItem({ title: 'Глубокое обучение', url: '', year: '', authors: '' }, 2)
    expect(a.item!.id).toMatch(/^x-m-[0-9a-f-]{36}$/)
    expect(b.item!.id).toMatch(/^x-m-[0-9a-f-]{36}$/)
    expect(a.item!.id).not.toBe(b.item!.id)
    expect(a.item!.shortName).toBe('深層学習') // fullwidth colon splits too
  })

  it('distinct editions of the same title produce distinct items', () => {
    const first = buildManualItem({ title: 'Deep Learning', url: '', year: '2016', authors: 'Goodfellow' }, 1)
    const second = buildManualItem({ title: 'Deep Learning', url: '', year: '2024', authors: 'Other' }, 2)
    expect(first.item!.id).not.toBe(second.item!.id)
  })

  it('detects duplicates across scripts/punctuation for the explicit confirm', () => {
    const items = [{ title: 'Deep  Learning!' }]
    expect(findDuplicateByTitle(items, 'deep learning')).toBeTruthy()
    expect(findDuplicateByTitle(items, 'deep learning 2nd edition')).toBeUndefined()
    expect(findDuplicateByTitle([{ title: '深層学習' }], '深層学習')).toBeTruthy()
  })

  it('validates the optional link and keeps arXiv PDF handling', () => {
    expect(buildManualItem({ title: 'X', url: 'javascript:alert(1)', year: '', authors: '' }, 1).error).toMatch(/http/)
    const arx = buildManualItem({ title: 'AnySat', url: 'https://arxiv.org/abs/2412.14123', year: '', authors: '' }, 1)
    expect(arx.item!.id).toBe('x-2412.14123')
    expect(arx.item!.pdfFile).toBe('arxiv-2412.14123.pdf')
    expect(buildManualItem({ title: '   ', url: '', year: '', authors: '' }, 1).error).toMatch(/Title/)
  })
})
