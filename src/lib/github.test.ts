import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SyncConfig } from '../types'
import { GitHubError, fetchHead } from './github'

const cfg: SyncConfig = { owner: 'o', repo: 'r', branch: 'main', token: 'tok', auto: false }

afterEach(() => vi.unstubAllGlobals())

describe('REGRESSION: GitHub API reads must bypass the browser HTTP cache', () => {
  it("every request opts out with cache: 'no-store' (a cached branch head caused 422 non-fast-forward loops)", async () => {
    const inits: RequestInit[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        inits.push(init)
        if (url.includes('/git/ref/')) return { ok: true, json: async () => ({ object: { sha: 'C0' } }) }
        if (url.includes('/git/commits/')) return { ok: true, json: async () => ({ tree: { sha: 'T0' } }) }
        if (url.includes('/git/trees/')) return { ok: true, json: async () => ({ tree: [] }) }
        return { ok: false, status: 500, statusText: 'unexpected', json: async () => ({}) }
      }),
    )
    const head = await fetchHead(cfg)
    expect(head).toEqual({ commitSha: 'C0', treeSha: 'T0', files: [] })
    expect(inits.length).toBeGreaterThanOrEqual(3)
    for (const init of inits) expect(init.cache).toBe('no-store')
  })

  it('failures carry the status and GitHub message (what the user sees in Settings)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 422,
        statusText: 'Unprocessable Entity',
        json: async () => ({ message: 'Update is not a fast forward' }),
      })),
    )
    try {
      await fetchHead(cfg)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(GitHubError)
      expect((e as GitHubError).status).toBe(422)
      expect((e as GitHubError).message).toBe('422: Update is not a fast forward')
    }
  })
})
