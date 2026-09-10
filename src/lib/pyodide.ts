export interface RunOutput {
  kind: 'stdout' | 'stderr' | 'status'
  text: string
}

export interface RunResult {
  repr: string | null
  images: string[]
  error?: string
}

/** Client for the Pyodide worker. One shared runner for the whole app. */
class PyRunner {
  private worker: Worker | null = null
  private reqId = 0
  private busy = false

  get isBusy() {
    return this.busy
  }

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), { type: 'module' })
    }
    return this.worker
  }

  run(code: string, onOutput: (o: RunOutput) => void): Promise<RunResult> {
    if (this.busy) return Promise.reject(new Error('Python runner is busy'))
    this.busy = true
    const id = ++this.reqId
    const w = this.ensure()
    return new Promise<RunResult>((resolve) => {
      const handler = (e: MessageEvent<any>) => {
        const m = e.data
        if (m.type === 'status') {
          onOutput({ kind: 'status', text: m.text })
          return
        }
        if (m.id !== id) return
        if (m.type === 'stdout') onOutput({ kind: 'stdout', text: m.text })
        else if (m.type === 'stderr') onOutput({ kind: 'stderr', text: m.text })
        else if (m.type === 'done') {
          cleanup()
          resolve({ repr: m.repr, images: m.images ?? [] })
        } else if (m.type === 'error') {
          cleanup()
          resolve({ repr: null, images: [], error: m.text })
        }
      }
      const cleanup = () => {
        w.removeEventListener('message', handler)
        this.busy = false
      }
      w.addEventListener('message', handler)
      w.postMessage({ id, op: 'run', code })
    })
  }

  /** Hard-restart the interpreter (fresh globals, frees memory, stops runaway code). */
  restart() {
    this.worker?.terminate()
    this.worker = null
    this.busy = false
  }
}

export const pyRunner = new PyRunner()
