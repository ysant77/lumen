/// <reference lib="webworker" />
/**
 * Runs Python via Pyodide, fully in the browser. Loaded lazily from the CDN
 * on first run (~15 MB, cached by the service worker afterwards).
 */

const PYODIDE_VERSION = '0.26.4'
const PYODIDE_BASE = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

let pyodide: any = null
let loading: Promise<any> | null = null

const COLLECT_FIGURES = `
import sys as _sys
_figs = []
if 'matplotlib' in _sys.modules:
    import base64 as _b64, io as _io
    import matplotlib.pyplot as _plt
    for _n in _plt.get_fignums():
        _buf = _io.BytesIO()
        _plt.figure(_n).savefig(_buf, format='png', dpi=110, bbox_inches='tight')
        _figs.append(_b64.b64encode(_buf.getvalue()).decode())
    _plt.close('all')
_figs
`

function post(msg: Record<string, unknown>) {
  self.postMessage(msg)
}

async function ensurePyodide() {
  if (pyodide) return pyodide
  loading ??= (async () => {
    post({ type: 'status', text: 'Downloading Python runtime…' })
    const mod = await import(/* @vite-ignore */ `${PYODIDE_BASE}pyodide.mjs`)
    const py = await mod.loadPyodide({ indexURL: PYODIDE_BASE })
    post({ type: 'status', text: 'Loading numpy…' })
    await py.loadPackage('numpy')
    pyodide = py
    return py
  })()
  return loading
}

self.onmessage = async (e: MessageEvent<{ id: number; op: 'run' | 'warmup'; code?: string }>) => {
  const { id, op, code } = e.data
  try {
    const py = await ensurePyodide()
    if (op === 'warmup') {
      post({ id, type: 'done', repr: null, images: [] })
      return
    }
    const src = code ?? ''
    if (/\b(matplotlib|plt)\b/.test(src) && !py.loadedPackages['matplotlib']) {
      post({ type: 'status', text: 'Loading matplotlib…' })
      await py.loadPackage('matplotlib')
    }
    py.setStdout({ batched: (text: string) => post({ id, type: 'stdout', text }) })
    py.setStderr({ batched: (text: string) => post({ id, type: 'stderr', text }) })

    await py.loadPackagesFromImports(src)
    const result = await py.runPythonAsync(src)
    let repr: string | null = null
    if (result !== undefined) {
      repr = typeof result?.toString === 'function' ? result.toString() : String(result)
      if (typeof result?.destroy === 'function') result.destroy()
    }
    const figsProxy = await py.runPythonAsync(COLLECT_FIGURES)
    const images: string[] = figsProxy ? figsProxy.toJs() : []
    if (typeof figsProxy?.destroy === 'function') figsProxy.destroy()

    post({ id, type: 'done', repr, images })
  } catch (err: any) {
    post({ id, type: 'error', text: err?.message ?? String(err) })
  }
}
