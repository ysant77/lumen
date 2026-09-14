import { describe, expect, it } from 'vitest'
import { diffNewVideos, embedUrl, mergeSeen, parseYouTubeUrl } from './youtube'

describe('youtube url parsing (sanctioned surfaces only)', () => {
  it('parses playlist, watch, youtu.be and embed URLs', () => {
    expect(parseYouTubeUrl('https://www.youtube.com/playlist?list=PL3FW7Lu3i5JvHM8ljYj-zLfQRF3EO8sYv')).toEqual({
      playlistId: 'PL3FW7Lu3i5JvHM8ljYj-zLfQRF3EO8sYv',
      videoId: null,
    })
    expect(parseYouTubeUrl('https://www.youtube.com/watch?v=abc123XYZ_-&list=PLxyz')).toEqual({
      playlistId: 'PLxyz',
      videoId: 'abc123XYZ_-',
    })
    expect(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({
      playlistId: null,
      videoId: 'dQw4w9WgXcQ',
    })
    expect(parseYouTubeUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toEqual({
      playlistId: null,
      videoId: 'dQw4w9WgXcQ',
    })
  })

  it('rejects non-YouTube URLs and garbage', () => {
    expect(parseYouTubeUrl('https://vimeo.com/12345')).toBeNull()
    expect(parseYouTubeUrl('https://ocw.mit.edu/')).toBeNull()
    expect(parseYouTubeUrl('not a url')).toBeNull()
    expect(parseYouTubeUrl('https://www.youtube.com/@channel')).toBeNull()
  })

  it('builds privacy-enhanced embed urls', () => {
    expect(embedUrl({ videoId: 'abc' })).toBe('https://www.youtube-nocookie.com/embed/abc')
    expect(embedUrl({ playlistId: 'PLx' })).toBe('https://www.youtube-nocookie.com/embed/videoseries?list=PLx')
    expect(embedUrl({})).toBeNull()
  })
})

describe('watcher diff (pure, user-initiated persistence)', () => {
  const vids = [
    { videoId: 'v3', title: 'Lecture 3', publishedAt: '2026-09-10' },
    { videoId: 'v2', title: 'Lecture 2', publishedAt: '2026-09-03' },
    { videoId: 'v1', title: 'Lecture 1', publishedAt: '2026-08-27' },
  ]

  it('reports only videos not yet marked seen', () => {
    expect(diffNewVideos(vids, ['v1', 'v2']).map((v) => v.videoId)).toEqual(['v3'])
    expect(diffNewVideos(vids, undefined)).toHaveLength(3)
    expect(diffNewVideos(vids, ['v1', 'v2', 'v3'])).toHaveLength(0)
  })

  it('mergeSeen keeps newest-first, dedupes and caps', () => {
    expect(mergeSeen(vids, ['v1', 'v0'])).toEqual(['v3', 'v2', 'v1', 'v0'])
    expect(mergeSeen(vids, ['v9'], 2)).toEqual(['v3', 'v2'])
  })
})
