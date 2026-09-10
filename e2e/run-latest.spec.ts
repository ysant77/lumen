import { expect, test } from '@playwright/test'

/**
 * Regression: "Code Run using stale saved source". The Pyodide CDN is stubbed
 * so the run pipeline executes instantly and deterministically; the fake
 * runtime echoes the exact source it received.
 */
test('Run executes the latest editor draft, not the stale saved source', async ({ page, context }) => {
  await context.route('**/pyodide/**/pyodide.mjs', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `export async function loadPyodide() {
        return {
          loadedPackages: {},
          loadPackage: async () => {},
          loadPackagesFromImports: async () => {},
          setStdout: () => {},
          setStderr: () => {},
          runPythonAsync: async (code) => {
            if (code.includes('_figs')) return { toJs: () => [], destroy: () => {} }
            return 'ECHO::' + code
          },
        }
      }`,
    }),
  )

  await page.goto('#/paper/llm-03')
  await page.getByRole('tab', { name: 'Code' }).click()
  await page.getByRole('button', { name: 'New experiment' }).click()

  const editor = page.locator('.cm-content').first()
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a')
  const marker = `latest_draft_${Date.now()}`
  await page.keyboard.type(`print("${marker}")`)

  // Run IMMEDIATELY — inside the save debounce window
  await page.getByRole('button', { name: 'Run', exact: true }).click()

  // the fake runtime echoes the executed source: it must contain the marker
  await expect(page.locator('pre', { hasText: `ECHO::` })).toContainText(marker, { timeout: 30_000 })

  // and the draft was persisted (reload -> editor still shows it)
  await page.reload()
  await page.getByRole('tab', { name: 'Code' }).click()
  await expect(page.locator('.cm-content').first()).toContainText(marker)
})
