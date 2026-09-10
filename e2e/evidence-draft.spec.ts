import { expect, test, type Page } from '@playwright/test'

/**
 * Browser recheck of the Evidence-form transition guard (disposable data:
 * fresh browser context, in-app records only, no sync configured).
 *
 * Covers, in a real browser:
 *  1. Edit on record A cannot silently replace unfinished draft B
 *  2. declining the replacement preserves both the form and the stored draft
 *  3. Edit on the SAME record does not reset unsaved changes (and never asks)
 *  4. a draft parked via "Close (keep draft)" stays protected
 */

const ITEM = 'llm-04' // not used by other specs
const DRAFT_KEY = `lumen.evidence-draft.${ITEM}`

function trackDialogs(page: Page) {
  const seen: string[] = []
  const queue: Array<'accept' | 'dismiss'> = []
  page.on('dialog', (d) => {
    seen.push(d.message())
    const action = queue.shift() ?? 'accept'
    void (action === 'accept' ? d.accept() : d.dismiss())
  })
  return { seen, queue }
}

async function storedDraft(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as { form: Record<string, string>; editingId: string | null }) : null
  }, DRAFT_KEY)
}

test('evidence draft transition guard (create A → draft B → edit A …)', async ({ page }) => {
  const dialogs = trackDialogs(page)
  await page.goto(`#/paper/${ITEM}`)
  await page.getByRole('tab', { name: 'Evidence' }).click()

  // --- create experiment A ---
  await page.getByRole('button', { name: 'Experiment', exact: true }).click()
  await page.getByLabel('Title').fill('experiment A')
  await page.getByRole('button', { name: 'Add record' }).click()
  await expect(page.getByText('experiment A', { exact: true })).toBeVisible()
  expect(await storedDraft(page)).toBeNull() // submit cleared the draft

  // --- start unsaved draft B ---
  await page.getByRole('button', { name: 'Experiment', exact: true }).click()
  await page.getByLabel('Title').fill('draft B')
  await expect.poll(async () => (await storedDraft(page))?.form.title).toBe('draft B')

  // --- 1+2: Edit A, DECLINE — nothing may change ---
  dialogs.queue.push('dismiss')
  await page.getByRole('button', { name: 'Edit experiment A' }).click()
  expect(dialogs.seen.at(-1)).toMatch(/replace your unsaved/i)
  await expect(page.getByLabel('Title')).toHaveValue('draft B') // visible form preserved
  expect(await storedDraft(page)).toMatchObject({ form: { title: 'draft B' }, editingId: null }) // stored draft preserved

  // --- accept: deliberate replacement loads A ---
  dialogs.queue.push('accept')
  await page.getByRole('button', { name: 'Edit experiment A' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('experiment A')
  await expect.poll(async () => (await storedDraft(page))?.editingId).not.toBeNull()

  // --- 3: same-record Edit keeps unsaved changes, no dialog ---
  const dialogsBefore = dialogs.seen.length
  await page.getByLabel('Title').fill('A modified')
  await page.getByRole('button', { name: 'Edit experiment A' }).click()
  expect(dialogs.seen.length).toBe(dialogsBefore) // never asked
  await expect(page.getByLabel('Title')).toHaveValue('A modified')

  // reset to a clean slate (discard confirms once)
  dialogs.queue.push('accept')
  await page.getByRole('button', { name: 'Discard draft' }).click()
  await expect(page.getByLabel('Title')).toBeHidden()
  expect(await storedDraft(page)).toBeNull()

  // --- 4: parked draft ("Close (keep draft)") stays protected ---
  await page.getByRole('button', { name: 'Experiment', exact: true }).click()
  await page.getByLabel('Title').fill('parked draft')
  await page.getByRole('button', { name: 'Close (keep draft)' }).click()
  await expect(page.getByLabel('Title')).toBeHidden()
  expect(await storedDraft(page)).toMatchObject({ form: { title: 'parked draft' } })

  dialogs.queue.push('dismiss')
  await page.getByRole('button', { name: 'Edit experiment A' }).click()
  expect(dialogs.seen.at(-1)).toMatch(/replace your unsaved/i)
  await expect(page.getByLabel('Title')).toBeHidden() // still closed
  expect(await storedDraft(page)).toMatchObject({ form: { title: 'parked draft' }, editingId: null })

  dialogs.queue.push('accept')
  await page.getByRole('button', { name: 'Edit experiment A' }).click()
  await expect(page.getByLabel('Title')).toHaveValue('experiment A') // explicit consent replaces
})
