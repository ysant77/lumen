import type { SyncConfig } from '../types'

const API = 'https://api.github.com'

export class GitHubError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function gh<T>(cfg: SyncConfig, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      if (j?.message) msg = `${res.status}: ${j.message}`
    } catch {
      /* keep default message */
    }
    throw new GitHubError(res.status, msg)
  }
  return res.json() as Promise<T>
}

export interface RemoteFile {
  path: string
  sha: string
}

export interface RemoteHead {
  commitSha: string
  treeSha: string
  files: RemoteFile[]
}

/** Fetch branch head + full recursive tree. Returns null for an empty repo/branch. */
export async function fetchHead(cfg: SyncConfig): Promise<RemoteHead | null> {
  let refSha: string
  try {
    const ref = await gh<{ object: { sha: string } }>(
      cfg,
      'GET',
      `/repos/${cfg.owner}/${cfg.repo}/git/ref/${encodeURIComponent(`heads/${cfg.branch}`)}`,
    )
    refSha = ref.object.sha
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) return null
    throw e
  }
  const commit = await gh<{ tree: { sha: string } }>(
    cfg,
    'GET',
    `/repos/${cfg.owner}/${cfg.repo}/git/commits/${refSha}`,
  )
  const tree = await gh<{ tree: Array<{ path: string; type: string; sha: string }> }>(
    cfg,
    'GET',
    `/repos/${cfg.owner}/${cfg.repo}/git/trees/${commit.tree.sha}?recursive=1`,
  )
  return {
    commitSha: refSha,
    treeSha: commit.tree.sha,
    files: tree.tree.filter((t) => t.type === 'blob').map((t) => ({ path: t.path, sha: t.sha })),
  }
}

export async function fetchBlobText(cfg: SyncConfig, sha: string): Promise<string> {
  const blob = await gh<{ content: string; encoding: string }>(
    cfg,
    'GET',
    `/repos/${cfg.owner}/${cfg.repo}/git/blobs/${sha}`,
  )
  if (blob.encoding !== 'base64') throw new Error(`unexpected blob encoding: ${blob.encoding}`)
  const bin = atob(blob.content.replace(/\n/g, ''))
  const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Create one commit containing all given files. Returns new commit sha + blob shas per path. */
export async function pushFiles(
  cfg: SyncConfig,
  files: Array<{ path: string; content: string }>,
  message: string,
  parent: RemoteHead | null,
): Promise<{ commitSha: string; blobShas: Map<string, string> }> {
  const blobShas = new Map<string, string>()
  const treeEntries = []
  for (const f of files) {
    const blob = await gh<{ sha: string }>(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/git/blobs`, {
      content: f.content,
      encoding: 'utf-8',
    })
    blobShas.set(f.path, blob.sha)
    treeEntries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha })
  }
  const tree = await gh<{ sha: string }>(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/git/trees`, {
    ...(parent ? { base_tree: parent.treeSha } : {}),
    tree: treeEntries,
  })
  const commit = await gh<{ sha: string }>(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/git/commits`, {
    message,
    tree: tree.sha,
    parents: parent ? [parent.commitSha] : [],
  })
  if (parent) {
    await gh(cfg, 'PATCH', `/repos/${cfg.owner}/${cfg.repo}/git/refs/${encodeURIComponent(`heads/${cfg.branch}`)}`, {
      sha: commit.sha,
      force: false,
    })
  } else {
    await gh(cfg, 'POST', `/repos/${cfg.owner}/${cfg.repo}/git/refs`, {
      ref: `refs/heads/${cfg.branch}`,
      sha: commit.sha,
    })
  }
  return { commitSha: commit.sha, blobShas }
}

/** Cheap connectivity/permissions check. */
export async function testConnection(cfg: SyncConfig): Promise<string> {
  const repo = await gh<{ full_name: string; private: boolean; permissions?: { push?: boolean } }>(
    cfg,
    'GET',
    `/repos/${cfg.owner}/${cfg.repo}`,
  )
  const canPush = repo.permissions?.push !== false
  return `${repo.full_name} (${repo.private ? 'private' : 'PUBLIC'})${canPush ? '' : ' — token has NO push permission'}`
}
