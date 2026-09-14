import type { CustomItem, RadarPaper } from '../types'
import { arxivPdfUrl, mapWork } from './radar'

/** strict http(s) URL check for user-entered links (Sources + manual Inbox) */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s.trim())
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Unicode-aware normalization for duplicate detection (editions stay distinct via explicit confirm). */
export function normalizeTitle(t: string): string {
  return t
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function findDuplicateByTitle<T extends { title: string }>(items: T[], title: string): T | undefined {
  const n = normalizeTitle(title)
  if (!n) return undefined
  return items.find((i) => normalizeTitle(i.title) === n)
}

export interface ManualFields {
  title: string
  url: string
  year: string
  authors: string
}

/**
 * Build a manual Inbox item with a collision-safe id (UUID-based, never
 * derived from the title — non-Latin titles and same-titled editions are
 * first-class). arXiv links still get first-class PDF handling.
 */
export function buildManualItem(
  fields: ManualFields,
  order: number,
): { item: CustomItem; error?: never } | { item?: never; error: string } {
  const title = fields.title.trim()
  if (!title) return { error: 'Title is required.' }
  const url = fields.url.trim()
  if (url && !isHttpUrl(url)) return { error: 'Link must be a valid http(s) URL.' }
  const arxiv = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/.exec(url)
  const id = arxiv ? `x-${arxiv[1]}` : `x-m-${crypto.randomUUID()}`
  const now = new Date().toISOString()
  return {
    item: {
      id,
      order,
      phase: 'Inbox',
      shortName: title.split(/[:：]/)[0].trim().slice(0, 40) || title.slice(0, 40),
      title,
      year: fields.year.trim() || '',
      authors: fields.authors.trim() || null,
      priority: null,
      difficulty: null,
      why: null,
      exercise: null,
      pageUrl: url || null,
      pdfUrl: arxiv ? arxivPdfUrl(arxiv[1]) : null,
      pdfFile: arxiv ? `arxiv-${arxiv[1]}.pdf` : null,
      pdfDir: null,
      addedAt: now,
      source: 'manual',
    },
  }
}

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
