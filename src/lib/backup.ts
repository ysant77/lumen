import { strFromU8, unzipSync } from 'fflate'

/** Paths a lumen backup may contain (same set the sync engine tracks). */
export const BACKUP_PATH =
  /^(progress\.json|sessions\.json|custom\.json|radar\.json|queue\.json|notes\/.+\.md|code\/.+\.json|decks\/.+\.json|experiments\/.+\.json)$/

export interface BackupSummary {
  ok: boolean
  files: Array<{ path: string; content: string }>
  counts: { notes: number; decks: number; code: number; experiments: number; other: number }
  progressItems: number
  sessions: number
  errors: string[]
  skipped: string[]
}

/**
 * Parse and validate a backup zip BEFORE anything is written.
 * Every JSON doc must parse and have the expected top-level shape.
 */
export function validateBackup(data: ArrayBuffer): BackupSummary {
  const summary: BackupSummary = {
    ok: false,
    files: [],
    counts: { notes: 0, decks: 0, code: 0, experiments: 0, other: 0 },
    progressItems: 0,
    sessions: 0,
    errors: [],
    skipped: [],
  }
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(new Uint8Array(data))
  } catch (e: any) {
    summary.errors.push(`not a readable zip: ${e?.message ?? e}`)
    return summary
  }
  for (const [path, bytes] of Object.entries(entries)) {
    if (path.endsWith('/')) continue
    if (!BACKUP_PATH.test(path)) {
      summary.skipped.push(path)
      continue
    }
    let content: string
    try {
      content = strFromU8(bytes)
    } catch {
      summary.errors.push(`${path}: not valid UTF-8`)
      continue
    }
    if (path.endsWith('.json')) {
      try {
        const parsed = JSON.parse(content)
        const shapeError = checkShape(path, parsed)
        if (shapeError) {
          summary.errors.push(`${path}: ${shapeError}`)
          continue
        }
        if (path === 'progress.json') summary.progressItems = Object.keys(parsed.items ?? {}).length
        if (path === 'sessions.json') summary.sessions = (parsed.sessions ?? []).length
      } catch (e: any) {
        summary.errors.push(`${path}: invalid JSON (${e?.message ?? e})`)
        continue
      }
    }
    summary.files.push({ path, content })
    if (path.startsWith('notes/')) summary.counts.notes++
    else if (path.startsWith('decks/')) summary.counts.decks++
    else if (path.startsWith('code/')) summary.counts.code++
    else if (path.startsWith('experiments/')) summary.counts.experiments++
    else summary.counts.other++
  }
  if (summary.files.length === 0) summary.errors.push('backup contains no lumen data files')
  summary.ok = summary.errors.length === 0
  return summary
}

function checkShape(path: string, parsed: any): string | null {
  if (typeof parsed !== 'object' || parsed === null) return 'not an object'
  if (path === 'progress.json' && typeof parsed.items !== 'object') return 'missing items map'
  if (path === 'sessions.json' && !Array.isArray(parsed.sessions)) return 'missing sessions array'
  if (path === 'custom.json' && !Array.isArray(parsed.items)) return 'missing items array'
  if (path === 'radar.json' && !Array.isArray(parsed.topics)) return 'missing topics array'
  if (/^decks\//.test(path) && !Array.isArray(parsed.cards)) return 'missing cards array'
  if (/^code\//.test(path) && !Array.isArray(parsed.snippets)) return 'missing snippets array'
  if (/^experiments\//.test(path) && !Array.isArray(parsed.records)) return 'missing records array'
  return null
}
