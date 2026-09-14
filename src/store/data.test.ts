import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { useData } from './data'
import { getAllDocs, clearAllDocs, getDoc } from '../lib/db'
import { validateBackup } from '../lib/backup'

function zipOf(files: Record<string, string>): ArrayBuffer {
  const enc: Record<string, Uint8Array> = {}
  for (const [p, c] of Object.entries(files)) enc[p] = strToU8(c)
  return zipSync(enc).slice().buffer as ArrayBuffer
}

// disposable in-memory IndexedDB; no network, no real data repository
beforeEach(async () => {
  await clearAllDocs()
  await useData.getState().clearLocal()
  await useData.getState().init()
})

describe('store persistence + restore (disposable fake IndexedDB)', () => {
  it('writes mark docs dirty and track them in dirtyPaths (local save ≠ synced)', async () => {
    useData.getState().setStatus('llm-01', 'reading')
    await new Promise((r) => setTimeout(r, 20))
    expect(useData.getState().dirtyPaths).toContain('progress.json')
    const doc = await getDoc('progress.json')
    expect(doc?.dirty).toBe(true)
    expect(JSON.parse(doc!.content).items['llm-01'].status).toBe('reading')
  })

  it('restore MERGE keeps newer local records and adds backup-only records', async () => {
    useData.getState().setStatus('llm-01', 'done') // local, now
    await new Promise((r) => setTimeout(r, 20))
    const backup = validateBackup(
      zipOf({
        'progress.json': JSON.stringify({
          version: 1,
          items: {
            'llm-01': { status: 'reading', updatedAt: '2020-01-01T00:00:00Z' }, // stale
            'cv-07': { status: 'implementing', updatedAt: '2020-01-01T00:00:00Z' }, // new record
          },
        }),
      }),
    )
    expect(backup.ok).toBe(true)
    await useData.getState().restoreBackup(backup, 'merge')
    const progress = useData.getState().progress
    expect(progress['llm-01'].status).toBe('done') // newer local record preserved
    expect(progress['cv-07'].status).toBe('implementing') // backup record added
  })

  it('restore MERGE preserves a conflicting note as a conflict copy', async () => {
    useData.getState().saveNote('llm-01', '# current note')
    await new Promise((r) => setTimeout(r, 20))
    const backup = validateBackup(zipOf({ 'notes/llm-01.md': '# backup note' }))
    await useData.getState().restoreBackup(backup, 'merge')
    expect(useData.getState().notes['llm-01']).toBe('# current note')
    const conflicts = await useData.getState().listConflicts()
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0].content).toBe('# backup note')
  })

  it('restore REPLACE swaps data wholesale (explicit mode, validated first)', async () => {
    useData.getState().saveNote('llm-01', '# will be replaced')
    await new Promise((r) => setTimeout(r, 20))
    const backup = validateBackup(zipOf({ 'notes/cv-02.md': '# from backup' }))
    await useData.getState().restoreBackup(backup, 'replace')
    expect(useData.getState().notes['llm-01']).toBeUndefined()
    expect(useData.getState().notes['cv-02']).toBe('# from backup')
    const docs = await getAllDocs()
    expect(docs.map((d) => d.path)).toEqual(['notes/cv-02.md'])
  })

  it('restoreBackup refuses invalid backups outright', async () => {
    const bad = validateBackup(zipOf({ 'progress.json': '{nope' }))
    expect(bad.ok).toBe(false)
    await expect(useData.getState().restoreBackup(bad, 'merge')).rejects.toThrow(/validation/)
  })

  it('REGRESSION: addCustomItem reports duplicates instead of silently no-oping', async () => {
    const item = {
      id: 'x-1706.03762',
      order: 1,
      phase: 'Inbox',
      shortName: 'T',
      title: 't',
      year: 2017,
      pdfFile: null,
      addedAt: new Date().toISOString(),
      source: 'manual' as const,
    }
    expect(useData.getState().addCustomItem(item)).toBe(true)
    expect(useData.getState().addCustomItem(item)).toBe(false) // caller must surface this
    expect(useData.getState().customItems).toHaveLength(1)
  })

  it('updateCustomItem stamps updatedAt (attach-PDF path)', async () => {
    const item = {
      id: 'x-m-abc',
      order: 1,
      phase: 'Inbox',
      shortName: 'Book',
      title: 'Book',
      year: '',
      pdfFile: null,
      addedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      source: 'manual' as const,
    }
    useData.getState().addCustomItem(item)
    useData.getState().updateCustomItem({ ...item, pdfFile: 'x-m-abc.pdf' })
    const updated = useData.getState().customItems[0]
    expect(updated.pdfFile).toBe('x-m-abc.pdf')
    expect(updated.updatedAt! > '2026-01-01T00:00:00Z').toBe(true)
  })

  it('exports never contain the YouTube API key (scanned file-by-file)', async () => {
    localStorage.setItem('lumen.youtube.apiKey', 'AIzaSECRETKEY123')
    useData.getState().saveNote('llm-01', '# a note')
    useData.getState().addSource({
      id: 'src-1',
      title: 'CS231n',
      url: 'https://www.youtube.com/playlist?list=PLx',
      type: 'youtube-playlist',
      playlistId: 'PLx',
      addedAt: new Date().toISOString(),
    })
    await new Promise((r) => setTimeout(r, 20))
    const blob = useData.getState().exportAll()
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer))
      r.onerror = () => reject(r.error)
      r.readAsArrayBuffer(blob)
    })
    const files = unzipSync(bytes)
    expect(Object.keys(files)).toContain('sources.json')
    for (const [path, content] of Object.entries(files)) {
      expect(strFromU8(content), path).not.toContain('AIzaSECRETKEY123')
    }
    localStorage.removeItem('lumen.youtube.apiKey')
  })

  it('custom-item removal leaves a tombstone so deletions survive sync', async () => {
    useData.getState().addCustomItem({
      id: 'x-123',
      order: 1,
      phase: 'Inbox',
      shortName: 'x',
      title: 't',
      year: 2026,
      pdfFile: null,
      addedAt: new Date().toISOString(),
      source: 'radar',
    })
    useData.getState().removeCustomItem('x-123')
    await new Promise((r) => setTimeout(r, 20))
    const doc = await getDoc('custom.json')
    const parsed = JSON.parse(doc!.content)
    expect(parsed.items).toHaveLength(0)
    expect(parsed.deleted['x-123']).toBeTruthy()
  })
})
