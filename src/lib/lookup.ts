import type { RadarPaper } from '../types'
import { mapWork } from './radar'

/**
 * Resolve a user-entered reference (arXiv id/URL or DOI) to paper metadata
 * via OpenAlex. Books/sites without a DOI go through manual entry instead.
 */

export interface ParsedRef {
  kind: 'arxiv' | 'doi'
  /** normalized value: bare arXiv id, or bare DOI */
  value: string
}

export function parseRef(input: string): ParsedRef | null {
  const s = input.trim()
  if (!s) return null
  const arxiv =
    /(?:arxiv\.org\/(?:abs|pdf)\/|^arxiv:\s*|^)(\d{4}\.\d{4,5})(?:v\d+)?$/i.exec(s) ??
    /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/i.exec(s)
  if (arxiv) return { kind: 'arxiv', value: arxiv[1] }
  const doi = /(?:doi\.org\/|doi:\s*|^)(10\.\d{4,9}\/\S+)$/i.exec(s)
  if (doi) return { kind: 'doi', value: doi[1].replace(/[.,;]$/, '') }
  return null
}

export function openAlexFilterUrl(ref: ParsedRef): string {
  const doi = ref.kind === 'arxiv' ? `10.48550/arxiv.${ref.value}` : ref.value
  return (
    'https://api.openalex.org/works?' +
    new URLSearchParams({ filter: `doi:${doi}`, 'per-page': '1' })
  )
}

/** null = reference syntactically valid but not found (manual entry fallback). */
export async function resolveRef(ref: ParsedRef): Promise<RadarPaper | null> {
  const res = await fetch(openAlexFilterUrl(ref), { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`)
  const json = (await res.json()) as { results: any[] }
  if (!json.results?.length) return null
  const paper = mapWork(json.results[0])
  // trust the user's arXiv id even when OpenAlex only knows the published version
  if (ref.kind === 'arxiv' && !paper.arxivId) {
    return { ...paper, arxivId: ref.value, landingUrl: `https://arxiv.org/abs/${ref.value}` }
  }
  return paper
}
