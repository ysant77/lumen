import type { Doc, SyncConfig, SyncReport } from '../types'
import { fetchBlobText, fetchHead, pushFiles, type RemoteHead } from './github'

const CONFIG_KEY = 'lumen.sync.config'
const TRACKED =
  /^(progress\.json|sessions\.json|custom\.json|radar\.json|notes\/.+\.md|code\/.+\.json|decks\/.+\.json)$/

export function getSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as SyncConfig
    if (!cfg.owner || !cfg.repo || !cfg.token) return null
    return { ...cfg, branch: cfg.branch || 'main', auto: cfg.auto ?? true }
  } catch {
    return null
  }
}

export function setSyncConfig(cfg: SyncConfig | null) {
  if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
  else localStorage.removeItem(CONFIG_KEY)
}

export interface SyncStore {
  /** all local docs */
  list(): Promise<Doc[]>
  /** apply a doc that arrived from remote (not dirty) */
  applyRemote(path: string, content: string, remoteSha: string): Promise<void>
  /** mark a local doc as pushed */
  markPushed(path: string, remoteSha: string): Promise<void>
}

/**
 * Two-way sync with the data repo.
 *
 * Model: single user, several devices. Per file, last writer wins:
 *  - remote changed + local clean  -> take remote
 *  - remote changed + local dirty  -> keep local (it wins on push); counted as conflict
 *  - local dirty                   -> pushed as one batch commit
 */
export async function runSync(cfg: SyncConfig, store: SyncStore): Promise<SyncReport> {
  const report: SyncReport = { pulled: 0, pushed: 0, conflictsKeptLocal: 0, at: new Date().toISOString() }

  let head: RemoteHead | null = await fetchHead(cfg)
  const local = new Map((await store.list()).map((d) => [d.path, d]))

  // ---- pull ----
  if (head) {
    for (const f of head.files) {
      if (!TRACKED.test(f.path)) continue
      const doc = local.get(f.path)
      if (doc?.remoteSha === f.sha) continue
      if (doc?.dirty) {
        report.conflictsKeptLocal++
        continue
      }
      const content = await fetchBlobText(cfg, f.sha)
      await store.applyRemote(f.path, content, f.sha)
      report.pulled++
    }
  }

  // ---- push ----
  const dirty = (await store.list()).filter((d) => d.dirty && TRACKED.test(d.path))
  if (dirty.length > 0) {
    const message = `sync: ${dirty.length} file${dirty.length === 1 ? '' : 's'} from ${deviceLabel()}`
    const files = dirty.map((d) => ({ path: d.path, content: d.content }))
    let pushed
    try {
      pushed = await pushFiles(cfg, files, message, head)
    } catch {
      // ref moved between pull and push (another device); refresh head and retry once
      head = await fetchHead(cfg)
      pushed = await pushFiles(cfg, files, message, head)
    }
    for (const d of dirty) {
      await store.markPushed(d.path, pushed.blobShas.get(d.path) ?? '')
    }
    report.pushed = dirty.length
  }

  return report
}

function deviceLabel(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (/iPad|iPhone/.test(ua)) return 'iPad'
  if (/Macintosh/.test(ua)) return 'Mac'
  if (/Windows/.test(ua)) return 'Windows'
  if (/Linux/.test(ua)) return 'Linux'
  return 'device'
}

export const __test__ = { TRACKED }
