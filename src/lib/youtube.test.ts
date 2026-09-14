import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ackVideos,
  diffNewVideos,
  embedUrl,
  fetchAllPlaylistItems,
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
