import { expect, test } from '@playwright/test'

/**
 * Radar → Courses. All third-party traffic (YouTube Data API, OpenAlex) is
 * intercepted — no real network, disposable in-browser data only.
 */

const result = (playlistId: string, title: string, channelId: string, publishedAt: string) => ({
  id: { kind: 'youtube#playlist', playlistId },
  snippet: { title, description: 'Full lecture series.', channelId, channelTitle: 'Test University', publishedAt },
})

test.describe('radar courses', () => {
  test('picks work without a key; nothing is fetched until the user searches', async ({ page }) => {
    const calls: string[] = []
    await page.route('**/youtube/v3/**', (route) => {
      calls.push(route.request().url())
      return route.fulfill({ json: { items: [] } })
    })
    await page.route('**/api.openalex.org/**', (route) => {
      calls.push(route.request().url())
      return route.fulfill({ json: { meta: { count: 0 }, results: [] } })
    })

    await page.goto('#/radar?tab=courses')
    await expect(page.getByRole('tab', { name: 'Courses' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('link', { name: /Stanford CS336 — Language Modeling from Scratch \(Spring 2026/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search YouTube' })).toBeDisabled()
    await expect(page.getByText(/Searching needs your YouTube API key/)).toBeVisible()

    // each track has its own picks and catalog links
    await page.getByRole('button', { name: 'Radar & SAR hardware' }).click()
    await expect(page.getByRole('link', { name: /Build a Small Radar System/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Coursera' })).toHaveAttribute('href', /coursera\.org\/search\?query=build/)

    // following a pick puts it in Sources
    await page.getByRole('button', { name: 'Follow Build Your Own Radar' }).click()
    await expect(page.getByText('following')).toBeVisible()
    await page.goto('#/sources')
    await expect(page.getByRole('link', { name: /Build Your Own Radar/ })).toBeVisible()

    expect(calls).toEqual([]) // the courses tab never called YouTube or OpenAlex on its own
  })

  test('search → known channels first → follow → "new" since the last search', async ({ page }) => {
    let items = [
      result('PLrandom', 'Edge AI &amp; TinyML crash course', 'UCrandom', '2026-01-01T00:00:00Z'),
      result('PLhan', 'EfficientML lectures', 'UCcA-9WYwGaUrWiZaEDo84ng', '2026-02-01T00:00:00Z'),
    ]
    let fail = false
    const urls: string[] = []
    await page.route('**/youtube/v3/search**', (route) => {
      urls.push(route.request().url())
      if (fail) return route.fulfill({ status: 403, json: { error: { message: 'quotaExceeded (test)' } } })
      return route.fulfill({ json: { items } })
    })
    await page.addInitScript(() => localStorage.setItem('lumen.youtube.apiKey', 'test-key'))

    await page.goto('#/radar?tab=courses')
    await page.getByRole('button', { name: 'Edge AI', exact: true }).click()
    await page.getByRole('button', { name: 'Search YouTube' }).click()

    const discovery = page.getByRole('region', { name: 'YouTube discovery' })
    await expect(discovery.getByRole('link', { name: 'Edge AI & TinyML crash course' })).toBeVisible() // entities decoded
    await expect(discovery.getByRole('listitem').first()).toContainText('EfficientML lectures') // known channel ranked first
    await expect(discovery.getByText('known course channel')).toHaveCount(1)
    await expect(discovery.getByText('new', { exact: true })).toHaveCount(0) // first search: nothing is "new"
    expect(new URL(urls[0]).searchParams.get('type')).toBe('playlist')

    // follow a result → it becomes a watchable source
    await discovery.getByRole('button', { name: 'Follow EfficientML lectures' }).click()
    await expect(discovery.getByText('following')).toBeVisible()

    // a failed search keeps what is on screen
    fail = true
    await page.getByRole('button', { name: 'Search again' }).click()
    await expect(page.getByRole('alert')).toHaveText(/quotaExceeded.*earlier results below are kept/)
    await expect(discovery.getByRole('link', { name: 'EfficientML lectures' })).toBeVisible()
    fail = false

    // a playlist published after the last successful search is flagged new
    items = [...items, result('PLfresh', 'Brand new course', 'UCrandom', new Date(Date.now() + 60_000).toISOString())]
    await page.getByRole('button', { name: 'Search again' }).click()
    await expect(discovery.getByRole('link', { name: 'Brand new course' })).toBeVisible()
    await expect(discovery.getByText('new', { exact: true })).toHaveCount(1)

    await page.goto('#/sources')
    await expect(page.getByRole('link', { name: /EfficientML lectures/ })).toBeVisible()
    await expect(page.getByText('not baselined yet')).toBeVisible()
  })

  test('papers stay the default Radar view and do not touch YouTube', async ({ page }) => {
    const yt: string[] = []
    await page.route('**/youtube/v3/**', (route) => {
      yt.push(route.request().url())
      return route.fulfill({ json: { items: [] } })
    })
    await page.route('**/api.openalex.org/**', (route) => route.fulfill({ json: { meta: { count: 0 }, results: [] } }))
    await page.goto('#/radar')
    await expect(page.getByRole('tab', { name: 'Papers' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByLabel('Research any topic')).toBeVisible()
    await page.getByRole('tab', { name: 'Courses' }).click()
    await expect(page.getByLabel('Find courses on any topic')).toBeVisible()
    expect(yt).toEqual([])
  })
})
