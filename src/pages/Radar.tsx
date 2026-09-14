import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { CustomItem, RadarPaper, RadarTopic } from '../types'
import { arxivPdfUrl, searchTopic, type SearchMode } from '../lib/radar'
import { buildManualItem, findDuplicateByTitle, parseRef, resolveRef } from '../lib/lookup'
import { writePdf } from '../lib/opfs'
import { useData } from '../store/data'
import { Button, Chip, EmptyState, Icon, Spinner, cn } from '../components/ui'

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40)
}

function toCustomItem(p: RadarPaper, order: number): CustomItem {
  const idBase = p.arxivId ?? p.id.toLowerCase()
  return {
    id: `x-${idBase}`,
    order,
    phase: 'Inbox',
    shortName: p.arxivId ? `arXiv ${p.arxivId}` : (p.venue ?? 'paper'),
    title: p.title,
    year: p.date?.slice(0, 4) ?? '',
    authors: p.authors.slice(0, 4).join(', ') + (p.authors.length > 4 ? ' et al.' : ''),
    priority: null,
    difficulty: null,
    why: p.abstract ? p.abstract.slice(0, 500) + (p.abstract.length > 500 ? '…' : '') : null,
    exercise: null,
    pageUrl: p.landingUrl,
    pdfUrl: p.arxivId ? arxivPdfUrl(p.arxivId) : null,
    pdfFile: p.arxivId ? `arxiv-${p.arxivId}.pdf` : null,
    pdfDir: null,
    addedAt: new Date().toISOString(),
    source: 'radar',
  }
}

function PaperCard({
  paper,
  isNew,
  added,
  onAdd,
}: {
  paper: RadarPaper
  isNew: boolean
  added: boolean
  onAdd: (p: RadarPaper, fetchPdf: boolean) => Promise<boolean>
}) {
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <li className="rounded-lg border border-neutral-800 p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-snug font-medium text-neutral-200">
            {paper.landingUrl ? (
              <a href={paper.landingUrl} target="_blank" rel="noreferrer" className="hover:text-amber-300">
                {paper.title}
              </a>
            ) : (
              paper.title
            )}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
            <span className="font-mono">{paper.date}</span>
            {paper.venue && <span className="truncate">{paper.venue}</span>}
            {paper.arxivId && <Chip className="border-emerald-900 text-emerald-400">arXiv</Chip>}
            {isNew && <Chip className="border-amber-700 text-amber-400">new</Chip>}
            {paper.citedBy > 0 && <span>{paper.citedBy} citations</span>}
          </p>
          {paper.authors.length > 0 && (
            <p className="mt-0.5 truncate text-[11px] text-neutral-600">{paper.authors.join(', ')}</p>
          )}
          {paper.abstract && (
            <p
              className={cn('mt-1.5 text-xs leading-relaxed text-neutral-400', !expanded && 'line-clamp-3')}
              onClick={() => setExpanded(!expanded)}
            >
              {paper.abstract}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-1.5">
          {added ? (
            <Chip className="border-emerald-800 text-emerald-400">in library</Chip>
          ) : (
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await onAdd(paper, !!paper.arxivId)
                setBusy(false)
              }}
              title={paper.arxivId ? 'Adds to Inbox and fetches the PDF' : 'Adds to Inbox (no direct PDF)'}
            >
              {busy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="plus" className="h-3.5 w-3.5" />}
              Add
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

export default function Radar() {
  const topics = useData((s) => s.radarTopics)
  const saveRadarTopics = useData((s) => s.saveRadarTopics)
  const customItems = useData((s) => s.customItems)
  const addCustomItem = useData((s) => s.addCustomItem)
  const refreshPdfList = useData((s) => s.refreshPdfList)

  const [activeId, setActiveId] = useState(topics[0]?.id ?? '')
  const [papers, setPapers] = useState<RadarPaper[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newSince, setNewSince] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ label: '', query: '', days: 60 })

  // ad-hoc research (one-off search, not saved unless the user says so)
  const [adhocInput, setAdhocInput] = useState('')
  const [adhoc, setAdhoc] = useState<RadarTopic | null>(null)
  const [adhocMode, setAdhocMode] = useState<SearchMode>('recent')

  // async guards: obsolete responses (results, errors, loading) are ignored
  const loadSeq = useRef(0)
  const lookupSeq = useRef(0)

  // add a specific paper/book
  const [refInput, setRefInput] = useState('')
  const [refBusy, setRefBusy] = useState(false)
  const [refPreview, setRefPreview] = useState<RadarPaper | null>(null)
  const [refMessage, setRefMessage] = useState<string | null>(null)
  const [manual, setManual] = useState<{ title: string; url: string; year: string; authors: string } | null>(null)

  const active = adhoc ?? topics.find((t) => t.id === activeId) ?? topics[0]
  const addedIds = useMemo(() => new Set(customItems.map((i) => i.id)), [customItems])

  const load = useCallback(
    async (topic: RadarTopic, persistCheck = true, mode: SearchMode = 'recent') => {
      const seq = ++loadSeq.current
      setLoading(true)
      setError(null)
      setNewSince(persistCheck ? (topic.lastChecked ?? null) : null)
      try {
        const results = await searchTopic(topic, mode)
        if (seq !== loadSeq.current) return // an older request finished late: ignore it
        setPapers(results)
        if (persistCheck) {
          const now = new Date().toISOString()
          saveRadarTopics(
            useData.getState().radarTopics.map((t) => (t.id === topic.id ? { ...t, lastChecked: now } : t)),
          )
        }
      } catch (e: any) {
        if (seq !== loadSeq.current) return // stale error must not blame the current topic
        setError(e?.message ?? String(e))
        setPapers([])
      } finally {
        if (seq === loadSeq.current) setLoading(false)
      }
    },
    [saveRadarTopics],
  )

  useEffect(() => {
    if (!adhoc && active) void load(active)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const runAdhoc = (mode: SearchMode = adhocMode) => {
    const q = adhocInput.trim()
    if (!q) return
    const topic: RadarTopic = { id: 'adhoc', label: q, query: q, days: 365 }
    setAdhoc(topic)
    void load(topic, false, mode)
  }

  const saveAdhocAsTopic = () => {
    if (!adhoc) return
    const t: RadarTopic = { ...adhoc, id: slugify(adhoc.query) || crypto.randomUUID().slice(0, 8), days: 90 }
    if (!topics.some((x) => x.id === t.id)) saveRadarTopics([...topics, t])
    setAdhoc(null)
    setActiveId(t.id)
  }

  const lookupRef = async () => {
    const seq = ++lookupSeq.current
    const requestedInput = refInput.trim()
    setRefMessage(null)
    setRefPreview(null)
    setManual(null)
    const ref = parseRef(requestedInput)
    if (!ref) {
      // not an arXiv/DOI reference: offer manual entry (books, sites, reports)
      setManual({ title: '', url: /^https?:\/\//.test(requestedInput) ? requestedInput : '', year: '', authors: '' })
      setRefMessage('Not an arXiv/DOI reference — add it manually below (works for books too).')
      return
    }
    const prefillUrl = ref.kind === 'arxiv' ? `https://arxiv.org/abs/${ref.value}` : `https://doi.org/${ref.value}`
    setRefBusy(true)
    try {
      const paper = await resolveRef(ref)
      // obsolete responses (newer lookup started, or the input changed) are dropped
      if (seq !== lookupSeq.current || refInput.trim() !== requestedInput) return
      if (paper) setRefPreview(paper)
      else {
        setManual({ title: '', url: prefillUrl, year: '', authors: '' })
        setRefMessage('Reference not found in OpenAlex yet — you can still add it manually.')
      }
    } catch (e: any) {
      if (seq !== lookupSeq.current || refInput.trim() !== requestedInput) return
      // a FAILED lookup also deserves the manual path, not a dead end
      setManual({ title: '', url: prefillUrl, year: '', authors: '' })
      setRefMessage(`Lookup failed (${e?.message ?? e}) — you can add it manually below.`)
    } finally {
      if (seq === lookupSeq.current) setRefBusy(false)
    }
  }

  const addManual = () => {
    if (!manual) return
    const built = buildManualItem(manual, customItems.length + 1)
    if (built.error !== undefined || !built.item) {
      setRefMessage(built.error ?? 'Could not build the entry.')
      return
    }
    // duplicates are explicit: same-title items (e.g. another edition) need consent
    const dup = findDuplicateByTitle(customItems, built.item.title)
    if (dup && !confirm(`"${dup.title}" is already in your Inbox. Add this as a separate entry (e.g. another edition)?`)) {
      setRefMessage('Not added — already in your Inbox.')
      return
    }
    if (!addCustomItem(built.item)) {
      setRefMessage(`Not added — this exact reference is already in your Inbox.`)
      return
    }
    setManual(null)
    setRefInput('')
    setRefMessage('Added to your Inbox.')
  }

  const onAdd = async (p: RadarPaper, fetchPdf: boolean): Promise<boolean> => {
    const item = toCustomItem(p, customItems.length + 1)
    if (!addCustomItem(item)) return false
    if (fetchPdf && item.pdfFile && item.pdfUrl) {
      try {
        const res = await fetch(item.pdfUrl)
        const buf = await res.arrayBuffer()
        if (res.ok && new Uint8Array(buf.slice(0, 5)).every((b, i) => b === '%PDF-'.charCodeAt(i))) {
          await writePdf(item.pdfFile, buf)
          await refreshPdfList()
        }
      } catch {
        /* PDF fetch is best-effort; reader offers a retry */
      }
    }
    return true
  }

  const addTopic = () => {
    if (!draft.label.trim() || !draft.query.trim()) return
    const t: RadarTopic = {
      id: slugify(draft.label) || crypto.randomUUID().slice(0, 8),
      label: draft.label.trim(),
      query: draft.query.trim(),
      days: Math.max(7, Math.min(365, draft.days)),
    }
    saveRadarTopics([...topics, t])
    setDraft({ label: '', query: '', days: 60 })
    setActiveId(t.id)
  }

  const removeTopic = (id: string) => {
    const next = topics.filter((t) => t.id !== id)
    saveRadarTopics(next)
    if (activeId === id) setActiveId(next[0]?.id ?? '')
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">Radar</h1>
        <button
          onClick={() => setEditing(!editing)}
          className={cn('text-xs', editing ? 'text-amber-300' : 'text-neutral-500 hover:text-neutral-300')}
        >
          {editing ? 'done' : 'edit topics'}
        </button>
      </div>
      <p className="mb-4 text-xs text-neutral-500">
        Fresh papers per topic (via OpenAlex), tuned to the roadmap's gap areas. Add one to your{' '}
        <Link to="/library/inbox" className="text-amber-400 underline">
          Inbox
        </Link>{' '}
        to read, annotate and drill it like any other paper — arXiv PDFs download automatically.
      </p>

      {/* ---- research a specific topic (one-off) ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="adhoc-q">
          Research any topic
        </label>
        <input
          id="adhoc-q"
          value={adhocInput}
          onChange={(e) => setAdhocInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runAdhoc()}
          placeholder="Research any topic… (e.g. state space models long context)"
          className="min-w-56 flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
        />
        <label className="sr-only" htmlFor="adhoc-mode">
          Search mode
        </label>
        <select
          id="adhoc-mode"
          value={adhocMode}
          onChange={(e) => {
            const mode = e.target.value as SearchMode
            setAdhocMode(mode)
            if (adhoc) runAdhoc(mode)
          }}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs"
        >
          <option value="recent">recent (1y, newest)</option>
          <option value="alltime">all-time (relevance)</option>
        </select>
        <Button variant="primary" onClick={() => runAdhoc()} disabled={!adhocInput.trim()}>
          <Icon name="search" className="h-3.5 w-3.5" /> Search
        </Button>
        {adhoc && (
          <>
            <Chip className="border-amber-700 text-amber-300">ad-hoc: {adhoc.query.slice(0, 32)}</Chip>
            <Button variant="ghost" className="px-2 py-1" onClick={saveAdhocAsTopic}>
              <Icon name="plus" className="h-3 w-3" /> save as topic
            </Button>
            <Button
              variant="ghost"
              className="px-2 py-1"
              onClick={() => {
                setAdhoc(null)
                const t = topics.find((x) => x.id === activeId) ?? topics[0]
                if (t) void load(t)
              }}
              aria-label="Close ad-hoc search"
            >
              <Icon name="x" className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>

      {/* ---- add a specific paper / book ---- */}
      <div className="mb-4 rounded-lg border border-neutral-800 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="ref-input">
            Add a specific paper or book
          </label>
          <input
            id="ref-input"
            value={refInput}
            onChange={(e) => setRefInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void lookupRef()}
            placeholder="Add a specific paper/book: arXiv ID or URL, DOI, or any title/link…"
            className="min-w-56 flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
          />
          <Button onClick={() => void lookupRef()} disabled={refBusy || !refInput.trim()}>
            {refBusy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="plus" className="h-3.5 w-3.5" />} Look up
          </Button>
        </div>
        {refMessage && <p className="mt-2 text-[11px] text-neutral-400">{refMessage}</p>}
        {refPreview && (
          <div className="mt-2 flex items-start gap-2 rounded-md border border-neutral-800 bg-neutral-900/50 p-2">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-neutral-200">{refPreview.title}</p>
              <p className="mt-0.5 text-[11px] text-neutral-500">
                {refPreview.authors.slice(0, 4).join(', ')} · {refPreview.date}
                {refPreview.arxivId && <Chip className="ml-1.5 border-emerald-900 text-emerald-400">arXiv</Chip>}
              </p>
            </div>
            {addedIds.has(`x-${refPreview.arxivId ?? refPreview.id.toLowerCase()}`) ? (
              <Chip className="border-emerald-800 text-emerald-400">in library</Chip>
            ) : (
              <Button
                variant="primary"
                onClick={async () => {
                  const added = await onAdd(refPreview, !!refPreview.arxivId)
                  setRefPreview(null)
                  if (added) setRefInput('')
                  setRefMessage(added ? 'Added to your Inbox.' : 'Not added — already in your Inbox.')
                }}
              >
                Add to Inbox
              </Button>
            )}
          </div>
        )}
        {manual && (
          <div className="mt-2 grid gap-2 rounded-md border border-neutral-800 bg-neutral-900/50 p-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400" htmlFor="man-title">
              Title (required)
              <input id="man-title" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400" htmlFor="man-url">
              Link (book page, arXiv, publisher…)
              <input id="man-url" value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400" htmlFor="man-authors">
              Authors
              <input id="man-authors" value={manual.authors} onChange={(e) => setManual({ ...manual, authors: e.target.value })} className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none" />
            </label>
            <label className="flex flex-col gap-1 text-[11px] text-neutral-400" htmlFor="man-year">
              Year
              <input id="man-year" value={manual.year} onChange={(e) => setManual({ ...manual, year: e.target.value })} className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none" />
            </label>
            <div className="flex gap-2 sm:col-span-2">
              <Button variant="primary" onClick={addManual} disabled={!manual.title.trim()}>
                Add to Inbox
              </Button>
              <Button variant="ghost" onClick={() => setManual(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {topics.map((t) => (
          <span key={t.id} className="inline-flex items-center">
            <button
              onClick={() => {
                setAdhoc(null)
                setActiveId(t.id)
              }}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs whitespace-nowrap',
                t.id === active?.id
                  ? 'border-amber-700 bg-amber-500/10 text-amber-300'
                  : 'border-neutral-800 text-neutral-400 hover:border-neutral-700',
                editing && 'rounded-r-none',
              )}
            >
              {t.label}
            </button>
            {editing && (
              <button
                onClick={() => removeTopic(t.id)}
                className="rounded-r-full border border-l-0 border-neutral-800 px-1.5 py-1.5 text-neutral-600 hover:text-red-400"
                title={`Delete "${t.label}"`}
              >
                <Icon name="x" className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>

      {editing && (
        <div className="mb-4 grid gap-2 rounded-lg border border-neutral-800 p-3 sm:grid-cols-[1fr_2fr_5rem_auto]">
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Topic label"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
          />
          <input
            value={draft.query}
            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
            placeholder="Search terms (e.g. state space model long context)"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
          />
          <input
            type="number"
            min={7}
            max={365}
            value={draft.days}
            onChange={(e) => setDraft({ ...draft, days: Number(e.target.value) })}
            title="Look-back window (days)"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-center text-xs"
          />
          <Button variant="primary" onClick={addTopic}>
            <Icon name="plus" className="h-3.5 w-3.5" /> Add topic
          </Button>
        </div>
      )}

      {active && (
        <div className="mb-3 flex items-center gap-2 text-[11px] text-neutral-600">
          <span>
            “{active.query}” · last {active.days} days
          </span>
          <Button variant="ghost" className="ml-auto px-2 py-0.5" onClick={() => void load(active, !adhoc)} disabled={loading}>
            {loading ? <Spinner className="h-3 w-3" /> : <Icon name="sync" className="h-3 w-3" />} refresh
          </Button>
        </div>
      )}

      {error && <p className="mb-3 text-xs text-red-400">Could not reach OpenAlex: {error}</p>}
      {loading && papers.length === 0 ? (
        <div className="flex justify-center p-10">
          <Spinner />
        </div>
      ) : papers.length === 0 && !error ? (
        <EmptyState title="Nothing in this window">Try a longer look-back or a broader query.</EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {papers.map((p) => (
            <PaperCard
              key={p.id}
              paper={p}
              isNew={!!newSince && p.date > newSince.slice(0, 10)}
              added={addedIds.has(`x-${p.arxivId ?? p.id.toLowerCase()}`)}
              onAdd={onAdd}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
