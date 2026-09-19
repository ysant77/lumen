import type { CustomItem } from '../types'
import { writePdf } from './opfs'
import { arxivPdfUrl, extractArxivId, mapWork } from './radar'

const AUTO_RECOVER_KEY = 'lumen.pdfAutoRecovery'

export interface PdfRecoveryTarget {
  itemId: string
  title: string
  source: 'arxiv' | 'alphaxiv'
  arxivId?: string
  pdfFile: string
  pdfUrl: string
}

type Fetcher = typeof fetch
type PdfWriter = (basename: string, buffer: ArrayBuffer) => Promise<void>

function idFromFilename(name: string | null | undefined): string | null {
  const match = /^arxiv-(\d{4}\.\d{4,5})(?:v\d+)?\.pdf$/i.exec(name ?? '')
  return match?.[1] ?? null
}

function idFromItemId(id: string): string | null {
  const match = /^x-(\d{4}\.\d{4,5})(?:v\d+)?$/i.exec(id)
  return match?.[1] ?? null
}

export function fetchablePdfUrl(...sources: Array<string | null | undefined>): string | null {
  const arxivId = extractArxivId(...sources)
  if (arxivId) return arxivPdfUrl(arxivId)
  for (const source of sources) {
    try {
      const url = new URL(source ?? '')
      if (url.hostname === 'pdfs.assets.alphaxiv.org' && url.pathname.endsWith('.pdf')) {
        return url.toString()
      }
    } catch {
      /* not a URL */
    }
  }
  return null
}

function alphaXivTarget(item: CustomItem): PdfRecoveryTarget | null {
  try {
    const url = new URL(item.pageUrl ?? '')
    if (!/(?:^|\.)alphaxiv\.org$/i.test(url.hostname)) return null
    const match = /^\/(?:abs|pdf)\/(\d{4}\.[a-z0-9-]+?)(v\d+)?\/?$/i.exec(url.pathname)
    if (!match) return null
    const canonicalId = `${match[1]}${match[2] ?? 'v1'}`
    return {
      itemId: item.id,
      title: item.title,
      source: 'alphaxiv',
      pdfFile: `alphaxiv-${canonicalId}.pdf`,
      pdfUrl: `https://pdfs.assets.alphaxiv.org/${canonicalId}.pdf`,
    }
  } catch {
    return null
  }
}

/** Resolve already-known arXiv metadata without making a network request. */
export function directRecoveryTarget(item: CustomItem): PdfRecoveryTarget | null {
  const alphaXiv = alphaXivTarget(item)
  if (alphaXiv) return alphaXiv
  const arxivId =
    extractArxivId(item.pdfUrl, item.pageUrl) ??
    idFromFilename(item.pdfFile) ??
    idFromItemId(item.id)
  if (!arxivId) return null
  return {
    itemId: item.id,
    title: item.title,
    source: 'arxiv',
    arxivId,
    pdfFile: `arxiv-${arxivId}.pdf`,
    pdfUrl: arxivPdfUrl(arxivId),
  }
}

/** Items for which a safe recovery lookup is worthwhile. */
export function mayHaveRecoverablePdf(item: CustomItem): boolean {
  if (directRecoveryTarget(item)) return true
  if (item.source === 'radar') return true
  return /(?:^|\.)alphaxiv\.org$/i.test(safeHostname(item.pageUrl))
}

function safeHostname(value: string | null | undefined): string {
  try {
    return new URL(value ?? '').hostname
  } catch {
    return ''
  }
}

function normalizedTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function openAlexLookupUrl(item: CustomItem): string {
  const workId = /^x-(w\d+)$/i.exec(item.id)?.[1]
  if (workId) return `https://api.openalex.org/works/${workId.toUpperCase()}`
  return `https://api.openalex.org/works?${new URLSearchParams({
    search: item.title,
    'per-page': '5',
  })}`
}

/**
 * Resolve older Radar entries which did not persist an arXiv id.
 * Title searches are accepted only on an exact normalized-title match.
 */
export async function resolveRecoveryTarget(
  item: CustomItem,
  fetcher: Fetcher = fetch,
): Promise<PdfRecoveryTarget | null> {
  const direct = directRecoveryTarget(item)
  if (direct) return direct
  if (!mayHaveRecoverablePdf(item)) return null

  const response = await fetcher(openAlexLookupUrl(item), {
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`OpenAlex returned ${response.status}`)
  const body = (await response.json()) as { results?: unknown[]; display_name?: string }
  const works = body.results ?? [body]
  const wantedTitle = normalizedTitle(item.title)
  const exact = works.find((work: any) => normalizedTitle(work?.display_name ?? '') === wantedTitle)
  if (!exact) return null
  const paper = mapWork(exact as Parameters<typeof mapWork>[0])
  if (!paper.arxivId) return null
  return {
    itemId: item.id,
    title: item.title,
    source: 'arxiv',
    arxivId: paper.arxivId,
    pdfFile: `arxiv-${paper.arxivId}.pdf`,
    pdfUrl: arxivPdfUrl(paper.arxivId),
  }
}

export async function downloadRecoveryTarget(
  target: PdfRecoveryTarget,
  fetcher: Fetcher = fetch,
  writer: PdfWriter = writePdf,
): Promise<void> {
  const response = await fetcher(target.pdfUrl, { headers: { Accept: 'application/pdf' } })
  const buffer = await response.arrayBuffer()
  const signature = String.fromCharCode(...new Uint8Array(buffer.slice(0, 5)))
  if (!response.ok) throw new Error(`PDF source returned ${response.status}`)
  if (signature !== '%PDF-') throw new Error('PDF source returned invalid content')
  await writer(target.pdfFile, buffer)
}

export function enrichWithRecoveryTarget(item: CustomItem, target: PdfRecoveryTarget): CustomItem {
  if (item.pdfFile === target.pdfFile && item.pdfUrl === target.pdfUrl) return item
  return { ...item, pdfFile: target.pdfFile, pdfUrl: target.pdfUrl }
}

export function getPdfAutoRecovery(): boolean {
  return localStorage.getItem(AUTO_RECOVER_KEY) === 'true'
}

export function setPdfAutoRecovery(enabled: boolean): void {
  localStorage.setItem(AUTO_RECOVER_KEY, String(enabled))
}
