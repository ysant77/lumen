import type { CourseTrack, LearningSource } from '../types'
import picksRaw from '../data/course-picks.json'

/**
 * Radar's Courses tab — keep up with free courses per track.
 *
 *  - curated picks (static, verified links; no network)
 *  - live discovery of course playlists via the YouTube Data API v3
 *    `search.list`, using the user's own key (see youtube.ts)
 *  - plain search links for catalogs with no browser-usable API
 *    (Coursera, edX, MIT OCW, Class Central)
 *
 * Search responses are shown transiently and never persisted; only a track's
 * `lastChecked` timestamp is stored. Following a result creates an ordinary
 * LearningSource, which carries the YouTube-derived title/uploader under the
 * same retention rules as every other source.
 */

export const DEFAULT_TRACKS: CourseTrack[] = [
  { id: 'ai-ml', label: 'AI/ML', query: 'large language models deep learning university course lectures' },
  { id: 'sar-data', label: 'SAR data processing', query: 'synthetic aperture radar data processing InSAR tutorial' },
  { id: 'sar-hw', label: 'Radar & SAR hardware', query: 'build FMCW radar SDR synthetic aperture hardware design' },
  { id: 'iot', label: 'IoT & embedded', query: 'internet of things embedded systems course' },
  { id: 'edge-ai', label: 'Edge AI', query: 'TinyML edge AI efficient deep learning course' },
]

/** A hand-verified course link shipped with the app. */
export interface CoursePick {
  id: string
  track: string
  title: string
  url: string
  type: LearningSource['type']
  playlistId?: string
  provider: string
  platform: string
  /** `audit` = free to audit/preview where the provider offers it; certificates are paid */
  access: 'free' | 'audit'
  note: string
}

export const COURSE_PICKS = picksRaw as CoursePick[]

export function picksForTrack(trackId: string): CoursePick[] {
  return COURSE_PICKS.filter((p) => p.track === trackId)
}

/**
 * Channels whose uploads are official course material (ids verified against
 * the channel pages). Used only to rank and label search results.
 */
export const KNOWN_CHANNELS: Record<string, string> = {
  'UCBa5G_ESCn8Yd4vw5U-gIcg': 'Stanford Online',
  UCEBb1b_L6zDS3xTUrIALZOw: 'MIT OpenCourseWare',
  'UCcA-9WYwGaUrWiZaEDo84ng': 'MIT HAN Lab',
  UCB67PxhB5LAWEbI4etQS7aw: 'Berkeley RDI',
  UCclJCqMDAkyVGsm5oFOTXIQ: 'DigiKey',
  UCDIF0ZdNn4L45OugpQr75FQ: 'Jon Kraft',
  UCXUPKJO5MZQN11PqgIvyuvQ: 'Andrej Karpathy',
  UC_aP7p621ATY_yAa8jMqUVA: 'NASA Video',
}

/** search.list costs 100 quota units per call (default daily quota: 10,000) */
export const SEARCH_QUOTA_UNITS = 100

export type CourseOrder = 'relevance' | 'date'

export interface CoursePlaylist {
  playlistId: string
  title: string
  description: string
  channelId: string
  channelTitle: string
  publishedAt: string
}

/** search.list returns HTML-escaped snippet text; decode the common entities. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export function buildPlaylistSearchUrl(query: string, apiKey: string, order: CourseOrder, maxResults = 25): string {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'playlist',
    q: query,
    order,
    maxResults: String(maxResults),
    key: apiKey,
  })
  return `https://www.googleapis.com/youtube/v3/search?${params}`
}

interface SearchItem {
  id?: { playlistId?: string }
  snippet?: {
    title?: string
    description?: string
    channelId?: string
    channelTitle?: string
    publishedAt?: string
  }
}

export function mapSearchItems(items: SearchItem[] | undefined): CoursePlaylist[] {
  const out: CoursePlaylist[] = []
  const seen = new Set<string>()
  for (const it of items ?? []) {
    const playlistId = it.id?.playlistId
    if (!playlistId || !it.snippet?.title || seen.has(playlistId)) continue
    seen.add(playlistId)
    out.push({
      playlistId,
      title: decodeEntities(it.snippet.title),
      description: decodeEntities(it.snippet.description ?? ''),
      channelId: it.snippet.channelId ?? '',
      channelTitle: decodeEntities(it.snippet.channelTitle ?? ''),
      publishedAt: it.snippet.publishedAt ?? '',
    })
  }
  return out
}

/** Known course channels first; the API's own order is kept within each group. */
export function rankPlaylists(list: CoursePlaylist[]): CoursePlaylist[] {
  const known = list.filter((p) => p.channelId in KNOWN_CHANNELS)
  const rest = list.filter((p) => !(p.channelId in KNOWN_CHANNELS))
  return [...known, ...rest]
}

export async function searchCoursePlaylists(
  query: string,
  apiKey: string,
  order: CourseOrder = 'relevance',
): Promise<CoursePlaylist[]> {
  const res = await fetch(buildPlaylistSearchUrl(query, apiKey, order))
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error?.message ?? `YouTube API ${res.status}`)
  }
  const j = (await res.json()) as { items?: SearchItem[] }
  return rankPlaylists(mapSearchItems(j.items))
}

export function playlistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`
}

/** Catalogs lumen cannot query from the browser: open their own search instead. */
export function elsewhereLinks(query: string): Array<{ label: string; url: string }> {
  const q = encodeURIComponent(query)
  return [
    { label: 'Coursera', url: `https://www.coursera.org/search?query=${q}` },
    { label: 'edX', url: `https://www.edx.org/search?q=${q}` },
    { label: 'MIT OCW', url: `https://ocw.mit.edu/search/?q=${q}` },
    { label: 'Class Central', url: `https://www.classcentral.com/search?q=${q}` },
  ]
}

export function isFollowed(
  sources: Array<Pick<LearningSource, 'url' | 'playlistId'>>,
  target: { url: string; playlistId?: string | null },
): boolean {
  return sources.some((s) => s.url === target.url || (!!target.playlistId && s.playlistId === target.playlistId))
}

/** A followed search result: its title/uploader are YouTube-derived and expire like any other. */
export function playlistToSource(p: CoursePlaylist, id: string, now: string): LearningSource {
  return {
    id,
    title: p.title,
    url: playlistUrl(p.playlistId),
    type: 'youtube-playlist',
    provider: p.channelTitle || null,
    playlistId: p.playlistId,
    videoId: null,
    addedAt: now,
    metaFetchedAt: now,
    titleFromYouTube: true,
  }
}

/** A followed curated pick: the title is lumen's own label, not fetched from YouTube. */
export function pickToSource(p: CoursePick, id: string, now: string): LearningSource {
  return {
    id,
    title: p.title,
    url: p.url,
    type: p.type,
    provider: p.provider,
    playlistId: p.playlistId ?? null,
    videoId: null,
    notes: p.note,
    addedAt: now,
  }
}
