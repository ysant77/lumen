import type { Catalog, CatalogItem, Collection } from '../types'
import raw from '../data/catalog.json'

export const catalog = raw as unknown as Catalog

const itemIndex = new Map<string, { item: CatalogItem; collection: Collection }>()
for (const c of catalog.collections) {
  for (const item of c.items) itemIndex.set(item.id, { item, collection: c })
}

export function getItem(id: string) {
  return itemIndex.get(id)
}

export function allItems(): CatalogItem[] {
  return catalog.collections.flatMap((c) => c.items)
}

export function collectionOf(itemId: string): Collection | undefined {
  return itemIndex.get(itemId)?.collection
}

/** Difficulty like "3 - Technical" -> 3 */
export function difficultyLevel(item: CatalogItem): number | null {
  const m = /^(\d)/.exec(item.difficulty ?? '')
  return m ? Number(m[1]) : null
}
