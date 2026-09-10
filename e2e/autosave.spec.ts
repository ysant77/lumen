import { expect, test } from '@playwright/test'

/**
 * Regression: "note autosave loss when switching tabs/navigating immediately
 * after typing". Types into the notes editor and immediately leaves — the
 * draft must survive without waiting for the 800 ms debounce.
 */
test('notes typed right before switching tabs are not lost', async ({ page }) => {
  await page.goto('#/paper/llm-01')
  await expect(page.getByRole('tab', { name: 'Notes' })).toBeVisible()

  const editor = page.locator('.cm-content').first()
  await editor.click()
  const marker = `autosave-check-${Date.now()}`
  await page.keyboard.press('End')
  await page.keyboard.type(`\n${marker}`)

  // switch tabs IMMEDIATELY (well inside the debounce window)
  await page.getByRole('tab', { name: 'Code' }).click()
  await page.getByRole('tab', { name: 'Notes' }).click()
  await expect(page.locator('.cm-content').first()).toContainText(marker)

  // navigate away entirely, then hard-reload: content must come from IndexedDB
  await page.getByRole('link', { name: 'Library' }).first().click()
  await page.reload()
  await page.goto('#/paper/llm-01')
  await expect(page.locator('.cm-content').first()).toContainText(marker)
})

test('note typed immediately before full navigation survives a reload', async ({ page }) => {
  await page.goto('#/paper/llm-02')
  const editor = page.locator('.cm-content').first()
  await editor.click()
  const marker = `nav-loss-check-${Date.now()}`
  await page.keyboard.press('End')
  await page.keyboard.type(`\n${marker}`)
  // immediate SPA navigation (unmounts the editor before the debounce fires)
  await page.getByRole('link', { name: 'Dashboard' }).first().click()
  await page.goto('#/paper/llm-02')
  await expect(page.locator('.cm-content').first()).toContainText(marker)
})
