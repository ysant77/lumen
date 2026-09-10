import type { Catalog, CatalogItem, Collection, CustomItem } from '../types'
import raw from '../data/catalog.json'

export const catalog = raw as unknown as Catalog

const itemIndex = new Map<string, { item: CatalogItem; collection: Collection }>()
for (const c of catalog.collections) {
  for (const item of c.items) itemIndex.set(item.id, { item, collection: c })
}

export function getItem(id: string) {
  return itemIndex.get(id)
}

/** Virtual collection for user-added papers (Radar → Inbox). */
export function inboxCollection(customItems: CustomItem[]): Collection {
  return {
    id: 'inbox',
    icon: 'inbox',
    title: 'Inbox',
    subtitle: 'Papers you added from Radar — triage into your reading flow',
    phases: ['Inbox'],
    items: customItems,
  }
}

/** Resolve an item id against the static catalog first, then the user's inbox. */
export function resolveItem(id: string, customItems: CustomItem[]) {
  const hit = itemIndex.get(id)
  if (hit) return hit
  const custom = customItems.find((i) => i.id === id)
  return custom ? { item: custom, collection: inboxCollection(customItems) } : undefined
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
