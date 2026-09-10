import type { Doc, SyncConfig, SyncReport } from '../types'
import { fetchBlobText, fetchHead, pushFiles, type RemoteHead } from './github'
import { mergeDocs } from './merge'

const CONFIG_KEY = 'lumen.sync.config'
const TRACKED =
  /^(progress\.json|sessions\.json|custom\.json|radar\.json|queue\.json|notes\/.+\.md|code\/.+\.json|decks\/.+\.json|experiments\/.+\.json)$/

export function getSyncConfig(): SyncConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const cfg = JSON.parse(raw) as SyncConfig
    if (!cfg.owner || !cfg.repo || !cfg.token) return null
    // auto-push is opt-in: absent flag means manual sync only
    return { ...cfg, branch: cfg.branch || 'main', auto: cfg.auto ?? false }
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
  /** clean write-through of a remote doc (local was not modified) */
  applyRemote(path: string, content: string, remoteSha: string): Promise<void>
  /** write a merged doc: stays dirty (will be pushed), remembers the remote sha it merged against */
  applyMerged(path: string, content: string, remoteSha: string): Promise<void>
  /** preserve the losing side of an unmergeable conflict as a new dirty doc */
  saveConflictCopy(path: string, content: string): Promise<void>
  /**
   * Mark a doc clean ONLY if it is still the exact revision that was uploaded
   * (identified by updatedAt captured at push time). Later edits stay dirty.
   */
  markPushed(path: string, remoteSha: string, pushedUpdatedAt: number): Promise<void>
}

/**
 * Two-way sync with the data repo.
 *
 * Pull: per file —
 *   - unknown/clean local        -> take remote
 *   - dirty local, structured    -> record-level merge (both devices' records survive)
 *   - dirty local, opaque        -> local stays live; remote saved as a conflict copy
 * Push: one batch commit of everything dirty. Only the exact uploaded revision
 * is marked clean; concurrent edits remain pending for the next sync.
 */
export async function runSync(cfg: SyncConfig, store: SyncStore): Promise<SyncReport> {
  const report: SyncReport = {
    pulled: 0,
    pushed: 0,
    merged: 0,
    conflictsSaved: 0,
    at: new Date().toISOString(),
  }

  let head: RemoteHead | null = await fetchHead(cfg)
  const local = new Map((await store.list()).map((d) => [d.path, d]))

  // ---- pull & merge ----
  if (head) {
    for (const f of head.files) {
      if (!TRACKED.test(f.path)) continue
      const doc = local.get(f.path)
      if (doc?.remoteSha === f.sha) continue
      const content = await fetchBlobText(cfg, f.sha)
      if (!doc || !doc.dirty) {
        await store.applyRemote(f.path, content, f.sha)
        report.pulled++
        continue
      }
      if (doc.content === content) {
        // same bytes on both sides: adopt remote identity, nothing to push
        await store.applyRemote(f.path, content, f.sha)
        continue
      }
      const result = mergeDocs(f.path, doc.content, content)
      if (result.kind === 'takeRemote') {
        await store.applyRemote(f.path, content, f.sha)
        report.pulled++
      } else if (result.kind === 'merged') {
        await store.applyMerged(f.path, result.content, f.sha)
        report.merged++
      } else {
        await store.saveConflictCopy(result.conflictPath, result.conflictContent)
        report.conflictsSaved++
      }
    }
  }

  // ---- push ----
  const dirty = (await store.list()).filter((d) => d.dirty && TRACKED.test(d.path))
  if (dirty.length > 0) {
    const message = `sync: ${dirty.length} file${dirty.length === 1 ? '' : 's'} from ${deviceLabel()}`
    // snapshot exactly what we upload, so later edits are not marked clean
    const snapshot = dirty.map((d) => ({ path: d.path, content: d.content, updatedAt: d.updatedAt }))
    const files = snapshot.map((d) => ({ path: d.path, content: d.content }))
    let pushed
    try {
      pushed = await pushFiles(cfg, files, message, head)
    } catch {
      // ref moved between pull and push (another device racing); refresh head and retry once
      head = await fetchHead(cfg)
      pushed = await pushFiles(cfg, files, message, head)
    }
    for (const d of snapshot) {
      await store.markPushed(d.path, pushed.blobShas.get(d.path) ?? '', d.updatedAt)
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
