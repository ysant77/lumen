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

function makeStore(initial: Doc[]) {
  const docs = new Map(initial.map((d) => [d.path, { ...d }]))
  const applied: Array<{ path: string; content: string }> = []
  const pushed: string[] = []
  const store: SyncStore = {
    list: async () => [...docs.values()],
    applyRemote: async (path, content, remoteSha) => {
      docs.set(path, { path, content, updatedAt: Date.now(), dirty: false, remoteSha })
      applied.push({ path, content })
    },
    markPushed: async (path, remoteSha) => {
      const d = docs.get(path)
      if (d) docs.set(path, { ...d, dirty: false, remoteSha })
      pushed.push(path)
    },
  }
  return { store, docs, applied, pushed }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tracked paths', () => {
  it('accepts user docs and rejects everything else', () => {
    const t = __test__.TRACKED
    expect(t.test('progress.json')).toBe(true)
    expect(t.test('notes/llm-01.md')).toBe(true)
    expect(t.test('decks/cv-12.json')).toBe(true)
    expect(t.test('code/reg-03.json')).toBe(true)
    expect(t.test('sessions.json')).toBe(true)
    expect(t.test('README.md')).toBe(false)
    expect(t.test('.github/workflows/x.yml')).toBe(false)
    expect(t.test('notes/../evil')).toBe(false)
  })
})

describe('runSync', () => {
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
    expect(report.pushed).toBe(0)
    expect(applied[0]).toEqual({ path: 'notes/llm-01.md', content: '# from remote' })
  })

  it('keeps dirty local docs on conflict and pushes them', async () => {
    vi.mocked(fetchHead).mockResolvedValue({
      commitSha: 'c1',
      treeSha: 't1',
      files: [{ path: 'notes/llm-01.md', sha: 'remote-sha' }],
    })
    vi.mocked(pushFiles).mockResolvedValue({
      commitSha: 'c2',
      blobShas: new Map([['notes/llm-01.md', 'new-sha']]),
    })
    const { store, docs, applied } = makeStore([
      {
        path: 'notes/llm-01.md',
        content: '# local edits',
        updatedAt: Date.now(),
        dirty: true,
        remoteSha: 'old-sha',
      },
    ])

    const report = await runSync(cfg, store)
    expect(report.conflictsKeptLocal).toBe(1)
    expect(report.pushed).toBe(1)
    expect(applied).toHaveLength(0)
    expect(fetchBlobText).not.toHaveBeenCalled()
    expect(docs.get('notes/llm-01.md')).toMatchObject({ dirty: false, remoteSha: 'new-sha' })
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
    vi.mocked(pushFiles).mockResolvedValue({
      commitSha: 'c1',
      blobShas: new Map([['progress.json', 's1']]),
    })
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
