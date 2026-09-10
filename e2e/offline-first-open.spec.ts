import { expect, test } from '@playwright/test'
import { injectPdf, waitForServiceWorker } from './helpers'

/**
 * Regression: offline PDF opening. The pdf.js worker ships as a .mjs asset;
 * it must be precached so that a paper NEVER previously rendered still opens
 * after going offline (import online -> offline -> first open).
 */
test('a never-rendered paper opens offline (worker served from SW cache)', async ({ page, context }) => {
  // 1. online: load the app shell, let the service worker precache everything
  await page.goto('')
  await waitForServiceWorker(page)

  // 2. "import" the PDF for llm-01 while online — but never open/render it
  await injectPdf(page, '01_Transformer_2017.pdf')

  // 3. go offline and cold-reload the app
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('Dashboard').first()).toBeVisible({ timeout: 20_000 })

  // 4. first-ever render of this paper happens fully offline
  await page.goto('#/paper/llm-01')
  const canvas = page.locator('.page-shell canvas').first()
  await expect(canvas).toBeVisible({ timeout: 30_000 })
  // the text layer proves the pdf.js worker executed (not just a cached shell)
  await expect(page.locator('.textLayer').first()).toBeAttached()
  await expect(page.getByText(/\/ 1$/)).toBeVisible() // 1-page doc, page counter rendered

  await context.setOffline(false)
})
