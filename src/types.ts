// ---------- Catalog (static, generated from the roadmap workbooks) ----------

export interface CatalogItem {
  id: string
  order: number
  phase: string
  shortName: string
  title: string
  year: number | string
  authors?: string | null
  category?: string | null
  domain?: string | null
  resourceType?: string | null
  difficulty?: string | null
  priority?: string | null
  readDepth?: string | null
  effort?: string | null
  focus?: string | null
  relevance?: Record<string, number | null>
  why?: string | null
  exercise?: string | null
  pageUrl?: string | null
  pdfUrl?: string | null
  /** basename of the locally-imported PDF (null when no free PDF exists) */
  pdfFile: string | null
  pdfDir?: string | null
}

export interface Collection {
  id: string
  icon: string
  title: string
  subtitle: string
  phases: string[]
  items: CatalogItem[]
}

export interface Catalog {
  version: number
  generatedAt: string
  collections: Collection[]
}

// ---------- Radar (latest-paper discovery) & custom items ----------

export interface RadarTopic {
  id: string
  label: string
  query: string
  /** look-back window in days */
  days: number
  lastChecked?: string
}

export interface RadarPaper {
  id: string
  title: string
  abstract: string | null
  date: string
  venue: string | null
  authors: string[]
  landingUrl: string | null
  doi: string | null
  arxivId: string | null
  citedBy: number
}

/** A paper added by the user (e.g. from Radar) — lives in the synced Inbox. */
export interface CustomItem extends CatalogItem {
  addedAt: string
  source: 'radar' | 'manual'
}

// ---------- User data (synced to the private data repo) ----------

export type ItemStatus = 'not-started' | 'reading' | 'implementing' | 'done' | 'skipped'

export interface ProgressEntry {
  status: ItemStatus
  startedAt?: string
  finishedAt?: string
  lastPage?: number
  totalPages?: number
  updatedAt: string
}

export interface CodeSnippet {
  id: string
  title: string
  language: 'python'
  source: string
  updatedAt: string
}

/** FSRS scheduling state, serialized (dates as ISO strings). */
export interface SrsState {
  due: string
  stability: number
  difficulty: number
  elapsed_days: number
  scheduled_days: number
  reps: number
  lapses: number
  state: number
  last_review?: string
}

export interface Flashcard {
  id: string
  front: string
  back: string
  createdAt: string
  updatedAt: string
  srs: SrsState
}

export interface FocusSession {
  id: string
  itemId?: string
  kind: 'focus' | 'break'
  minutes: number
  startedAt: string
  endedAt: string
}

// ---------- Local doc store (unit of GitHub sync) ----------

export interface Doc {
  path: string
  content: string
  updatedAt: number
  dirty: boolean
  remoteSha: string | null
}

export interface SyncConfig {
  owner: string
  repo: string
  branch: string
  token: string
  auto: boolean
}

export interface SyncReport {
  pulled: number
  pushed: number
  conflictsKeptLocal: number
  at: string
  error?: string
}
