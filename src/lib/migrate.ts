/**
 * Backward-compatible ID migration.
 *
 * Resource identity is stable: the catalog generator never renumbers an
 * existing id (see scripts/build_catalog.py id registry). If an id ever has
 * to change, it ships as an alias (old -> new) in src/data/roadmap.json and
 * existing user data is remapped once, locally, at startup.
 */

export function remapKeys<T>(
  record: Record<string, T>,
  aliases: Record<string, string>,
): { out: Record<string, T>; changed: boolean } {
  let changed = false
  const out: Record<string, T> = {}
  for (const [key, value] of Object.entries(record)) {
    const next = aliases[key] ?? key
    if (next !== key) changed = true
    // never clobber data that already exists under the new id
    if (!(next in out) || next === key) out[next] = value
    else changed = true
  }
  return { out, changed }
}

export function remapList(list: string[], aliases: Record<string, string>): { out: string[]; changed: boolean } {
  let changed = false
  const out = list.map((id) => {
    const next = aliases[id] ?? id
    if (next !== id) changed = true
    return next
  })
  return { out: [...new Set(out)], changed }
}

/** notes/llm-01.md -> notes/<new>.md when llm-01 is aliased; null when unchanged */
export function remapDocPath(path: string, aliases: Record<string, string>): string | null {
  const m = /^(notes|decks|code|experiments)\/(.+?)(\.conflict-\d+)?\.(md|json)$/.exec(path)
  if (!m) return null
  const next = aliases[m[2]]
  return next ? `${m[1]}/${next}${m[3] ?? ''}.${m[4]}` : null
}
