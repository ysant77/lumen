import { create } from 'zustand'
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate'
import type {
  CodeSnippet,
  Flashcard,
  FocusSession,
  ItemStatus,
  ProgressEntry,
  SyncReport,
} from '../types'
import { clearAllDocs, getAllDocs, getDoc, putDoc } from '../lib/db'
import { listPdfs } from '../lib/opfs'
import { getSyncConfig, runSync, type SyncStore } from '../lib/sync'

const AUTO_SYNC_DELAY = 45_000

interface DataState {
  ready: boolean
  progress: Record<string, ProgressEntry>
  notes: Record<string, string>
  code: Record<string, CodeSnippet[]>
  decks: Record<string, Flashcard[]>
  sessions: FocusSession[]
  pdfsAvailable: Set<string>
  syncing: boolean
  lastSync: SyncReport | null

  init(): Promise<void>
  refreshPdfList(): Promise<void>
  setStatus(itemId: string, status: ItemStatus): void
  setReadingPosition(itemId: string, page: number, total: number): void
  saveNote(itemId: string, content: string): void
  saveSnippets(itemId: string, snippets: CodeSnippet[]): void
  saveDeck(itemId: string, cards: Flashcard[]): void
  addSession(s: FocusSession): void
  syncNow(): Promise<SyncReport | null>
  exportAll(): Blob
  importAll(data: ArrayBuffer): Promise<number>
  clearLocal(): Promise<void>
}

let autoSyncTimer: ReturnType<typeof setTimeout> | null = null

function scheduleAutoSync(sync: () => void) {
  const cfg = getSyncConfig()
  if (!cfg?.auto) return
  if (autoSyncTimer) clearTimeout(autoSyncTimer)
  autoSyncTimer = setTimeout(() => {
    autoSyncTimer = null
    if (navigator.onLine) sync()
  }, AUTO_SYNC_DELAY)
}

/** Persist a user doc locally, preserving remoteSha so sync can detect conflicts. */
async function writeDoc(path: string, content: string) {
  const prev = await getDoc(path)
  await putDoc({
    path,
    content,
    updatedAt: Date.now(),
    dirty: true,
    remoteSha: prev?.remoteSha ?? null,
  })
}

function notePath(itemId: string) {
  return `notes/${itemId}.md`
}

/** Parse a synced doc into the zustand state (used on load and on remote pull). */
function parseDoc(path: string, content: string, state: Partial<DataState>) {
  try {
    if (path === 'progress.json') {
      state.progress = JSON.parse(content).items ?? {}
    } else if (path === 'sessions.json') {
      state.sessions = JSON.parse(content).sessions ?? []
    } else if (path.startsWith('notes/') && path.endsWith('.md')) {
      const id = path.slice('notes/'.length, -'.md'.length)
      state.notes = { ...(state.notes ?? {}), [id]: content }
    } else if (path.startsWith('code/') && path.endsWith('.json')) {
      const id = path.slice('code/'.length, -'.json'.length)
      state.code = { ...(state.code ?? {}), [id]: JSON.parse(content).snippets ?? [] }
    } else if (path.startsWith('decks/') && path.endsWith('.json')) {
      const id = path.slice('decks/'.length, -'.json'.length)
      state.decks = { ...(state.decks ?? {}), [id]: JSON.parse(content).cards ?? [] }
    }
  } catch (e) {
    console.warn(`lumen: could not parse ${path}`, e)
  }
}

export const useData = create<DataState>((set, get) => ({
  ready: false,
  progress: {},
  notes: {},
  code: {},
  decks: {},
  sessions: [],
  pdfsAvailable: new Set(),
  syncing: false,
  lastSync: null,

  async init() {
    const docs = await getAllDocs()
    const parsed: Partial<DataState> = { notes: {}, code: {}, decks: {} }
    for (const d of docs) parseDoc(d.path, d.content, parsed)
    set({
      ready: true,
      progress: parsed.progress ?? {},
      notes: parsed.notes ?? {},
      code: parsed.code ?? {},
      decks: parsed.decks ?? {},
      sessions: parsed.sessions ?? [],
    })
    await get().refreshPdfList()
    if (getSyncConfig()?.auto && navigator.onLine) void get().syncNow()
  },

  async refreshPdfList() {
    set({ pdfsAvailable: await listPdfs() })
  },

  setStatus(itemId, status) {
    const now = new Date().toISOString()
    const prev = get().progress[itemId]
    const entry: ProgressEntry = {
      ...prev,
      status,
      updatedAt: now,
      startedAt: prev?.startedAt ?? (status !== 'not-started' ? now : undefined),
      finishedAt: status === 'done' ? now : prev?.finishedAt,
    }
    const progress = { ...get().progress, [itemId]: entry }
    set({ progress })
    void writeDoc('progress.json', JSON.stringify({ version: 1, items: progress }, null, 1))
    scheduleAutoSync(() => void get().syncNow())
  },

  setReadingPosition(itemId, page, total) {
    const prev = get().progress[itemId]
    if (prev?.lastPage === page) return
    const entry: ProgressEntry = {
      ...prev,
      status: prev?.status ?? 'reading',
      lastPage: page,
      totalPages: total,
      updatedAt: new Date().toISOString(),
    }
    const progress = { ...get().progress, [itemId]: entry }
    set({ progress })
    void writeDoc('progress.json', JSON.stringify({ version: 1, items: progress }, null, 1))
    scheduleAutoSync(() => void get().syncNow())
  },

  saveNote(itemId, content) {
    set({ notes: { ...get().notes, [itemId]: content } })
    void writeDoc(notePath(itemId), content)
    scheduleAutoSync(() => void get().syncNow())
  },

  saveSnippets(itemId, snippets) {
    set({ code: { ...get().code, [itemId]: snippets } })
    void writeDoc(`code/${itemId}.json`, JSON.stringify({ version: 1, snippets }, null, 1))
    scheduleAutoSync(() => void get().syncNow())
  },

  saveDeck(itemId, cards) {
    set({ decks: { ...get().decks, [itemId]: cards } })
    void writeDoc(`decks/${itemId}.json`, JSON.stringify({ version: 1, cards }, null, 1))
    scheduleAutoSync(() => void get().syncNow())
  },

  addSession(s) {
    const sessions = [...get().sessions, s].slice(-2000)
    set({ sessions })
    void writeDoc('sessions.json', JSON.stringify({ version: 1, sessions }, null, 1))
    scheduleAutoSync(() => void get().syncNow())
  },

  async syncNow() {
    const cfg = getSyncConfig()
    if (!cfg || get().syncing) return null
    set({ syncing: true })
    try {
      const adapter: SyncStore = {
        list: () => getAllDocs(),
        async applyRemote(path, content, remoteSha) {
          await putDoc({ path, content, updatedAt: Date.now(), dirty: false, remoteSha })
          const patch: Partial<DataState> = {
            notes: { ...get().notes },
            code: { ...get().code },
            decks: { ...get().decks },
          }
          parseDoc(path, content, patch)
          set(patch as DataState)
        },
        async markPushed(path, remoteSha) {
          const doc = (await getAllDocs()).find((d) => d.path === path)
          if (doc) await putDoc({ ...doc, dirty: false, remoteSha })
        },
      }
      const report = await runSync(cfg, adapter)
      set({ lastSync: report, syncing: false })
      return report
    } catch (e: any) {
      const report: SyncReport = {
        pulled: 0,
        pushed: 0,
        conflictsKeptLocal: 0,
        at: new Date().toISOString(),
        error: e?.message ?? String(e),
      }
      set({ lastSync: report, syncing: false })
      return report
    }
  },

  exportAll() {
    const files: Record<string, Uint8Array> = {}
    const s = get()
    files['progress.json'] = strToU8(JSON.stringify({ version: 1, items: s.progress }, null, 1))
    files['sessions.json'] = strToU8(JSON.stringify({ version: 1, sessions: s.sessions }, null, 1))
    for (const [id, md] of Object.entries(s.notes)) files[`notes/${id}.md`] = strToU8(md)
    for (const [id, sn] of Object.entries(s.code))
      files[`code/${id}.json`] = strToU8(JSON.stringify({ version: 1, snippets: sn }, null, 1))
    for (const [id, cards] of Object.entries(s.decks))
      files[`decks/${id}.json`] = strToU8(JSON.stringify({ version: 1, cards }, null, 1))
    const zipped = zipSync(files, { level: 6 })
    return new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' })
  },

  async importAll(data) {
    const files = unzipSync(new Uint8Array(data))
    let count = 0
    for (const [path, bytes] of Object.entries(files)) {
      if (!/^(progress\.json|sessions\.json|notes\/.+\.md|code\/.+\.json|decks\/.+\.json)$/.test(path))
        continue
      const content = strFromU8(bytes)
      await writeDoc(path, content)
      count++
    }
    await get().init()
    return count
  },

  async clearLocal() {
    await clearAllDocs()
    set({ progress: {}, notes: {}, code: {}, decks: {}, sessions: [], lastSync: null })
  },
}))
