import type { RadarPaper, RadarTopic } from '../types'

/**
 * "Radar" — discover recent papers per topic via the OpenAlex API
 * (CORS-enabled, keyless, generous limits). arXiv PDFs can then be
 * pulled straight into OPFS because arxiv.org serves CORS on /pdf.
 */

export const DEFAULT_TOPICS: RadarTopic[] = [
  { id: 'vlm', label: 'Multimodal LLMs', query: 'multimodal large language model vision language', days: 60 },
  { id: 'retrieval', label: 'Embeddings & retrieval', query: 'text embedding dense retrieval reranking', days: 60 },
  { id: 'agents', label: 'Agents & test-time compute', query: 'LLM agent test-time compute reasoning reinforcement', days: 45 },
  { id: 'eo-fm', label: 'EO foundation models', query: 'remote sensing foundation model earth observation pretraining', days: 90 },
  { id: 'sar-dl', label: 'SAR × deep learning', query: 'synthetic aperture radar deep learning', days: 90 },
  { id: 'inference', label: 'Efficient inference', query: 'LLM inference KV cache quantization speculative decoding', days: 60 },
  { id: 'reg-nlp', label: 'Legal & financial NLP', query: 'legal reasoning benchmark financial language model', days: 90 },
]

/** OpenAlex stores abstracts as {word: [positions]}; rebuild the text. */
export function reconstructAbstract(inv: Record<string, number[]> | null | undefined): string | null {
  if (!inv) return null
  const words: string[] = []
  for (const [word, positions] of Object.entries(inv)) {
    for (const p of positions) words[p] = word
  }
  const text = words.filter(Boolean).join(' ')
  return text.length > 0 ? text : null
}

export function extractArxivId(...urls: Array<string | null | undefined>): string | null {
  for (const u of urls) {
    if (!u) continue
    const m = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i.exec(u)
    if (m) return m[1]
  }
  return null
}

export function arxivPdfUrl(arxivId: string): string {
  return `https://arxiv.org/pdf/${arxivId}`
}

interface OpenAlexWork {
  id: string
  display_name: string
  publication_date: string
  doi: string | null
  cited_by_count: number
  abstract_inverted_index: Record<string, number[]> | null
  primary_location: {
    landing_page_url: string | null
    pdf_url: string | null
    source: { display_name: string | null } | null
  } | null
  locations: Array<{ landing_page_url: string | null; pdf_url: string | null }> | null
  authorships: Array<{ author: { display_name: string | null } | null }> | null
}

export function mapWork(w: OpenAlexWork): RadarPaper {
  const locs = [w.primary_location, ...(w.locations ?? [])]
  const arxivId = extractArxivId(
    ...locs.flatMap((l) => [l?.landing_page_url, l?.pdf_url]),
  )
  return {
    id: w.id.replace('https://openalex.org/', ''),
    title: w.display_name,
    abstract: reconstructAbstract(w.abstract_inverted_index),
    date: w.publication_date,
    venue: w.primary_location?.source?.display_name ?? null,
    authors: (w.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((n): n is string => !!n)
      .slice(0, 8),
    landingUrl:
      (arxivId ? `https://arxiv.org/abs/${arxivId}` : null) ??
      w.primary_location?.landing_page_url ??
      w.doi,
    doi: w.doi,
    arxivId,
    citedBy: w.cited_by_count,
  }
}

export async function searchTopic(topic: RadarTopic, perPage = 20): Promise<RadarPaper[]> {
  const from = new Date(Date.now() - topic.days * 864e5).toISOString().slice(0, 10)
  const url =
    'https://api.openalex.org/works?' +
    new URLSearchParams({
      search: topic.query,
      filter: `from_publication_date:${from}`,
      sort: 'publication_date:desc',
      'per-page': String(perPage),
    })
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`OpenAlex ${res.status}`)
  const json = (await res.json()) as { results: OpenAlexWork[] }
  return json.results.map(mapWork)
}
