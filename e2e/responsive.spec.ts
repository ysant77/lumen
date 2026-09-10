import { expect, test } from '@playwright/test'
import { injectPdf } from './helpers'

/** Viewport-emulation checks (real iPad/Windows checks are reported separately). */

test('tablet portrait (834×1112): navigation collapses to bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1112 })
  await page.goto('')
  // CSS locator (role locators skip display:none elements entirely)
  const navs = page.locator('nav[aria-label="Primary"]')
  await expect(navs).toHaveCount(2)
  await expect(navs.first()).toBeHidden() // sidebar/rail (first in DOM) hidden below lg
  await expect(navs.last()).toBeVisible() // bottom bar
  const box = (await navs.last().boundingBox())!
  expect(box.y).toBeGreaterThan(900) // pinned to the bottom of the viewport
})

test('tablet landscape (1194×834): icon rail without labels', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 })
  await page.goto('')
  const rail = page.getByRole('navigation', { name: 'Primary' }).first()
  await expect(rail).toBeVisible()
  // labels are hidden below xl — the Library link exists but shows no text
  const label = rail.getByText('Library')
  await expect(label).toBeHidden()
})

test('wide desktop (1440×900): full sidebar labels', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('')
  const rail = page.getByRole('navigation', { name: 'Primary' }).first()
  await expect(rail.getByText('Library')).toBeVisible()
})

test('phone (390×844): two-line title with status controls below it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('#/paper/llm-05') // GPT-3: long title
  const title = page.getByRole('heading', { level: 1 })
  await expect(title).toBeVisible()
  const status = page.getByRole('combobox').first()
  const titleBox = (await title.boundingBox())!
  const statusBox = (await status.boundingBox())!
  expect(statusBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 2) // below the title
  // two-line clamp applied on phones
  await expect(title).toHaveClass(/line-clamp-2/)
})

test('desktop split divider adjusts the reader/workspace ratio and persists', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 })
  await page.goto('')
  await injectPdf(page, '01_Transformer_2017.pdf')
  await page.goto('#/paper/llm-01')
  await page.getByRole('button', { name: 'Split' }).click()

  const divider = page.getByRole('separator', { name: /Resize reader/ })
  await expect(divider).toBeVisible()
  const before = (await page.locator('.page-shell').first().boundingBox())!.width

  const box = (await divider.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x - 320, box.y + 200, { steps: 8 })
  await page.mouse.up()

  await expect
    .poll(async () => (await page.locator('.page-shell').first().boundingBox())!.width)
    .toBeLessThan(before - 100)

  const stored = await page.evaluate(() => Number(localStorage.getItem('lumen.splitRatio')))
  expect(stored).toBeGreaterThanOrEqual(0.25)
  expect(stored).toBeLessThan(0.5)
})
