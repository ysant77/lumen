import { expect, test, type Page } from '@playwright/test'
import { tinyPdf } from './helpers'

/**
 * Browser regressions for the v1.3.1 corrective release. All third-party
 * traffic (YouTube Data API, oEmbed, OpenAlex) is intercepted — no real
 * network, disposable in-browser data only.
 */

function makeWork(title: string) {
  return {
    id: `https://openalex.org/W-${title.replace(/\W+/g, '')}`,
    display_name: title,
    publication_date: '2026-09-01',
    doi: null,
    cited_by_count: 0,
    abstract_inverted_index: null,
    primary_location: { landing_page_url: null, pdf_url: null, source: { display_name: 'Test Venue' } },
    locations: [],
    authorships: [],
  }
}

async function stubOpenAlexIdle(page: Page) {
  await page.route('**/api.openalex.org/**', (route) =>
    route.fulfill({ json: { meta: { count: 0 }, results: [] } }),
  )
}

test.describe('watcher (multi-page playlists, baselines, failures, snapshot acks)', () => {
  test('paginated check → baseline → new-at-END detection → failure keeps pending → snapshot-only ack', async ({ page }) => {
    // mutable fake playlist server state
    let page2Extra: string[] = []
    let failMode = false
    await page.route('**/youtube/v3/playlistItems**', (route) => {
      if (failMode) {
        return route.fulfill({ status: 403, json: { error: { message: 'quotaExceeded (test)' } } })
      }
      const u = new URL(route.request().url())
      const token = u.searchParams.get('pageToken')
      const item = (id: string) => ({
        snippet: { title: `Lecture ${id}`, publishedAt: '2026-09-01T00:00:00Z', resourceId: { videoId: id } },
      })
      if (!token) {
        return route.fulfill({ json: { nextPageToken: 'P2', items: [item('v1'), item('v2')] } })
      }
      return route.fulfill({ json: { items: [item('v3'), ...page2Extra.map(item)] } })
    })
    await page.route('**/www.youtube.com/oembed*', (route) =>
      route.fulfill({ json: { title: 'Test Course Lectures', author_name: 'Test University' } }),
    )
    await page.addInitScript(() => localStorage.setItem('lumen.youtube.apiKey', 'test-key'))

    await page.goto('#/sources')
    await page.getByLabel(/URL \(YouTube/).fill('https://www.youtube.com/playlist?list=PLTEST123')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByText('Test Course Lectures')).toBeVisible()

    // 1st check: full pagination baseline (3 videos across 2 pages)
    const checkBtn = page.getByRole('button', { name: /Check Test Course Lectures/ })
    await checkBtn.click()
    await expect(page.getByText(/Baseline established \(3 existing videos/)).toBeVisible()

    // a lecture is appended at the END of the playlist (page 2)
    page2Extra = ['v4']
    await checkBtn.click()
    await expect(page.getByText('1 new video')).toBeVisible()
    await expect(page.getByRole('link', { name: /Lecture v4/ })).toBeVisible()

    // an API failure must keep the pending result and not fake a successful check
    failMode = true
    await checkBtn.click()
    await expect(page.getByText(/check failed: quotaExceeded/)).toBeVisible()
    await expect(page.getByText(/earlier results below are kept/)).toBeVisible()
    await expect(page.getByRole('link', { name: /Lecture v4/ })).toBeVisible()
    failMode = false

    // v5 uploads BETWEEN the last check and "mark seen": ack must cover only
    // the checked snapshot (v1..v4), so v5 is still reported afterwards
    page2Extra = ['v4', 'v5']
    await page.getByRole('button', { name: 'mark seen' }).click()
    await checkBtn.click()
    await expect(page.getByText('1 new video')).toBeVisible()
    await expect(page.getByRole('link', { name: /Lecture v5/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Lecture v4/ })).toBeHidden()
  })

  test('saving and clearing the API key updates controls and status immediately', async ({ page }) => {
    await page.goto('#/sources')
    const status = page.getByTestId('key-status')
    await expect(status).toHaveText(/no key/)
    await page.getByLabel('YouTube Data API key').fill('abc-123')
    await page.getByRole('button', { name: 'Save key' }).click()
    await expect(status).toHaveText(/key set \(device-local\)/)
    await page.getByRole('button', { name: 'Clear key' }).click()
    await expect(status).toHaveText(/no key/)
    await expect(page.getByRole('button', { name: 'Clear key' })).toBeDisabled()
  })

  test('malformed source URLs are rejected with a visible error', async ({ page }) => {
    await page.goto('#/sources')
    await page.getByLabel(/URL \(YouTube/).fill('javascript:alert(1)')
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByRole('alert')).toHaveText(/valid http\(s\) URL/)
  })
})

test.describe('research & manual books', () => {
  test('REGRESSION: delayed topic-A response never overwrites topic-B results', async ({ page }) => {
    await page.route('**/api.openalex.org/**', async (route) => {
      const u = new URL(route.request().url())
      const q = u.searchParams.get('search') ?? ''
      if (q.includes('slowtopic')) {
        await new Promise((r) => setTimeout(r, 1500))
        return route.fulfill({ json: { meta: { count: 1 }, results: [makeWork('SLOW RESULT paper')] } })
      }
      if (q.includes('fasttopic')) {
        return route.fulfill({ json: { meta: { count: 1 }, results: [makeWork('FAST RESULT paper')] } })
      }
      return route.fulfill({ json: { meta: { count: 0 }, results: [] } })
    })
    await page.goto('#/radar')
    const box = page.getByLabel('Research any topic')
    await box.fill('slowtopic transformers')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    // immediately search something else while the slow request is in flight
    await box.fill('fasttopic ssm')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect(page.getByText('FAST RESULT paper')).toBeVisible()
    // the obsolete slow response must be ignored, not shown under topic B
    await page.waitForTimeout(1800)
    await expect(page.getByText('FAST RESULT paper')).toBeVisible()
    await expect(page.getByText('SLOW RESULT paper')).toBeHidden()
  })

  test('all-time research mode queries relevance without a date window', async ({ page }) => {
    const urls: string[] = []
    await page.route('**/api.openalex.org/**', (route) => {
      urls.push(route.request().url())
      return route.fulfill({ json: { meta: { count: 0 }, results: [] } })
    })
    await page.goto('#/radar')
    await page.getByLabel('Search mode').selectOption('alltime')
    await page.getByLabel('Research any topic').fill('kalman filters')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect.poll(() => urls.some((u) => u.includes('relevance_score'))).toBe(true)
    const last = urls[urls.length - 1]
    expect(last).not.toContain('from_publication_date')
  })

  test('Unicode book: manual add → attach a local PDF → read it', async ({ page }) => {
    await stubOpenAlexIdle(page)
    await page.goto('#/radar')
    await page.getByLabel('Add a specific paper or book').fill('深層学習 改訂第2版')
    await page.getByRole('button', { name: 'Look up' }).click()
    await expect(page.getByText(/add it manually below/)).toBeVisible()
    await page.getByLabel('Title (required)').fill('深層学習 改訂第2版')
    await page.getByRole('button', { name: 'Add to Inbox' }).click()
    await expect(page.getByText('Added to your Inbox.')).toBeVisible()

    await page.goto('#/library/inbox')
    await page.getByText('深層学習 改訂第2版').first().click()
    await expect(page.getByRole('button', { name: /Attach a PDF from this device/ })).toBeVisible()
    await page
      .locator('input[type="file"][accept*="pdf"]')
      .setInputFiles({ name: 'book.pdf', mimeType: 'application/pdf', buffer: Buffer.from(tinyPdf()) })
    await expect(page.locator('.page-shell canvas').first()).toBeVisible({ timeout: 20_000 })
  })

  test('manual entries reject non-http(s) links and duplicates are explicit', async ({ page }) => {
    await stubOpenAlexIdle(page)
    await page.goto('#/radar')
    await page.getByLabel('Add a specific paper or book').fill('Some Textbook')
    await page.getByRole('button', { name: 'Look up' }).click()
    await page.getByLabel('Title (required)').fill('Some Textbook')
    await page.getByLabel(/Link \(book page/).fill('javascript:alert(1)')
    await page.getByRole('button', { name: 'Add to Inbox' }).click()
    await expect(page.getByText(/valid http\(s\) URL/)).toBeVisible()

    // fix the link → added; adding the same title again asks (declined → not duplicated)
    await page.getByLabel(/Link \(book page/).fill('https://example.org/book')
    await page.getByRole('button', { name: 'Add to Inbox' }).click()
    await expect(page.getByText('Added to your Inbox.')).toBeVisible()
    page.once('dialog', (d) => d.dismiss())
    await page.getByLabel('Add a specific paper or book').fill('Some Textbook')
    await page.getByRole('button', { name: 'Look up' }).click()
    await page.getByLabel('Title (required)').fill('Some Textbook')
    await page.getByRole('button', { name: 'Add to Inbox' }).click()
    await expect(page.getByText(/Not added — already in your Inbox/)).toBeVisible()
  })
})
