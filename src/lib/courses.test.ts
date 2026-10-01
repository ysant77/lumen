import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  COURSE_PICKS,
  DEFAULT_TRACKS,
  KNOWN_CHANNELS,
  buildPlaylistSearchUrl,
  decodeEntities,
  elsewhereLinks,
  isFollowed,
  mapSearchItems,
  pickToSource,
  picksForTrack,
  playlistToSource,
  rankPlaylists,
  searchCoursePlaylists,
  type CoursePlaylist,
} from './courses'
import { isMetaExpired, parseYouTubeUrl } from './youtube'

afterEach(() => vi.unstubAllGlobals())

const item = (playlistId: string, channelId = 'UCother', title = `Course ${playlistId}`) => ({
  id: { kind: 'youtube#playlist', playlistId },
  snippet: { title, description: 'd', channelId, channelTitle: 'Chan', publishedAt: '2026-09-01T00:00:00Z' },
})

describe('curated course picks', () => {
  it('have unique ids, https links and a track that exists', () => {
    const trackIds = new Set(DEFAULT_TRACKS.map((t) => t.id))
    expect(new Set(COURSE_PICKS.map((p) => p.id)).size).toBe(COURSE_PICKS.length)
    expect(new Set(COURSE_PICKS.map((p) => p.url)).size).toBe(COURSE_PICKS.length)
    for (const p of COURSE_PICKS) {
      expect(p.url, p.id).toMatch(/^https:\/\//)
      expect(trackIds.has(p.track), p.id).toBe(true)
      expect(['free', 'audit'], p.id).toContain(p.access)
    }
  })

  it('playlist picks carry the playlist id their url points at', () => {
    for (const p of COURSE_PICKS) {
      if (p.type === 'youtube-playlist') {
        expect(parseYouTubeUrl(p.url)?.playlistId, p.id).toBe(p.playlistId)
      } else {
        expect(p.playlistId, p.id).toBeUndefined()
      }
    }
  })

  it('every default track has picks', () => {
    for (const t of DEFAULT_TRACKS) expect(picksForTrack(t.id).length, t.id).toBeGreaterThan(0)
  })
})

describe('youtube playlist search', () => {
  it('builds a playlist-only search.list request', () => {
    const u = new URL(buildPlaylistSearchUrl('tinyml course', 'KEY', 'date'))
    expect(u.origin + u.pathname).toBe('https://www.googleapis.com/youtube/v3/search')
    expect(u.searchParams.get('type')).toBe('playlist')
    expect(u.searchParams.get('q')).toBe('tinyml course')
    expect(u.searchParams.get('order')).toBe('date')
    expect(u.searchParams.get('key')).toBe('KEY')
  })

  it('maps items, decodes escaped titles, drops non-playlists and duplicates', () => {
    const mapped = mapSearchItems([
      item('PL1', 'UCother', 'Signals &amp; Systems &#39;26 &quot;full&quot;'),
      { id: { videoId: 'v1' }, snippet: { title: 'a video' } } as any,
      item('PL1'),
      { id: { playlistId: 'PL2' } },
    ])
    expect(mapped).toHaveLength(1)
    expect(mapped[0].title).toBe('Signals & Systems \'26 "full"')
  })

  it('does not double-decode', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;')
  })

  it('ranks known course channels first and keeps API order within groups', () => {
    const known = Object.keys(KNOWN_CHANNELS)[0]
    const list = mapSearchItems([item('a'), item('b', known), item('c'), item('d', known)])
    expect(rankPlaylists(list).map((p) => p.playlistId)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('surfaces the API error message (e.g. quota) instead of a bare status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: { message: 'quotaExceeded' } }) })),
    )
    await expect(searchCoursePlaylists('q', 'KEY')).rejects.toThrow('quotaExceeded')
  })

  it('returns ranked results on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ items: [item('x'), item('y')] }) })),
    )
    expect((await searchCoursePlaylists('q', 'KEY')).map((p) => p.playlistId)).toEqual(['x', 'y'])
  })
})

describe('following', () => {
  const p: CoursePlaylist = {
    playlistId: 'PLabc',
    title: 'A Course',
    description: '',
    channelId: 'UCx',
    channelTitle: 'Some University',
    publishedAt: '2026-09-01T00:00:00Z',
  }

  it('a followed search result is a watchable source whose YouTube metadata expires', () => {
    const now = '2026-10-01T00:00:00.000Z'
    const s = playlistToSource(p, 'id-1', now)
    expect(s.type).toBe('youtube-playlist')
    expect(s.url).toBe('https://www.youtube.com/playlist?list=PLabc')
    expect(s.titleFromYouTube).toBe(true)
    expect(s.metaFetchedAt).toBe(now)
    expect(isMetaExpired(s, Date.parse(now) + 29 * 864e5)).toBe(false)
    expect(isMetaExpired(s, Date.parse(now) + 31 * 864e5)).toBe(true)
  })

  it('a followed pick keeps lumen\'s own title (not YouTube-derived)', () => {
    const pick = COURSE_PICKS.find((x) => x.type === 'youtube-playlist')!
    const s = pickToSource(pick, 'id-2', '2026-10-01T00:00:00.000Z')
    expect(s.title).toBe(pick.title)
    expect(s.titleFromYouTube).toBeUndefined()
    expect(s.playlistId).toBe(pick.playlistId)
  })

  it('detects followed courses by url or playlist id', () => {
    const sources = [{ url: 'https://www.youtube.com/watch?v=v&list=PLabc', playlistId: 'PLabc' }]
    expect(isFollowed(sources, { url: 'https://www.youtube.com/playlist?list=PLabc', playlistId: 'PLabc' })).toBe(true)
    expect(isFollowed(sources, { url: 'https://example.org/course' })).toBe(false)
    expect(isFollowed([{ url: 'https://example.org/course', playlistId: null }], { url: 'https://example.org/course' })).toBe(true)
  })

  it('builds encoded search links for catalogs without an API', () => {
    const links = elsewhereLinks('edge ai & tinyml')
    expect(links.map((l) => l.label)).toContain('Coursera')
    for (const l of links) expect(l.url).toContain('edge%20ai%20%26%20tinyml')
  })
})
