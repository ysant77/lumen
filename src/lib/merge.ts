/**
 * Record-level merging for synced docs.
 *
 * Structured docs (progress, sessions, decks, custom, radar, queue, experiments)
 * merge per record so independent edits from different devices both survive.
 * Opaque docs (notes/*.md, code/*.json) cannot be merged safely: the local
 * version stays live and the remote version is preserved as a conflict copy —
 * nothing is silently overwritten.
 */

export type MergeResult =
  | { kind: 'merged'; content: string }
  | { kind: 'takeRemote' }
  | { kind: 'conflict'; conflictPath: string; conflictContent: string }

const ts = (s: string | undefined | null) => (s ? Date.parse(s) || 0 : 0)

function later<T extends Record<string, any>>(a: T, b: T, key: string): T {
  return ts(b?.[key]) > ts(a?.[key]) ? b : a
}

/** union of two record arrays keyed by `id`, newest `updatedAt` (fallback key) wins per id */
function unionById<T extends { id: string }>(
  a: T[],
  b: T[],
  timeKey = 'updatedAt',
  fallbackKey?: string,
): T[] {
  const out = new Map<string, T>()
  for (const rec of [...a, ...b]) {
    const prev = out.get(rec.id)
    if (!prev) {
      out.set(rec.id, rec)
      continue
    }
    const pick =
      ts((rec as any)[timeKey] ?? (fallbackKey ? (rec as any)[fallbackKey] : undefined)) >=
      ts((prev as any)[timeKey] ?? (fallbackKey ? (prev as any)[fallbackKey] : undefined))
        ? rec
        : prev
    out.set(rec.id, pick)
  }
  return [...out.values()]
}

function stringify(obj: unknown): string {
  return JSON.stringify(obj, null, 1)
}

function conflictName(path: string, now: Date): string {
  const stamp = now
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14)
  const dot = path.lastIndexOf('.')
  return `${path.slice(0, dot)}.conflict-${stamp}${path.slice(dot)}`
}

export function mergeDocs(path: string, local: string, remote: string, now = new Date()): MergeResult {
  if (local === remote) return { kind: 'takeRemote' }

  // Opaque content: preserve both sides.
  const opaque = /^notes\/.+\.md$/.test(path) || /^code\/.+\.json$/.test(path)
  if (!opaque) {
    try {
      const merged = mergeStructured(path, JSON.parse(local), JSON.parse(remote))
      if (merged !== null) {
        const content = stringify(merged)
        if (content === remote) return { kind: 'takeRemote' }
        return { kind: 'merged', content }
      }
    } catch {
      /* unparseable structured doc -> fall through to conflict copy */
    }
  }
  return { kind: 'conflict', conflictPath: conflictName(path, now), conflictContent: remote }
}

function mergeStructured(path: string, local: any, remote: any): unknown | null {
  if (path === 'progress.json') {
    const items: Record<string, any> = { ...(remote.items ?? {}) }
    for (const [id, entry] of Object.entries<any>(local.items ?? {})) {
      items[id] = items[id] ? later(items[id], entry, 'updatedAt') : entry
    }
    return { version: 1, items }
  }
  if (path === 'sessions.json') {
    const sessions = unionById<any>(remote.sessions ?? [], local.sessions ?? [], 'endedAt')
      .sort((a, b) => ts(a.endedAt) - ts(b.endedAt))
      .slice(-2000)
    return { version: 1, sessions }
  }
  if (/^decks\/.+\.json$/.test(path)) {
    return { version: 1, cards: unionById<any>(remote.cards ?? [], local.cards ?? []) }
  }
  if (/^experiments\/.+\.json$/.test(path)) {
    return { version: 1, records: unionById<any>(remote.records ?? [], local.records ?? []) }
  }
  if (path === 'custom.json') {
    const deleted: Record<string, string> = { ...(remote.deleted ?? {}) }
    for (const [id, when] of Object.entries<string>(local.deleted ?? {})) {
      if (!deleted[id] || ts(when) > ts(deleted[id])) deleted[id] = when
    }
    const items = unionById<any>(remote.items ?? [], local.items ?? [], 'updatedAt', 'addedAt').filter(
      (it) => !deleted[it.id] || ts(deleted[it.id]) < ts(it.updatedAt ?? it.addedAt),
    )
    return { version: 1, items, deleted }
  }
  if (path === 'radar.json') {
    const topics = unionById<any>(remote.topics ?? [], local.topics ?? []).map((t) => {
      const other = [...(remote.topics ?? []), ...(local.topics ?? [])].find(
        (o) => o.id === t.id && o !== t,
      )
      const lastChecked =
        ts(t.lastChecked) >= ts(other?.lastChecked) ? t.lastChecked : other?.lastChecked
      return lastChecked ? { ...t, lastChecked } : t
    })
    return { version: 1, topics }
  }
  if (path === 'queue.json') {
    // small ordered list: whole-doc last-writer-wins by updatedAt
    return ts(local.updatedAt) >= ts(remote.updatedAt) ? local : remote
  }
  return null // unknown structured doc -> conflict copy
}

export const __test__ = { unionById, conflictName }
