/**
 * Origin-Private File System helpers. PDFs live flat under `pdfs/<basename>`;
 * writes go through opfs.worker.ts (sync access handles) for broad support.
 */

let worker: Worker | null = null
let reqId = 0
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>()

function ensureWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./opfs.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; ok: boolean; error?: string }>) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve()
      else p.reject(new Error(e.data.error ?? 'OPFS worker error'))
    }
  }
  return worker
}

function rpc(msg: Record<string, unknown>, transfer: Transferable[] = []): Promise<void> {
  const id = ++reqId
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ensureWorker().postMessage({ id, ...msg }, transfer)
  })
}

export function opfsSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
}

export async function writePdf(basename: string, buffer: ArrayBuffer): Promise<void> {
  await rpc({ op: 'write', path: `pdfs/${basename}`, buffer }, [buffer])
}

export async function deletePdf(basename: string): Promise<void> {
  await rpc({ op: 'delete', path: `pdfs/${basename}` })
}

export async function clearPdfs(): Promise<void> {
  await rpc({ op: 'clear', dir: 'pdfs' })
}

export async function readPdf(basename: string): Promise<ArrayBuffer | null> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('pdfs')
    const fh = await dir.getFileHandle(basename)
    const file = await fh.getFile()
    return await file.arrayBuffer()
  } catch {
    return null
  }
}

export async function listPdfs(): Promise<Set<string>> {
  const names = new Set<string>()
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle('pdfs')
    for await (const [name, handle] of (dir as any).entries()) {
      if (handle.kind === 'file') names.add(name)
    }
  } catch {
    /* no pdfs dir yet */
  }
  return names
}

export async function storageEstimate(): Promise<{ usage: number; quota: number }> {
  const est = await navigator.storage?.estimate?.()
  return { usage: est?.usage ?? 0, quota: est?.quota ?? 0 }
}

/** Ask the browser to persist this origin's storage (best effort). */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
