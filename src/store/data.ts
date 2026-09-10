import { create } from 'zustand'
import { zipSync, strToU8 } from 'fflate'
import type {
  Bookmark,
  Checkpoints,
  CodeSnippet,
  CustomItem,
  Doc,
  ExperimentRecord,
  Flashcard,
  FocusSession,
  ItemStatus,
  ProgressEntry,
  RadarTopic,
  ReadDepth,
  SyncReport,
  WeekQueue,
} from '../types'
import { clearAllDocs, deleteDoc, getAllDocs, getDoc, putDoc } from '../lib/db'
import { listPdfs } from '../lib/opfs'
import { DEFAULT_TOPICS } from '../lib/radar'
import { getSyncConfig, runSync, type SyncStore } from '../lib/sync'
import { validateBackup, type BackupSummary } from '../lib/backup'
import { mergeDocs } from '../lib/merge'
import { remapDocPath, remapKeys, remapList } from '../lib/migrate'
import roadmap from '../data/roadmap.json'

const AUTO_SYNC_DELAY = 45_000
const ID_ALIASES: Record<string, string> = (roadmap as any).idAliases ?? {}

interface DataState {
  ready: boolean
  progress: Record<string, ProgressEntry>
  notes: Record<string, string>
  code: Record<string, CodeSnippet[]>
  decks: Record<string, Flashcard[]>
  sessions: FocusSession[]
  customItems: CustomItem[]
  customDeleted: Record<string, string>
  radarTopics: RadarTopic[]
  weekQueue: WeekQueue
  experiments: Record<string, ExperimentRecord[]>
  pdfsAvailable: Set<string>
  /** paths saved locally but not yet confirmed in the data repo */
  dirtyPaths: string[]
  syncing: boolean
  lastSync: SyncReport | null

  init(): Promise<void>
  refreshPdfList(): Promise<void>
  setStatus(itemId: string, status: ItemStatus): void
  setReadingPosition(itemId: string, page: number, total: number): void
  setDepth(itemId: string, depth: ReadDepth | undefined): void
  toggleCheckpoint(itemId: string, key: keyof Checkpoints): void
  toggleBookmark(itemId: string, page: number): void
  saveNote(itemId: string, content: string): void
  saveSnippets(itemId: string, snippets: CodeSnippet[]): void
  saveDeck(itemId: string, cards: Flashcard[]): void
  saveExperiments(itemId: string, records: ExperimentRecord[]): void
  addSession(s: FocusSession): void
  addCustomItem(item: CustomItem): void
  removeCustomItem(itemId: string): void
  saveRadarTopics(topics: RadarTopic[]): void
  setWeekQueue(items: string[]): void
  syncNow(): Promise<SyncReport | null>
  exportAll(): Blob
  /** validated restore; caller chooses merge or replace explicitly */
  restoreBackup(summary: BackupSummary, mode: 'merge' | 'replace'): Promise<number>
  listConflicts(): Promise<Doc[]>
  resolveConflict(path: string, keep: boolean): Promise<void>
  clearLocal(): Promise<void>
}

let autoSyncTimer: ReturnType<typeof setTimeout> | null = null
let onlineListenerInstalled = false

/** Parse a synced doc into partial zustand state (used on load and remote pull). */
function parseDoc(path: string, content: string, state: Partial<DataState>) {
  try {
    if (/\.conflict-\d+\./.test(path)) return // conflict copies are surfaced separately
    if (path === 'progress.json') {
      state.progress = JSON.parse(content).items ?? {}
    } else if (path === 'sessions.json') {
      state.sessions = JSON.parse(content).sessions ?? []
    } else if (path === 'queue.json') {
      const q = JSON.parse(content)
      state.weekQueue = { items: q.items ?? [], updatedAt: q.updatedAt ?? '' }
    } else if (path.startsWith('notes/') && path.endsWith('.md')) {
      const id = path.slice('notes/'.length, -'.md'.length)
      state.notes = { ...(state.notes ?? {}), [id]: content }
    } else if (path.startsWith('code/') && path.endsWith('.json')) {
      const id = path.slice('code/'.length, -'.json'.length)
      state.code = { ...(state.code ?? {}), [id]: JSON.parse(content).snippets ?? [] }
    } else if (path.startsWith('decks/') && path.endsWith('.json')) {
      const id = path.slice('decks/'.length, -'.json'.length)
      state.decks = { ...(state.decks ?? {}), [id]: JSON.parse(content).cards ?? [] }
    } else if (path.startsWith('experiments/') && path.endsWith('.json')) {
      const id = path.slice('experiments/'.length, -'.json'.length)
      state.experiments = { ...(state.experiments ?? {}), [id]: JSON.parse(content).records ?? [] }
    } else if (path === 'custom.json') {
      const parsed = JSON.parse(content)
      state.customItems = parsed.items ?? []
      state.customDeleted = parsed.deleted ?? {}
    } else if (path === 'radar.json') {
      state.radarTopics = JSON.parse(content).topics ?? []
    }
  } catch (e) {
    console.warn(`lumen: could not parse ${path}`, e)
  }
}

export const useData = create<DataState>((set, get) => {
  /** Persist a doc locally: content saved + marked pending-sync. remoteSha preserved. */
  async function writeDoc(path: string, content: string) {
    const prev = await getDoc(path)
    await putDoc({
      path,
      content,
      updatedAt: Date.now(),
      dirty: true,
      remoteSha: prev?.remoteSha ?? null,
    })
    set((s) => (s.dirtyPaths.includes(path) ? s : { dirtyPaths: [...s.dirtyPaths, path] }))
    scheduleAutoSync()
  }

  function scheduleAutoSync() {
    const cfg = getSyncConfig()
    if (!cfg?.auto) return
    if (autoSyncTimer) clearTimeout(autoSyncTimer)
    autoSyncTimer = setTimeout(() => {
      autoSyncTimer = null
      if (navigator.onLine) void get().syncNow()
    }, AUTO_SYNC_DELAY)
  }

  function persistProgress(progress: Record<string, ProgressEntry>) {
    set({ progress })
    void writeDoc('progress.json', JSON.stringify({ version: 1, items: progress }, null, 1))
  }

  function persistCustom(items: CustomItem[], deleted: Record<string, string>) {
    set({ customItems: items, customDeleted: deleted })
    void writeDoc('custom.json', JSON.stringify({ version: 1, items, deleted }, null, 1))
  }

  return {
    ready: false,
    progress: {},
    notes: {},
    code: {},
    decks: {},
    sessions: [],
    customItems: [],
    customDeleted: {},
    radarTopics: DEFAULT_TOPICS,
    weekQueue: { items: [], updatedAt: '' },
    experiments: {},
    pdfsAvailable: new Set(),
    dirtyPaths: [],
    syncing: false,
    lastSync: null,

    async init() {
      // one-time local migration when ids were aliased (never renumbered silently)
      if (Object.keys(ID_ALIASES).length > 0) {
        for (const doc of await getAllDocs()) {
          const newPath = remapDocPath(doc.path, ID_ALIASES)
          if (newPath && !(await getDoc(newPath))) {
            await putDoc({ ...doc, path: newPath, dirty: true, remoteSha: null })
            await deleteDoc(doc.path)
          }
        }
        const progressDoc = await getDoc('progress.json')
        if (progressDoc) {
          try {
            const parsed = JSON.parse(progressDoc.content)
            const { out, changed } = remapKeys<ProgressEntry>(parsed.items ?? {}, ID_ALIASES)
            if (changed) await writeDoc('progress.json', JSON.stringify({ version: 1, items: out }, null, 1))
          } catch {
            /* leave as-is */
          }
        }
        const queueDoc = await getDoc('queue.json')
        if (queueDoc) {
          try {
            const parsed = JSON.parse(queueDoc.content)
            const { out, changed } = remapList(parsed.items ?? [], ID_ALIASES)
            if (changed)
              await writeDoc('queue.json', JSON.stringify({ items: out, updatedAt: new Date().toISOString() }, null, 1))
          } catch {
            /* leave as-is */
          }
        }
      }

      const docs = await getAllDocs()
      const parsed: Partial<DataState> = { notes: {}, code: {}, decks: {}, experiments: {} }
      for (const d of docs) parseDoc(d.path, d.content, parsed)
      set({
        ready: true,
        progress: parsed.progress ?? {},
        notes: parsed.notes ?? {},
        code: parsed.code ?? {},
        decks: parsed.decks ?? {},
        sessions: parsed.sessions ?? [],
        customItems: parsed.customItems ?? [],
        customDeleted: parsed.customDeleted ?? {},
        radarTopics: parsed.radarTopics?.length ? parsed.radarTopics : DEFAULT_TOPICS,
        weekQueue: parsed.weekQueue ?? { items: [], updatedAt: '' },
        experiments: parsed.experiments ?? {},
        dirtyPaths: docs.filter((d) => d.dirty).map((d) => d.path),
      })
      await get().refreshPdfList()

      if (!onlineListenerInstalled && typeof window !== 'undefined') {
        onlineListenerInstalled = true
        window.addEventListener('online', () => {
          if (get().dirtyPaths.length > 0 && getSyncConfig()) void get().syncNow()
        })
      }
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
      persistProgress({ ...get().progress, [itemId]: entry })
    },

    setReadingPosition(itemId, page, total) {
      const prev = get().progress[itemId]
      if (prev?.lastPage === page && prev?.totalPages === total) return
      const entry: ProgressEntry = {
        ...prev,
        status: prev?.status ?? 'reading',
        lastPage: page,
        totalPages: total,
        updatedAt: new Date().toISOString(),
      }
      persistProgress({ ...get().progress, [itemId]: entry })
    },

    setDepth(itemId, depth) {
      const prev = get().progress[itemId]
      const entry: ProgressEntry = {
        ...prev,
        status: prev?.status ?? 'not-started',
        depth,
        updatedAt: new Date().toISOString(),
      }
      persistProgress({ ...get().progress, [itemId]: entry })
    },

    toggleCheckpoint(itemId, key) {
      const prev = get().progress[itemId]
      const checks: Checkpoints = { ...prev?.checks }
      if (checks[key]) delete checks[key]
      else checks[key] = new Date().toISOString()
      const entry: ProgressEntry = {
        ...prev,
        status: prev?.status ?? 'not-started',
        checks,
        updatedAt: new Date().toISOString(),
      }
      persistProgress({ ...get().progress, [itemId]: entry })
    },

    toggleBookmark(itemId, page) {
      const prev = get().progress[itemId]
      const existing = prev?.bookmarks ?? []
      const bookmarks: Bookmark[] = existing.some((b) => b.page === page)
        ? existing.filter((b) => b.page !== page)
        : [...existing, { page, createdAt: new Date().toISOString() }].sort((a, b) => a.page - b.page)
      const entry: ProgressEntry = {
        ...prev,
        status: prev?.status ?? 'reading',
        bookmarks,
        updatedAt: new Date().toISOString(),
      }
      persistProgress({ ...get().progress, [itemId]: entry })
    },

    saveNote(itemId, content) {
      set({ notes: { ...get().notes, [itemId]: content } })
      void writeDoc(`notes/${itemId}.md`, content)
    },

    saveSnippets(itemId, snippets) {
      set({ code: { ...get().code, [itemId]: snippets } })
      void writeDoc(`code/${itemId}.json`, JSON.stringify({ version: 1, snippets }, null, 1))
    },

    saveDeck(itemId, cards) {
      set({ decks: { ...get().decks, [itemId]: cards } })
      void writeDoc(`decks/${itemId}.json`, JSON.stringify({ version: 1, cards }, null, 1))
    },

    saveExperiments(itemId, records) {
      set({ experiments: { ...get().experiments, [itemId]: records } })
      void writeDoc(`experiments/${itemId}.json`, JSON.stringify({ version: 1, records }, null, 1))
    },

    addSession(s) {
      const sessions = [...get().sessions, s].slice(-2000)
      set({ sessions })
      void writeDoc('sessions.json', JSON.stringify({ version: 1, sessions }, null, 1))
    },

    addCustomItem(item) {
      if (get().customItems.some((i) => i.id === item.id)) return
      const stamped = { ...item, updatedAt: item.updatedAt ?? new Date().toISOString() }
      const deleted = { ...get().customDeleted }
      delete deleted[item.id]
      persistCustom([...get().customItems, stamped], deleted)
    },

    removeCustomItem(itemId) {
      persistCustom(
        get().customItems.filter((i) => i.id !== itemId),
        { ...get().customDeleted, [itemId]: new Date().toISOString() },
      )
    },

    saveRadarTopics(topics) {
      const now = new Date().toISOString()
      const prev = new Map(get().radarTopics.map((t) => [t.id, t]))
      const stamped = topics.map((t) => {
        const old = prev.get(t.id)
        const changed =
          !old || old.label !== t.label || old.query !== t.query || old.days !== t.days ||
          old.lastChecked !== t.lastChecked
        return changed ? { ...t, updatedAt: now } : t
      })
      set({ radarTopics: stamped })
      void writeDoc('radar.json', JSON.stringify({ version: 1, topics: stamped }, null, 1))
    },

    setWeekQueue(items) {
      const weekQueue: WeekQueue = { items: [...new Set(items)], updatedAt: new Date().toISOString() }
      set({ weekQueue })
      void writeDoc('queue.json', JSON.stringify(weekQueue, null, 1))
    },

    async syncNow() {
      const cfg = getSyncConfig()
      if (!cfg || get().syncing) return null
      set({ syncing: true })
      const applyParsed = (path: string, content: string) => {
        const patch: Partial<DataState> = {
          notes: { ...get().notes },
          code: { ...get().code },
          decks: { ...get().decks },
          experiments: { ...get().experiments },
        }
        parseDoc(path, content, patch)
        set(patch as DataState)
      }
      try {
        const adapter: SyncStore = {
          list: () => getAllDocs(),
          async applyRemote(path, content, remoteSha) {
            await putDoc({ path, content, updatedAt: Date.now(), dirty: false, remoteSha })
            set((s) => ({ dirtyPaths: s.dirtyPaths.filter((p) => p !== path) }))
            applyParsed(path, content)
          },
          async applyMerged(path, content, remoteSha) {
            await putDoc({ path, content, updatedAt: Date.now(), dirty: true, remoteSha })
            set((s) => (s.dirtyPaths.includes(path) ? s : { dirtyPaths: [...s.dirtyPaths, path] }))
            applyParsed(path, content)
          },
          async saveConflictCopy(path, content) {
            await putDoc({ path, content, updatedAt: Date.now(), dirty: true, remoteSha: null })
            set((s) => (s.dirtyPaths.includes(path) ? s : { dirtyPaths: [...s.dirtyPaths, path] }))
          },
          async markPushed(path, remoteSha, pushedUpdatedAt) {
            const doc = await getDoc(path)
            if (!doc) return
            if (doc.updatedAt === pushedUpdatedAt) {
              await putDoc({ ...doc, dirty: false, remoteSha })
              set((s) => ({ dirtyPaths: s.dirtyPaths.filter((p) => p !== path) }))
            } else {
              // edited while the push was in flight: keep pending, remember new base
              await putDoc({ ...doc, remoteSha })
            }
          },
        }
        const report = await runSync(cfg, adapter)
        set({ lastSync: report, syncing: false })
        return report
      } catch (e: any) {
        const report: SyncReport = {
          pulled: 0,
          pushed: 0,
          merged: 0,
          conflictsSaved: 0,
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
      files['custom.json'] = strToU8(
        JSON.stringify({ version: 1, items: s.customItems, deleted: s.customDeleted }, null, 1),
      )
      files['radar.json'] = strToU8(JSON.stringify({ version: 1, topics: s.radarTopics }, null, 1))
      files['queue.json'] = strToU8(JSON.stringify(s.weekQueue, null, 1))
      for (const [id, md] of Object.entries(s.notes)) files[`notes/${id}.md`] = strToU8(md)
      for (const [id, sn] of Object.entries(s.code))
        files[`code/${id}.json`] = strToU8(JSON.stringify({ version: 1, snippets: sn }, null, 1))
      for (const [id, cards] of Object.entries(s.decks))
        files[`decks/${id}.json`] = strToU8(JSON.stringify({ version: 1, cards }, null, 1))
      for (const [id, records] of Object.entries(s.experiments))
        files[`experiments/${id}.json`] = strToU8(JSON.stringify({ version: 1, records }, null, 1))
      const zipped = zipSync(files, { level: 6 })
      return new Blob([zipped.slice().buffer as ArrayBuffer], { type: 'application/zip' })
    },

    async restoreBackup(summary, mode) {
      if (!summary.ok) throw new Error('backup failed validation; nothing was written')
      if (mode === 'replace') {
        await clearAllDocs()
        for (const f of summary.files) {
          await putDoc({ path: f.path, content: f.content, updatedAt: Date.now(), dirty: true, remoteSha: null })
        }
      } else {
        for (const f of summary.files) {
          const current = await getDoc(f.path)
          if (!current) {
            await putDoc({ path: f.path, content: f.content, updatedAt: Date.now(), dirty: true, remoteSha: null })
            continue
          }
          if (current.content === f.content) continue
          const result = mergeDocs(f.path, current.content, f.content)
          if (result.kind === 'takeRemote') {
            await putDoc({ ...current, content: f.content, updatedAt: Date.now(), dirty: true })
          } else if (result.kind === 'merged') {
            await putDoc({ ...current, content: result.content, updatedAt: Date.now(), dirty: true })
          } else {
            // keep current live; preserve the backup's version as a conflict copy
            await putDoc({
              path: result.conflictPath,
              content: result.conflictContent,
              updatedAt: Date.now(),
              dirty: true,
              remoteSha: null,
            })
          }
        }
      }
      await get().init()
      return summary.files.length
    },

    async listConflicts() {
      return (await getAllDocs()).filter((d) => /\.conflict-\d+\./.test(d.path))
    },

    async resolveConflict(path, keep) {
      if (keep) {
        // promote the conflict copy over the live doc
        const doc = await getDoc(path)
        const livePath = path.replace(/\.conflict-\d+/, '')
        if (doc) await writeDoc(livePath, doc.content)
      }
      await deleteDoc(path)
      set((s) => ({ dirtyPaths: s.dirtyPaths.filter((p) => p !== path) }))
      await get().init()
    },

    async clearLocal() {
      await clearAllDocs()
      set({
        progress: {},
        notes: {},
        code: {},
        decks: {},
        sessions: [],
        customItems: [],
        customDeleted: {},
        radarTopics: DEFAULT_TOPICS,
        weekQueue: { items: [], updatedAt: '' },
        experiments: {},
        dirtyPaths: [],
        lastSync: null,
      })
    },
  }
})

export { validateBackup }
