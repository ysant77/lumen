import { describe, expect, it, vi } from 'vitest'
import type { CustomItem } from '../types'
import {
  directRecoveryTarget,
  downloadRecoveryTarget,
  mayHaveRecoverablePdf,
  resolveRecoveryTarget,
} from './pdfRecovery'

function item(overrides: Partial<CustomItem> = {}): CustomItem {
  return {
    id: 'x-m-test',
    order: 1,
    phase: 'Inbox',
    shortName: 'Paper',
    title: 'A Recoverable Paper',
    year: 2026,
    pdfFile: null,
    addedAt: '2026-01-01T00:00:00Z',
    source: 'manual',
    ...overrides,
  }
}

describe('PDF recovery', () => {
  it('normalizes direct arXiv metadata from a page URL', () => {
    expect(
      directRecoveryTarget(
        item({ pageUrl: 'https://arxiv.org/abs/2609.11873v2', pdfFile: null, pdfUrl: null }),
      ),
    ).toMatchObject({
      arxivId: '2609.11873',
      pdfFile: 'arxiv-2609.11873.pdf',
      pdfUrl: 'https://arxiv.org/pdf/2609.11873',
    })
  })

  it('derives the CORS-enabled PDF asset for old AlphaXiv entries', () => {
    const old = item({ pageUrl: 'https://www.alphaxiv.org/pdf/2609.recurrent-looped-transformer' })
    expect(mayHaveRecoverablePdf(old)).toBe(true)
    expect(directRecoveryTarget(old)).toMatchObject({
      source: 'alphaxiv',
      pdfFile: 'alphaxiv-2609.recurrent-looped-transformerv1.pdf',
      pdfUrl:
        'https://pdfs.assets.alphaxiv.org/2609.recurrent-looped-transformerv1.pdf',
    })
  })

  it('resolves a legacy Radar entry through an exact OpenAlex title match', async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: 'https://openalex.org/W1',
              display_name: 'A Recoverable Paper',
              publication_date: '2026-09-01',
              doi: null,
              cited_by_count: 0,
              abstract_inverted_index: null,
              primary_location: {
                landing_page_url: 'https://arxiv.org/abs/2609.19969',
                pdf_url: 'https://arxiv.org/pdf/2609.19969',
                source: { display_name: 'arXiv' },
              },
              locations: [],
              authorships: [],
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch
    const target = await resolveRecoveryTarget(
      item({ source: 'radar' }),
      fetcher,
    )
    expect(target?.pdfFile).toBe('arxiv-2609.19969.pdf')
  })

  it('refuses a fuzzy title result to avoid downloading the wrong paper', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ display_name: 'A Different Paper' }] }), {
        status: 200,
      }),
    ) as unknown as typeof fetch
    await expect(
      resolveRecoveryTarget(
        item({ source: 'radar' }),
        fetcher,
      ),
    ).resolves.toBeNull()
  })

  it('validates the PDF signature before writing', async () => {
    const fetcher = vi.fn(async () => new Response('%PDF-test', { status: 200 })) as unknown as typeof fetch
    const writer = vi.fn(async () => undefined)
    const target = directRecoveryTarget(item({ id: 'x-2609.11873' }))!
    await downloadRecoveryTarget(target, fetcher, writer)
    expect(writer).toHaveBeenCalledWith(target.pdfFile, expect.any(ArrayBuffer))
  })

  it('rejects HTML error pages returned with a successful status', async () => {
    const fetcher = vi.fn(async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch
    const writer = vi.fn(async () => undefined)
    const target = directRecoveryTarget(item({ id: 'x-2609.11873' }))!
    await expect(downloadRecoveryTarget(target, fetcher, writer)).rejects.toThrow(/invalid content/)
    expect(writer).not.toHaveBeenCalled()
  })
})
