import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { validateBackup } from './backup'

function zipOf(files: Record<string, string>): ArrayBuffer {
  const enc: Record<string, Uint8Array> = {}
  for (const [p, c] of Object.entries(files)) enc[p] = strToU8(c)
  const out = zipSync(enc)
  return out.slice().buffer as ArrayBuffer
}

describe('validateBackup — validate BEFORE any write', () => {
  it('accepts a well-formed backup and summarizes it', () => {
    const s = validateBackup(
      zipOf({
        'progress.json': JSON.stringify({ version: 1, items: { 'llm-01': { status: 'done', updatedAt: 'x' } } }),
        'sessions.json': JSON.stringify({ version: 1, sessions: [{ id: 'a' }] }),
        'notes/llm-01.md': '# hi',
        'decks/llm-01.json': JSON.stringify({ version: 1, cards: [] }),
      }),
    )
    expect(s.ok).toBe(true)
    expect(s.progressItems).toBe(1)
    expect(s.sessions).toBe(1)
    expect(s.counts.notes).toBe(1)
    expect(s.counts.decks).toBe(1)
  })

  it('rejects corrupt JSON with a precise error and ok=false', () => {
    const s = validateBackup(zipOf({ 'progress.json': '{broken', 'notes/x.md': 'fine' }))
    expect(s.ok).toBe(false)
    expect(s.errors.some((e) => e.includes('progress.json'))).toBe(true)
  })

  it('rejects wrong shapes (e.g. decks without a cards array)', () => {
    const s = validateBackup(zipOf({ 'decks/llm-01.json': JSON.stringify({ nope: true }) }))
    expect(s.ok).toBe(false)
    expect(s.errors[0]).toMatch(/cards array/)
  })

  it('rejects non-zip data without throwing', () => {
    const s = validateBackup(new TextEncoder().encode('not a zip').buffer as ArrayBuffer)
    expect(s.ok).toBe(false)
    expect(s.errors[0]).toMatch(/not a readable zip/)
  })

  it('ignores foreign files but keeps lumen docs', () => {
    const s = validateBackup(
      zipOf({ 'README.md': 'x', '__MACOSX/junk': 'y', 'notes/llm-01.md': '# ok' }),
    )
    expect(s.ok).toBe(true)
    expect(s.skipped).toContain('README.md')
    expect(s.files.map((f) => f.path)).toEqual(['notes/llm-01.md'])
  })
})
