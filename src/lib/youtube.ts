import type { LearningSource } from '../types'

/**
 * YouTube integration surfaces:
 *  - oEmbed (no key) for titles/uploader names
 *  - click-to-load embeds via youtube-nocookie.com
 *  - the Data API v3 playlist watcher, using the user's own API key
 *
 * The key lives in localStorage only: it is never synced, never exported and
 * never logged. Note that any key used from a browser is visible to whoever
 * uses this device/profile — API restrictions (per-API + referrer) reduce
 * misuse; they do not make the key secret.
 *
 * Watcher data handling: API responses are shown transiently and are not
 * persisted; only acknowledged video IDs, the baseline flag and check
 * timestamps are stored on the source record.
 */

const KEY_STORAGE = 'lumen.youtube.apiKey'

export function getYouTubeKey(): string {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? ''
  } catch {
    return ''
  }
}

export function setYouTubeKey(key: string) {
  try {
    if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim())
    else localStorage.removeItem(KEY_STORAGE)
  } catch {
    /* private mode */
  }
}

export interface ParsedYouTubeUrl {
  playlistId: string | null
  videoId: string | null
}

export function parseYouTubeUrl(raw: string): ParsedYouTubeUrl | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  const host = url.hostname.replace(/^www\.|^m\./, '')
  if (host === 'youtu.be') {
    return { videoId: url.pathname.slice(1).split('/')[0] || null, playlistId: url.searchParams.get('list') }
  }
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null
  const list = url.searchParams.get('list')
  const v = url.searchParams.get('v')
  const embed = /^\/embed\/([\w-]{6,})/.exec(url.pathname)
  const videoId = v ?? (embed && embed[1] !== 'videoseries' ? embed[1] : null)
  if (!list && !videoId) return null
  return { playlistId: list, videoId }
}

export interface OEmbedInfo {
  title: string
  author: string
}

/** Title + uploader via oEmbed (keyless). Best-effort. */
export async function oembedLookup(url: string): Promise<OEmbedInfo | null> {
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`)
    if (!res.ok) return null
    const j = (await res.json()) as { title?: string; author_name?: string }
    return j.title ? { title: j.title, author: j.author_name ?? '' } : null
  } catch {
    return null
  }
}

export interface PlaylistVideo {
  videoId: string
  title: string
  publishedAt: string
}

export interface PlaylistFetchResult {
  videos: PlaylistVideo[]
  /** true when the page budget ran out before the playlist ended */
  incomplete: boolean
  pagesFetched: number
}

/** default page budget: 8 pages × 50 items = 400 videos per check */
export const PAGE_BUDGET = 8

/**
 * Fetch playlist entries following nextPageToken until the playlist ends or
 * the request budget is exhausted. playlistItems returns PLAYLIST order (new
 * lectures are typically appended at the END), so partial fetches must never
 * be treated as "the newest entries" — hence full pagination + an explicit
 * `incomplete` flag when the budget is hit.
 */
export async function fetchAllPlaylistItems(
  playlistId: string,
  apiKey: string,
  pageBudget = PAGE_BUDGET,
): Promise<PlaylistFetchResult> {
  const videos: PlaylistVideo[] = []
  let pageToken: string | undefined
  let pages = 0
  do {
    const params = new URLSearchParams({ part: 'snippet', playlistId, maxResults: '50', key: apiKey })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`)
    if (!res.ok) {
      const body = await res.json().catch(() => null)
      throw new Error(body?.error?.message ?? `YouTube API ${res.status}`)
    }
    const j = (await res.json()) as {
      nextPageToken?: string
      items?: Array<{ snippet: { title: string; publishedAt: string; resourceId?: { videoId?: string } } }>
    }
    for (const it of j.items ?? []) {
      const videoId = it.snippet.resourceId?.videoId
      if (videoId) videos.push({ videoId, title: it.snippet.title, publishedAt: it.snippet.publishedAt })
    }
    pageToken = j.nextPageToken
    pages++
  } while (pageToken && pages < pageBudget)
  return { videos, incomplete: !!pageToken, pagesFetched: pages }
}

/** Pure diff: fetched videos the user has not acknowledged. */
export function diffNewVideos(fetched: PlaylistVideo[], seenVideoIds: string[] | undefined): PlaylistVideo[] {
  const seen = new Set(seenVideoIds ?? [])
  return fetched.filter((v) => !seen.has(v.videoId))
}

/**
 * Acknowledge exactly the checked snapshot (never a fresh fetch). Uncapped:
 * evicting old IDs would falsely re-report videos the user already saw.
 */
export function ackVideos(seenVideoIds: string[] | undefined, snapshot: PlaylistVideo[]): string[] {
  return [...new Set([...(seenVideoIds ?? []), ...snapshot.map((v) => v.videoId)])]
}

export type CheckPlan =
  | {
      action: 'baseline'
      ackIds: string[]
      /** partial pre-1.3.1 baselines are upgraded silently instead of flooding "new" */
      migratedFromPartial: boolean
    }
  | { action: 'diff'; newVideos: PlaylistVideo[] }
  /** the fetch was truncated by the budget: a COMPLETE baseline cannot be claimed */
  | { action: 'no-baseline-incomplete' }

/**
 * Decide what a check means for this source. `baselinedAt` marks a COMPLETE
 * baseline and may only ever be set from a COMPLETE (non-truncated) fetch;
 * empty playlists baseline correctly to an empty ack list (their first upload
 * is then reported as new). Sources created before full pagination existed
 * carry a partial seen-list without `baselinedAt` — those are re-baselined
 * once (no false "new" flood) and watch cleanly afterwards. Once baselined,
 * diffing an incomplete fetch is still valid for the fetched portion (the UI
 * flags that entries may be missing).
 */
export function planCheck(
  source: Pick<LearningSource, 'seenVideoIds' | 'baselinedAt'>,
  fetched: PlaylistVideo[],
  incomplete: boolean,
): CheckPlan {
  if (!source.baselinedAt) {
    if (incomplete) return { action: 'no-baseline-incomplete' }
    return {
      action: 'baseline',
      ackIds: fetched.map((v) => v.videoId),
      migratedFromPartial: (source.seenVideoIds?.length ?? 0) > 0,
    }
  }
  return { action: 'diff', newVideos: diffNewVideos(fetched, source.seenVideoIds) }
}

export function embedUrl(source: { playlistId?: string | null; videoId?: string | null }): string | null {
  if (source.videoId) return `https://www.youtube-nocookie.com/embed/${source.videoId}`
  if (source.playlistId) return `https://www.youtube-nocookie.com/embed/videoseries?list=${source.playlistId}`
  return null
}

// ---------------------------------------------------------------------------
// Retention of YouTube-derived metadata (title/uploader fetched via oEmbed)
//
// Stored provider metadata expires META_TTL_DAYS after the fetch that
// produced it (metaFetchedAt — never an acknowledgement timestamp). Expired
// fields are purged from the record; the user can re-fetch with an explicit
// Refresh action. User-entered titles and notes are never expired.
// ---------------------------------------------------------------------------

export const META_TTL_DAYS = 30

type MetaSource = Pick<
  LearningSource,
  'type' | 'title' | 'provider' | 'titleFromYouTube' | 'metaFetchedAt' | 'addedAt' | 'playlistId' | 'videoId' | 'url'
>

/** Neutral label that carries no YouTube-derived text. */
export function fallbackLabel(s: Pick<MetaSource, 'playlistId' | 'videoId' | 'url'>): string {
  if (s.playlistId) return `YouTube playlist ${s.playlistId}`
  if (s.videoId) return `YouTube video ${s.videoId}`
  return s.url
}

export function isMetaExpired(s: MetaSource, nowMs = Date.now()): boolean {
  if (s.type === 'site') return false
  if (!s.provider && !s.titleFromYouTube) return false // nothing YouTube-derived is stored
  // legacy records (pre-retention) carry no metaFetchedAt: their add time is
  // the last moment the data could have been fetched
  const fetchedAt = s.metaFetchedAt ?? s.addedAt
  if (!fetchedAt) return true
  return nowMs - Date.parse(fetchedAt) > META_TTL_DAYS * 864e5
}

/**
 * Purge expired YouTube-derived fields. Returns the updated record, or null
 * when nothing changed. User-entered titles are preserved; a YouTube-derived
 * title falls back to a neutral label until the user refreshes.
 */
export function expireSourceMeta(s: LearningSource, nowMs = Date.now()): LearningSource | null {
  if (!isMetaExpired(s, nowMs)) return null
  const out: LearningSource = { ...s, provider: null, metaFetchedAt: null }
  if (s.titleFromYouTube) {
    out.title = fallbackLabel(s)
    out.titleFromYouTube = false
  }
  return out
}

/**
 * Apply a user-initiated metadata refresh. The user's own label is kept;
 * only a YouTube-derived (or previously purged/neutral) title is replaced.
 */
export function applyMetaRefresh(s: LearningSource, info: OEmbedInfo, now: string): LearningSource {
  const neutral = s.title === fallbackLabel(s) || !s.title.trim()
  const takeTitle = s.titleFromYouTube || neutral
  return {
    ...s,
    title: takeTitle ? info.title : s.title,
    titleFromYouTube: takeTitle ? true : s.titleFromYouTube,
    provider: info.author || null,
    metaFetchedAt: now,
  }
}

/**
 * Acknowledge the checked snapshot. Deliberately does NOT touch lastChecked:
 * acknowledgements are not fetches, and freshness must come from fetches.
 * An incomplete snapshot never establishes a complete baseline.
 */
export function applyMarkSeen(
  s: LearningSource,
  snapshot: PlaylistVideo[],
  snapshotIncomplete: boolean,
  now: string,
): LearningSource {
  return {
    ...s,
    seenVideoIds: ackVideos(s.seenVideoIds, snapshot),
    baselinedAt: s.baselinedAt ?? (snapshotIncomplete ? null : now),
  }
}
