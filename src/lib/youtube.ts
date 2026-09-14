/**
 * YouTube integration, strictly through sanctioned surfaces:
 *  - oEmbed (no key, CORS-enabled) for titles/uploader names
 *  - privacy-enhanced click-to-load embeds (youtube-nocookie.com)
 *  - the official Data API v3 for the playlist watcher, using the user's own
 *    API key (stored in localStorage only, never synced, never required —
 *    everything except "check for new lectures" works without it)
 * No scraping.
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

/** Title + uploader via oEmbed (CORS-enabled, keyless). Best-effort. */
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

/** Latest playlist entries via the official Data API v3 (user's own key). */
export async function fetchPlaylistItems(playlistId: string, apiKey: string, max = 15): Promise<PlaylistVideo[]> {
  const url =
    'https://www.googleapis.com/youtube/v3/playlistItems?' +
    new URLSearchParams({ part: 'snippet', playlistId, maxResults: String(max), key: apiKey })
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.error?.message ?? `YouTube API ${res.status}`)
  }
  const j = (await res.json()) as {
    items: Array<{ snippet: { title: string; publishedAt: string; resourceId?: { videoId?: string } } }>
  }
  return (j.items ?? [])
    .map((it) => ({
      videoId: it.snippet.resourceId?.videoId ?? '',
      title: it.snippet.title,
      publishedAt: it.snippet.publishedAt,
    }))
    .filter((v) => v.videoId)
}

/** Pure diff: which fetched videos has the user not marked seen yet? */
export function diffNewVideos(fetched: PlaylistVideo[], seenVideoIds: string[] | undefined): PlaylistVideo[] {
  const seen = new Set(seenVideoIds ?? [])
  return fetched.filter((v) => !seen.has(v.videoId))
}

/** seen-list update on explicit "mark seen": newest first, capped. */
export function mergeSeen(fetched: PlaylistVideo[], seenVideoIds: string[] | undefined, cap = 100): string[] {
  return [...new Set([...fetched.map((v) => v.videoId), ...(seenVideoIds ?? [])])].slice(0, cap)
}

export function embedUrl(source: { playlistId?: string | null; videoId?: string | null }): string | null {
  if (source.videoId) return `https://www.youtube-nocookie.com/embed/${source.videoId}`
  if (source.playlistId) return `https://www.youtube-nocookie.com/embed/videoseries?list=${source.playlistId}`
  return null
}
