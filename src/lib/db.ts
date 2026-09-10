import { openDB, type IDBPDatabase } from 'idb'
import type { Doc } from '../types'

const DB_NAME = 'lumen'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase> | null = null

function db() {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains('docs')) {
        d.createObjectStore('docs', { keyPath: 'path' })
      }
      if (!d.objectStoreNames.contains('kv')) {
        d.createObjectStore('kv')
      }
    },
  })
  return dbPromise
}

export async function getAllDocs(): Promise<Doc[]> {
  return (await db()).getAll('docs')
}

export async function getDoc(path: string): Promise<Doc | undefined> {
  return (await db()).get('docs', path)
}

export async function putDoc(doc: Doc): Promise<void> {
  await (await db()).put('docs', doc)
}

export async function deleteDoc(path: string): Promise<void> {
  await (await db()).delete('docs', path)
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db()).get('kv', key)
}

export async function kvSet<T>(key: string, value: T): Promise<void> {
  await (await db()).put('kv', value, key)
}

export async function clearAllDocs(): Promise<void> {
  await (await db()).clear('docs')
}
