import { useEffect, useRef, useState } from 'react'
import { Unzip, UnzipInflate } from 'fflate'
import { allItems } from '../lib/catalog'
import { getSyncConfig, setSyncConfig } from '../lib/sync'
import { testConnection } from '../lib/github'
import {
  clearPdfs,
  opfsSupported,
  requestPersistence,
  storageEstimate,
  writePdf,
} from '../lib/opfs'
import { useData } from '../store/data'
import { Button, Chip, Icon, ProgressBar, Spinner, cn } from '../components/ui'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
      <h2 className="mb-3 text-sm font-semibold text-neutral-200">{title}</h2>
      {children}
    </section>
  )
}

const inputCls =
  'w-full rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-amber-500'

// ---------------- Sync ----------------

function SyncSection() {
  const existing = getSyncConfig()
  const [owner, setOwner] = useState(existing?.owner ?? '')
  const [repo, setRepo] = useState(existing?.repo ?? '')
  const [branch, setBranch] = useState(existing?.branch ?? 'main')
  const [token, setToken] = useState(existing?.token ?? '')
  const [auto, setAuto] = useState(existing?.auto ?? true)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const syncing = useData((s) => s.syncing)
  const lastSync = useData((s) => s.lastSync)
  const syncNow = useData((s) => s.syncNow)

  const save = () => {
    if (owner && repo && token) {
      setSyncConfig({ owner, repo, branch: branch || 'main', token, auto })
      setTestResult('Saved.')
    } else {
      setSyncConfig(null)
      setTestResult('Sync disabled (fields incomplete).')
    }
  }

  const test = async () => {
    setTesting(true)
    try {
      setTestResult(`Connected: ${await testConnection({ owner, repo, branch, token, auto })}`)
    } catch (e: any) {
      setTestResult(`Failed: ${e?.message ?? e}`)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Section title="GitHub sync (notes · progress · decks)">
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={inputCls} placeholder="owner (e.g. ysant77)" value={owner} onChange={(e) => setOwner(e.target.value.trim())} />
        <input className={inputCls} placeholder="data repo (e.g. lumen-data)" value={repo} onChange={(e) => setRepo(e.target.value.trim())} />
        <input className={inputCls} placeholder="branch" value={branch} onChange={(e) => setBranch(e.target.value.trim())} />
        <input
          className={inputCls}
          placeholder="fine-grained personal access token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value.trim())}
          autoComplete="off"
        />
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-neutral-400">
        <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} className="accent-amber-500" />
        Auto-sync after edits (~45 s debounce) and on launch
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={save}>Save</Button>
        <Button onClick={() => void test()} disabled={!owner || !repo || !token || testing}>
          {testing ? <Spinner className="h-3.5 w-3.5" /> : null} Test connection
        </Button>
        <Button onClick={() => void syncNow()} disabled={syncing || !existing}>
          <Icon name="sync" className="h-3.5 w-3.5" /> Sync now
        </Button>
        {lastSync && (
          <span className={cn('text-[11px]', lastSync.error ? 'text-red-400' : 'text-neutral-500')}>
            {lastSync.error
              ? `error: ${lastSync.error}`
              : `last sync ${new Date(lastSync.at).toLocaleTimeString()} · ↓${lastSync.pulled} ↑${lastSync.pushed}${lastSync.conflictsKeptLocal ? ` · ${lastSync.conflictsKeptLocal} conflict(s), local kept` : ''}`}
          </span>
        )}
      </div>
      {testResult && <p className="mt-2 text-[11px] text-neutral-400">{testResult}</p>}
      <button className="mt-3 text-[11px] text-amber-400/80 underline" onClick={() => setShowHelp(!showHelp)}>
        How do I create the token?
      </button>
      {showHelp && (
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-[11px] text-neutral-400">
          <li>Create a <b>private</b> repo for your data (e.g. <code>lumen-data</code>).</li>
          <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate.</li>
          <li>Repository access: <b>Only select repositories</b> → your data repo.</li>
          <li>Permissions → Repository permissions → <b>Contents: Read and write</b>. Everything else: none.</li>
          <li>Paste it here. The token lives only in this browser's localStorage — it is never synced or sent anywhere except api.github.com.</li>
        </ol>
      )}
    </Section>
  )
}

// ---------------- PDF library ----------------

interface ImportStats {
  total: number
  done: number
  matched: number
  skipped: number
  current: string
  running: boolean
  error?: string
}

function PdfSection() {
  const refreshPdfList = useData((s) => s.refreshPdfList)
  const available = useData((s) => s.pdfsAvailable)
  const [stats, setStats] = useState<ImportStats | null>(null)
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const zipRef = useRef<HTMLInputElement>(null)
  const dirRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)

  const wanted = new Set(allItems().map((i) => i.pdfFile).filter(Boolean) as string[])
  const importedCount = [...wanted].filter((w) => available.has(w)).length

  useEffect(() => {
    void storageEstimate().then(setUsage)
  }, [stats])

  const finish = async () => {
    await refreshPdfList()
    setUsage(await storageEstimate())
  }

  const importFiles = async (files: File[]) => {
    const pdfs = files.filter((f) => f.name.toLowerCase().endsWith('.pdf'))
    setStats({ total: pdfs.length, done: 0, matched: 0, skipped: 0, current: '', running: true })
    let matched = 0
    let skipped = 0
    for (let i = 0; i < pdfs.length; i++) {
      const f = pdfs[i]
      const base = f.name.split('/').pop()!
      setStats((s) => s && { ...s, done: i, current: base })
      if (wanted.has(base)) {
        await writePdf(base, await f.arrayBuffer())
        matched++
      } else skipped++
      setStats((s) => s && { ...s, matched, skipped })
    }
    setStats((s) => s && { ...s, done: pdfs.length, running: false, current: '' })
    await finish()
  }

  const importZip = async (file: File) => {
    setStats({ total: 0, done: 0, matched: 0, skipped: 0, current: file.name, running: true })
    let matched = 0
    let skipped = 0
    let pendingWrites = 0
    const writes: Promise<void>[] = []
    try {
      const unzipper = new Unzip()
      unzipper.register(UnzipInflate)
      unzipper.onfile = (zf) => {
        const base = zf.name.split('/').pop() ?? ''
        if (!base.toLowerCase().endsWith('.pdf') || zf.name.includes('__MACOSX')) return
        if (!wanted.has(base)) {
          skipped++
          return
        }
        const chunks: Uint8Array[] = []
        zf.ondata = (err, data, final) => {
          if (err) throw err
          chunks.push(data)
          if (final) {
            const total = chunks.reduce((a, c) => a + c.length, 0)
            const buf = new Uint8Array(total)
            let off = 0
            for (const c of chunks) {
              buf.set(c, off)
              off += c.length
            }
            chunks.length = 0
            matched++
            pendingWrites++
            setStats((s) => s && { ...s, matched, skipped, current: base })
            writes.push(
              writePdf(base, buf.buffer as ArrayBuffer).finally(() => {
                pendingWrites--
              }),
            )
          }
        }
        zf.start()
      }
      const reader = file.stream().getReader()
      for (;;) {
        // keep memory bounded: wait while several large writes are in flight
        while (pendingWrites > 2) await new Promise((r) => setTimeout(r, 40))
        const { done, value } = await reader.read()
        if (done) {
          unzipper.push(new Uint8Array(0), true)
          break
        }
        unzipper.push(value, false)
      }
      await Promise.all(writes)
      setStats({ total: matched + skipped, done: matched + skipped, matched, skipped, current: '', running: false })
    } catch (e: any) {
      setStats((s) => s && { ...s, running: false, error: e?.message ?? String(e) })
    }
    await finish()
  }

  if (!opfsSupported()) {
    return (
      <Section title="PDF library">
        <p className="text-xs text-red-400">
          This browser does not support the Origin-Private File System — PDFs cannot be stored.
          Use a recent Safari, Chrome or Edge.
        </p>
      </Section>
    )
  }

  return (
    <Section title="PDF library (stored on this device only)">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip className={importedCount === wanted.size ? 'border-emerald-700 text-emerald-400' : 'border-amber-800 text-amber-400'}>
          {importedCount}/{wanted.size} PDFs imported
        </Chip>
        {usage && (
          <Chip>
            {(usage.usage / 1e6).toFixed(0)} MB used
            {usage.quota ? ` · ${(usage.quota / 1e9).toFixed(1)} GB quota` : ''}
          </Chip>
        )}
        {persisted != null && <Chip>{persisted ? 'storage persisted' : 'persistence denied'}</Chip>}
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-neutral-500">
        Import the <code>AI_papers</code> folder produced by your roadmap library. Filenames are
        matched against the catalog (e.g. <code>01_Transformer_2017.pdf</code>). On iPad, zip the
        folder and use “Import zip”.
      </p>

      <div className="flex flex-wrap gap-2">
        <input ref={zipRef} type="file" accept=".zip" hidden onChange={(e) => e.target.files?.[0] && void importZip(e.target.files[0])} />
        <input
          ref={dirRef}
          type="file"
          hidden
          {...({ webkitdirectory: '' } as object)}
          onChange={(e) => e.target.files && void importFiles([...e.target.files])}
        />
        <input ref={filesRef} type="file" accept=".pdf" multiple hidden onChange={(e) => e.target.files && void importFiles([...e.target.files])} />
        <Button variant="primary" onClick={() => zipRef.current?.click()}>
          <Icon name="upload" className="h-3.5 w-3.5" /> Import zip
        </Button>
        <Button onClick={() => dirRef.current?.click()}>
          <Icon name="upload" className="h-3.5 w-3.5" /> Import folder
        </Button>
        <Button onClick={() => filesRef.current?.click()}>
          <Icon name="upload" className="h-3.5 w-3.5" /> Import files
        </Button>
        <Button onClick={() => void requestPersistence().then(setPersisted)}>Persist storage</Button>
        <Button
          variant="danger"
          onClick={() => {
            if (confirm('Remove all imported PDFs from this device?')) {
              void clearPdfs().then(finish)
            }
          }}
        >
          <Icon name="trash" className="h-3.5 w-3.5" /> Clear PDFs
        </Button>
      </div>

      {stats && (
        <div className="mt-3">
          {stats.running ? (
            <>
              <div className="flex items-center gap-2 text-[11px] text-neutral-400">
                <Spinner className="h-3 w-3" />
                importing… {stats.matched} matched
                {stats.current && <span className="truncate text-neutral-600">· {stats.current}</span>}
              </div>
              {stats.total > 0 && <ProgressBar value={stats.done} max={stats.total} className="mt-1.5" />}
            </>
          ) : stats.error ? (
            <p className="text-[11px] text-red-400">Import failed: {stats.error}</p>
          ) : (
            <p className="text-[11px] text-emerald-400">
              Imported {stats.matched} matching PDFs
              {stats.skipped > 0 && <span className="text-neutral-500"> · {stats.skipped} skipped (not in catalog)</span>}
            </p>
          )}
        </div>
      )}
    </Section>
  )
}

// ---------------- Data ----------------

function DataSection() {
  const exportAll = useData((s) => s.exportAll)
  const importAll = useData((s) => s.importAll)
  const clearLocal = useData((s) => s.clearLocal)
  const importRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const download = () => {
    const blob = exportAll()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lumen-backup-${new Date().toISOString().slice(0, 10)}.zip`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Section title="Your data">
      <p className="mb-3 text-[11px] text-neutral-500">
        Notes, progress, code snippets, decks and focus sessions — as plain Markdown/JSON.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          ref={importRef}
          type="file"
          accept=".zip"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            if (!f) return
            const n = await importAll(await f.arrayBuffer())
            setMsg(`Restored ${n} files.`)
          }}
        />
        <Button onClick={download}>
          <Icon name="download" className="h-3.5 w-3.5" /> Export backup (.zip)
        </Button>
        <Button onClick={() => importRef.current?.click()}>
          <Icon name="upload" className="h-3.5 w-3.5" /> Restore backup
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (confirm('Delete ALL local notes, progress and decks on this device? (Synced copies in your data repo are unaffected.)'))
              void clearLocal().then(() => setMsg('Local data cleared.'))
          }}
        >
          <Icon name="trash" className="h-3.5 w-3.5" /> Clear local data
        </Button>
      </div>
      {msg && <p className="mt-2 text-[11px] text-neutral-400">{msg}</p>}
    </Section>
  )
}

export default function Settings() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-6">
      <h1 className="text-lg font-semibold text-neutral-100">Settings</h1>
      <SyncSection />
      <PdfSection />
      <DataSection />
      <Section title="About">
        <p className="text-[11px] leading-relaxed text-neutral-500">
          lumen · a focused reading room for AI papers. Local-first: PDFs live in this device's
          browser storage, your notes sync to your own private GitHub repo. Python runs in-browser
          via Pyodide; scheduling by ts-fsrs; rendering by pdf.js, CodeMirror and KaTeX.
        </p>
      </Section>
    </div>
  )
}
