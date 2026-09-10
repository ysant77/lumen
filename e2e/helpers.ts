import type { Page } from '@playwright/test'

/** Build a small but valid single-page PDF with correct xref offsets. */
export function tinyPdf(): Uint8Array {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    '<</Length 44>>stream\nBT /F1 24 Tf 72 720 Td (lumen e2e page) Tj ET\nendstream',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefPos = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  const trailer = `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`
  return new TextEncoder().encode(body + xref + trailer)
}

/** Write a PDF into the app's OPFS store (pdfs/<name>) from inside the page. */
export async function injectPdf(page: Page, name: string) {
  const bytes = Array.from(tinyPdf())
  await page.evaluate(
    async ({ name, bytes }) => {
      const root = await navigator.storage.getDirectory()
      const dir = await root.getDirectoryHandle('pdfs', { create: true })
      const fh = await dir.getFileHandle(name, { create: true })
      const w = await (fh as any).createWritable()
      await w.write(new Uint8Array(bytes))
      await w.close()
    },
    { name, bytes },
  )
}

/** Wait until the service worker is activated and controlling the page. */
export async function waitForServiceWorker(page: Page) {
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
        // claim may already have happened between checks
        if (navigator.serviceWorker.controller) resolve()
      })
    }
    return reg.active?.state
  })
}
