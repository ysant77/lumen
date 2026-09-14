import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ackVideos,
  applyMarkSeen,
  applyMetaRefresh,
  diffNewVideos,
  embedUrl,
  expireSourceMeta,
  fetchAllPlaylistItems,
  isMetaExpired,
  parseYouTubeUrl,
  planCheck,
  type PlaylistVideo,
} from './youtube'

const vid = (id: string): PlaylistVideo => ({ videoId: id, title: `Lecture ${id}`, publishedAt: '2026-09-01' })

afterEach(() => vi.unstubAllGlobals())

describe('youtube url parsing', () => {
  it('parses playlist, watch, youtu.be and embed URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/playlist?list=PL3FW7Lu3i5JvHM8ljYj-zLfQRF3EO8sYv')).toEqual({
      playlistId: 'PL3FW7Lu3i5JvHM8ljYj-zLfQRF3EO8sYv',
      videoId: null,
    })
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=abc123XYZ_-&list=PLxyz')).toEqual({
      playlistId: 'PLxyz',
      videoId: 'abc123XYZ_-',
    })
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({ playlistId: null, videoId: 'dQw4w9WgXcQ' })
  })

  it('rejects non-YouTube URLs and garbage', () => {
    expect(parseYouTubeUrl('https://vimeo.com/12345')).toBeNull()
    expect(parseYouTubeUrl('not a url')).toBeNull()
    expect(parseYouTubeUrl('https://www.youtube.com/@channel')).toBeNull()
  })

  it('builds privacy-enhanced embed urls', () => {
    expect(embedUrl({ videoId: 'abc' })).toBe('https://www.youtube-nocookie.com/embed/abc')
    expect(embedUrl({ playlistId: 'PLx' })).toBe('https://www.youtube-nocookie.com/embed/videoseries?list=PLx')
    expect(embedUrl({})).toBeNull()
  })
})

function stubPages(pages: Record<string, { items: string[]; next?: string }>, calls: string[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const u = new URL(String(input))
      calls.push(String(input))
      const token = u.searchParams.get('pageToken') ?? 'FIRST'
      const page = pages[token]
      if (!page) return { ok: false, status: 404, json: async () => ({ error: { message: 'bad page' } }) }
      return {
        ok: true,
        json: async () => ({
          nextPageToken: page.next,
          items: page.items.map((id) => ({
            snippet: { title: `Lecture ${id}`, publishedAt: '2026-09-01', resourceId: { videoId: id } },
          })),
        }),
      }
    }),
  )
  return calls
}

describe('fetchAllPlaylistItems — REGRESSION: multi-page playlists', () => {
  it('follows nextPageToken to the end (new lectures are appended at the END)', async () => {
    const calls = stubPages({
      FIRST: { items: ['v1', 'v2'], next: 'P2' },
      P2: { items: ['v3'], next: 'P3' },
      P3: { items: ['v4-newest'] },
    })
    const res = await fetchAllPlaylistItems('PLx', 'key')
    expect(res.videos.map((v) => v.videoId)).toEqual(['v1', 'v2', 'v3', 'v4-newest'])
    expect(res.incomplete).toBe(false)
    expect(res.pagesFetched).toBe(3)
    expect(calls).toHaveLength(3)
    expect(calls[1]).toContain('pageToken=P2')
  })

  it('stops at the request budget and reports the check as incomplete', async () => {
    stubPages({
      FIRST: { items: ['a'], next: 'P2' },
      P2: { items: ['b'], next: 'P3' },
      P3: { items: ['c'], next: 'P4' },
    })
    const res = await fetchAllPlaylistItems('PLx', 'key', 2)
    expect(res.videos.map((v) => v.videoId)).toEqual(['a', 'b'])
    expect(res.incomplete).toBe(true) // clearly reported, never silently partial
    expect(res.pagesFetched).toBe(2)
  })

  it('surfaces API errors with the provider message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: { message: 'quotaExceeded' } }),
    })))
    await expect(fetchAllPlaylistItems('PLx', 'key')).rejects.toThrow(/quotaExceeded/)
  })
})

describe('planCheck — baselines, empty playlists, migration', () => {
  it('first check on an EMPTY playlist establishes a real (empty) baseline', () => {
    const plan = planCheck({ seenVideoIds: undefined, baselinedAt: undefined }, [], false)
    expect(plan).toEqual({ action: 'baseline', ackIds: [], migratedFromPartial: false })
    // after baselining, the playlist's first upload IS new
    const later = planCheck({ seenVideoIds: [], baselinedAt: '2026-09-01' }, [vid('first')], false)
    expect(later.action).toBe('diff')
    expect((later as any).newVideos.map((v: PlaylistVideo) => v.videoId)).toEqual(['first'])
  })

  it('REGRESSION: migrates pre-1.3.1 partial baselines without flooding "new"', () => {
    // old behaviour stored only the first ~15 ids and no baselinedAt
    const plan = planCheck(
      { seenVideoIds: ['v1', 'v2'], baselinedAt: undefined },
      [vid('v1'), vid('v2'), vid('v3'), vid('v4')],
      false,
    )
    expect(plan.action).toBe('baseline')
    expect((plan as any).migratedFromPartial).toBe(true)
    expect((plan as any).ackIds).toEqual(['v1', 'v2', 'v3', 'v4'])
  })

  it('diffs against acknowledgements once baselined', () => {
    const plan = planCheck(
      { seenVideoIds: ['v1', 'v2'], baselinedAt: '2026-09-01' },
      [vid('v1'), vid('v2'), vid('v3')],
      false,
    )
    expect(plan.action).toBe('diff')
    expect((plan as any).newVideos.map((v: PlaylistVideo) => v.videoId)).toEqual(['v3'])
  })

  it('REGRESSION: an incomplete fetch never establishes a baseline', () => {
    // unbaselined + truncated fetch -> explicit refusal, nothing acked
    const plan = planCheck({ seenVideoIds: undefined, baselinedAt: undefined }, [vid('v1'), vid('v2')], true)
    expect(plan).toEqual({ action: 'no-baseline-incomplete' })
    // even a pre-1.3.1 partial seen-list must NOT be "upgraded" from a truncated fetch
    const migrating = planCheck({ seenVideoIds: ['v1'], baselinedAt: undefined }, [vid('v1'), vid('v2')], true)
    expect(migrating).toEqual({ action: 'no-baseline-incomplete' })
  })

  it('once baselined, an incomplete fetch still diffs the fetched portion', () => {
    const plan = planCheck({ seenVideoIds: ['v1'], baselinedAt: '2026-09-01' }, [vid('v1'), vid('v2')], true)
    expect(plan.action).toBe('diff')
    expect((plan as any).newVideos.map((v: PlaylistVideo) => v.videoId)).toEqual(['v2'])
  })
})

describe('YouTube metadata retention (expiry from actual fetches)', () => {
  const DAY = 864e5
  const t0 = Date.parse('2026-09-01T00:00:00Z')
  const base = {
    id: 's1',
    url: 'https://www.youtube.com/playlist?list=PLx',
    type: 'youtube-playlist' as const,
    playlistId: 'PLx',
    videoId: null,
    addedAt: '2026-09-01T00:00:00Z',
  }

  it('fresh metadata is kept; expiry triggers only after the TTL since the FETCH', () => {
    const s = { ...base, title: 'CS231n Lectures', titleFromYouTube: true, provider: 'Stanford', metaFetchedAt: '2026-09-01T00:00:00Z' }
    expect(isMetaExpired(s, t0 + 29 * DAY)).toBe(false)
    expect(expireSourceMeta(s, t0 + 29 * DAY)).toBeNull()
    expect(isMetaExpired(s, t0 + 31 * DAY)).toBe(true)
  })

  it('acknowledgements do not extend freshness (mark seen leaves lastChecked and metaFetchedAt alone)', () => {
    const s = {
      ...base,
      title: 'CS231n',
      provider: 'Stanford',
      metaFetchedAt: '2026-09-01T00:00:00Z',
      lastChecked: '2026-09-02T00:00:00Z',
      baselinedAt: '2026-09-01T00:00:00Z',
      seenVideoIds: ['v1'],
    }
    const after = applyMarkSeen(s, [vid('v2')], false, '2026-10-15T00:00:00Z')
    expect(after.seenVideoIds!.sort()).toEqual(['v1', 'v2'])
    expect(after.lastChecked).toBe('2026-09-02T00:00:00Z') // ack ≠ fetch
    expect(after.metaFetchedAt).toBe('2026-09-01T00:00:00Z')
    // and still expires based on the old fetch time
    expect(isMetaExpired(after, Date.parse('2026-10-15T00:00:00Z'))).toBe(true)
  })

  it('expiry purges YouTube-derived fields but PRESERVES user-entered titles', () => {
    const ytTitled = { ...base, title: 'Fetched Title', titleFromYouTube: true, provider: 'Chan', metaFetchedAt: '2026-09-01T00:00:00Z' }
    const purged = expireSourceMeta(ytTitled, t0 + 40 * DAY)!
    expect(purged.title).toBe('YouTube playlist PLx') // neutral fallback
    expect(purged.provider).toBeNull()
    expect(purged.titleFromYouTube).toBe(false)
    expect(expireSourceMeta(purged, t0 + 80 * DAY)).toBeNull() // stable afterwards

    const userTitled = { ...base, title: 'my label', titleFromYouTube: false, provider: 'Chan', metaFetchedAt: '2026-09-01T00:00:00Z', notes: 'my notes' }
    const p2 = expireSourceMeta(userTitled, t0 + 40 * DAY)!
    expect(p2.title).toBe('my label') // user label survives
    expect(p2.notes).toBe('my notes') // user notes survive
    expect(p2.provider).toBeNull() // only YouTube-derived data expires
  })

  it('legacy records (no metaFetchedAt) expire from their add time; sites never expire', () => {
    const legacy = { ...base, title: 'Old', provider: 'Chan' } // pre-1.3.3 shape
    expect(isMetaExpired(legacy, t0 + 10 * DAY)).toBe(false)
    expect(isMetaExpired(legacy, t0 + 31 * DAY)).toBe(true)
    const site = { ...base, type: 'site' as const, playlistId: null, title: 'OCW', provider: 'MIT' }
    expect(isMetaExpired(site, t0 + 400 * DAY)).toBe(false)
    const noMeta = { ...base, title: 'typed by user', provider: null }
    expect(isMetaExpired(noMeta, t0 + 400 * DAY)).toBe(false) // nothing stored to expire
  })

  it('user-initiated refresh replaces YouTube-derived/neutral titles but not user labels', () => {
    const info = { title: 'New Fetched Title', author: 'New Chan' }
    const purged = { ...base, title: 'YouTube playlist PLx', titleFromYouTube: false, provider: null, metaFetchedAt: null }
    const refreshed = applyMetaRefresh(purged, info, '2026-10-11T00:00:00Z')
    expect(refreshed.title).toBe('New Fetched Title')
    expect(refreshed.provider).toBe('New Chan')
    expect(refreshed.metaFetchedAt).toBe('2026-10-11T00:00:00Z')
    expect(isMetaExpired(refreshed, Date.parse('2026-10-20T00:00:00Z'))).toBe(false)

    const userTitled = { ...base, title: 'my label', titleFromYouTube: false, provider: null, metaFetchedAt: null }
    expect(applyMetaRefresh(userTitled, info, '2026-10-11T00:00:00Z').title).toBe('my label')
  })
})

describe('acknowledgements — REGRESSION: no cap-based false re-reports', () => {
  it('ackVideos keeps ALL acknowledged ids (a >100 video playlist stays acknowledged)', () => {
    const seen = Array.from({ length: 150 }, (_, i) => `old${i}`)
    const acked = ackVideos(seen, [vid('new1')])
    expect(acked).toHaveLength(151)
    // every previously acknowledged video is still acknowledged
    expect(diffNewVideos(seen.map(vid), acked)).toHaveLength(0)
  })

  it('acks exactly the checked snapshot, deduplicated', () => {
    expect(ackVideos(['a'], [vid('a'), vid('b')])).toEqual(['a', 'b'])
    expect(ackVideos(undefined, [])).toEqual([])
  })
})
