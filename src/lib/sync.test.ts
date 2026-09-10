import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Doc, SyncConfig } from '../types'

vi.mock('./github', () => ({
  fetchHead: vi.fn(),
  fetchBlobText: vi.fn(),
  pushFiles: vi.fn(),
}))

import { fetchBlobText, fetchHead, pushFiles } from './github'
import { runSync, __test__, type SyncStore } from './sync'

const cfg: SyncConfig = { owner: 'o', repo: 'r', branch: 'main', token: 't', auto: true }
const j = (o: unknown) => JSON.stringify(o, null, 1)

function makeStore(initial: Doc[]) {
  const docs = new Map(initial.map((d) => [d.path, { ...d }]))
  const applied: string[] = []
  const mergedPaths: string[] = []
  const conflictCopies: Array<{ path: string; content: string }> = []
  const markCalls: Array<{ path: string; sha: string; updatedAt: number }> = []
  const store: SyncStore = {
    list: async () => [...docs.values()].map((d) => ({ ...d })),
    applyRemote: async (path, content, remoteSha) => {
      docs.set(path, { path, content, updatedAt: Date.now(), dirty: false, remoteSha })
      applied.push(path)
    },
    applyMerged: async (path, content, remoteSha) => {
      docs.set(path, { path, content, updatedAt: Date.now(), dirty: true, remoteSha })
      mergedPaths.push(path)
    },
    saveConflictCopy: async (path, content) => {
      docs.set(path, { path, content, updatedAt: Date.now(), dirty: true, remoteSha: null })
      conflictCopies.push({ path, content })
    },
    markPushed: async (path, sha, updatedAt) => {
      markCalls.push({ path, sha, updatedAt })
      const d = docs.get(path)
      if (d && d.updatedAt === updatedAt) docs.set(path, { ...d, dirty: false, remoteSha: sha })
    },
  }
  return { store, docs, applied, mergedPaths, conflictCopies, markCalls }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tracked paths', () => {
  it('accepts user docs and rejects everything else', () => {
    const t = __test__.TRACKED
    for (const p of [
      'progress.json',
      'sessions.json',
      'custom.json',
      'radar.json',
      'queue.json',
      'notes/llm-01.md',
      'notes/llm-01.conflict-20260910120000.md',
      'decks/cv-12.json',
      'code/reg-03.json',
      'experiments/llm-28.json',
    ])
      expect(t.test(p), p).toBe(true)
    for (const p of ['README.md', '.github/workflows/x.yml', 'notes/../evil', 'progress.json.bak'])
      expect(t.test(p), p).toBe(false)
  })
})

describe('runSync — multi-device behaviour', () => {
  it('pulls remote changes when local copy is clean', async () => {
    vi.mocked(fetchHead).mockResolvedValue({
      commitSha: 'c1',
      treeSha: 't1',
      files: [{ path: 'notes/llm-01.md', sha: 'abc' }],
    })
    vi.mocked(fetchBlobText).mockResolvedValue('# from remote')
    const { store, applied } = makeStore([])
    const report = await runSync(cfg, store)
    expect(report.pulled).toBe(1)
    expect(applied).toEqual(['notes/llm-01.md'])
  })

  it('merges progress records from two devices instead of local-wins', async () => {
    const localDoc = j({
      version: 1,
      items: { 'llm-01': { status: 'done', updatedAt: '2026-09-10T10:00:00Z' } },
    })
    const remoteDoc = j({
      version: 1,
      items: { 'cv-07': { status: 'reading', updatedAt: '2026-09-10T09:00:00Z' } },
    })
    vi.mocked(fetchHead).mockResolvedValue({
      commitSha: 'c1',
      treeSha: 't1',
      files: [{ path: 'progress.json', sha: 'remote-sha' }],
    })
    vi.mocked(fetchBlobText).mockResolvedValue(remoteDoc)
    vi.mocked(pushFiles).mockResolvedValue({ commitSha: 'c2', blobShas: new Map([['progress.json', 'new-sha']]) })

    const { store, mergedPaths, docs } = makeStore([
      { path: 'progress.json', content: localDoc, updatedAt: 1, dirty: true, remoteSha: 'old-sha' },
    ])
    const report = await runSync(cfg, store)
    expect(mergedPaths).toEqual(['progress.json'])
    expect(report.merged).toBe(1)
    expect(report.pushed).toBe(1)
    const final = JSON.parse(docs.get('progress.json')!.content).items
    expect(Object.keys(final).sort()).toEqual(['cv-07', 'llm-01'])
    // pushed content is the merged doc
    const pushedFiles = vi.mocked(pushFiles).mock.calls[0][1]
    expect(JSON.parse(pushedFiles[0].content).items['cv-07']).toBeTruthy()
  })

  it('saves a conflict copy for diverged notes and pushes both docs', async () => {
    vi.mocked(fetchHead).mockResolvedValue({
      commitSha: 'c1',
      treeSha: 't1',
      files: [{ path: 'notes/llm-01.md', sha: 'r1' }],
    })
    vi.mocked(fetchBlobText).mockResolvedValue('# remote version')
    vi.mocked(pushFiles).mockResolvedValue({ commitSha: 'c2', blobShas: new Map() })

    const { store, conflictCopies } = makeStore([
      { path: 'notes/llm-01.md', content: '# local version', updatedAt: 1, dirty: true, remoteSha: null },
    ])
    const report = await runSync(cfg, store)
    expect(report.conflictsSaved).toBe(1)
    expect(conflictCopies[0].path).toMatch(/^notes\/llm-01\.conflict-\d{14}\.md$/)
    expect(conflictCopies[0].content).toBe('# remote version')
    // both the live local note AND the conflict copy are pushed
    const pushedPaths = vi.mocked(pushFiles).mock.calls[0][1].map((f: any) => f.path).sort()
    expect(pushedPaths).toEqual(['notes/llm-01.md', conflictCopies[0].path].sort())
  })

  it('passes the uploaded revision to markPushed so newer edits stay pending', async () => {
    vi.mocked(fetchHead).mockResolvedValue({ commitSha: 'c1', treeSha: 't1', files: [] })
    const { store, docs, markCalls } = makeStore([
      { path: 'notes/llm-01.md', content: 'v1', updatedAt: 111, dirty: true, remoteSha: null },
    ])
    vi.mocked(pushFiles).mockImplementation(async () => {
      // an edit lands while the push is in flight
      docs.set('notes/llm-01.md', {
        path: 'notes/llm-01.md',
        content: 'v2 (typed during push)',
        updatedAt: 222,
        dirty: true,
        remoteSha: null,
      })
      return { commitSha: 'c2', blobShas: new Map([['notes/llm-01.md', 's1']]) }
    })
    await runSync(cfg, store)
    expect(markCalls[0]).toMatchObject({ path: 'notes/llm-01.md', updatedAt: 111 })
    // the doc was edited during push -> must still be dirty with the new content
    const doc = docs.get('notes/llm-01.md')!
    expect(doc.dirty).toBe(true)
    expect(doc.content).toBe('v2 (typed during push)')
  })

  it('skips files whose remote sha matches the stored one', async () => {
    vi.mocked(fetchHead).mockResolvedValue({
      commitSha: 'c1',
      treeSha: 't1',
      files: [{ path: 'progress.json', sha: 'same' }],
    })
    const { store } = makeStore([
      { path: 'progress.json', content: '{}', updatedAt: 1, dirty: false, remoteSha: 'same' },
    ])
    const report = await runSync(cfg, store)
    expect(report.pulled).toBe(0)
    expect(fetchBlobText).not.toHaveBeenCalled()
  })

  it('handles an empty remote repo by pushing everything dirty', async () => {
    vi.mocked(fetchHead).mockResolvedValue(null)
    vi.mocked(pushFiles).mockResolvedValue({ commitSha: 'c1', blobShas: new Map([['progress.json', 's1']]) })
    const { store } = makeStore([
      { path: 'progress.json', content: '{}', updatedAt: 1, dirty: true, remoteSha: null },
    ])
    const report = await runSync(cfg, store)
    expect(report.pushed).toBe(1)
    expect(vi.mocked(pushFiles).mock.calls[0][3]).toBeNull()
  })

  it('retries the push once after a ref race', async () => {
    vi.mocked(fetchHead)
      .mockResolvedValueOnce({ commitSha: 'c1', treeSha: 't1', files: [] })
      .mockResolvedValueOnce({ commitSha: 'c2', treeSha: 't2', files: [] })
    vi.mocked(pushFiles)
      .mockRejectedValueOnce(new Error('Update is not a fast forward'))
      .mockResolvedValueOnce({ commitSha: 'c3', blobShas: new Map([['sessions.json', 's']]) })
    const { store } = makeStore([
      { path: 'sessions.json', content: '{}', updatedAt: 1, dirty: true, remoteSha: null },
    ])
    const report = await runSync(cfg, store)
    expect(report.pushed).toBe(1)
    expect(pushFiles).toHaveBeenCalledTimes(2)
  })
})
