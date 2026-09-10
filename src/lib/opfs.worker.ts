/// <reference lib="webworker" />
/**
 * All OPFS writes happen in this worker via createSyncAccessHandle(),
 * which is the most widely supported write path (Safari included).
 */

type Req =
  | { id: number; op: 'write'; path: string; buffer: ArrayBuffer }
  | { id: number; op: 'delete'; path: string }
  | { id: number; op: 'clear'; dir: string }

async function dirHandle(path: string[], create: boolean) {
  let dir = await navigator.storage.getDirectory()
  for (const part of path) {
    dir = await dir.getDirectoryHandle(part, { create })
  }
  return dir
}

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data
  try {
    if (msg.op === 'write') {
      const parts = msg.path.split('/')
      const name = parts.pop()!
      const dir = await dirHandle(parts, true)
      const fh = await dir.getFileHandle(name, { create: true })
      const access = await (fh as any).createSyncAccessHandle()
      try {
        access.truncate(0)
        access.write(new Uint8Array(msg.buffer), { at: 0 })
        access.flush()
      } finally {
        access.close()
      }
    } else if (msg.op === 'delete') {
      const parts = msg.path.split('/')
      const name = parts.pop()!
      const dir = await dirHandle(parts, false)
      await dir.removeEntry(name)
    } else if (msg.op === 'clear') {
      const root = await navigator.storage.getDirectory()
      await root.removeEntry(msg.dir, { recursive: true })
    }
    self.postMessage({ id: msg.id, ok: true })
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err) })
  }
}
