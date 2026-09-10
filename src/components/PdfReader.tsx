import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { readPdf, writePdf } from '../lib/opfs'
import { pageFromScroll, scrollTopForPage } from '../lib/readerMath'
import { useData } from '../store/data'
import { Button, EmptyState, Icon, Spinner, cn } from './ui'
import { Link } from 'react-router-dom'

/** Direct-download URL when the source allows browser fetches (arXiv serves CORS). */
function fetchableUrl(pdfUrl: string | null | undefined): string | null {
  if (!pdfUrl) return null
  const m = /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/.exec(pdfUrl)
  return m ? `https://arxiv.org/pdf/${m[1]}` : null
}

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const PAGE_GAP = 12

interface PageInfo {
  width: number
  height: number
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Wrap query matches in <mark> inside the text layer; restores originals first. */
function applyHighlight(container: HTMLElement, query: string) {
  const q = query.trim().toLowerCase()
  for (const span of container.querySelectorAll<HTMLElement>(':scope > span')) {
    const orig = span.dataset.orig ?? span.textContent ?? ''
    if (span.dataset.orig != null) {
      span.textContent = orig
      delete span.dataset.orig
    }
    if (!q) continue
    const lower = orig.toLowerCase()
    if (!lower.includes(q)) continue
    span.dataset.orig = orig
    let html = ''
    let i = 0
    for (;;) {
      const at = lower.indexOf(q, i)
      if (at === -1) {
        html += escapeHtml(orig.slice(i))
        break
      }
      html += `${escapeHtml(orig.slice(i, at))}<mark class="pdf-hl">${escapeHtml(orig.slice(at, at + q.length))}</mark>`
      i = at + q.length
    }
    span.innerHTML = html
  }
}

function PageView({
  doc,
  pageNo,
  scale,
  visible,
  size,
  highlight,
}: {
  doc: PDFDocumentProxy
  pageNo: number
  scale: number
  visible: boolean
  size: PageInfo
  highlight: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const renderTask = useRef<ReturnType<PDFPageProxy['render']> | null>(null)
  const [textReady, setTextReady] = useState(0)

  useEffect(() => {
    let cancelled = false
    if (!visible) return
    ;(async () => {
      const page = await doc.getPage(pageNo)
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const textDiv = textRef.current
      if (!canvas || !textDiv) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')!
      renderTask.current?.cancel()
      renderTask.current = page.render({
        canvasContext: ctx,
        viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      })
      try {
        await renderTask.current.promise
      } catch {
        return // cancelled
      }
      if (cancelled) return
      // text layer for selection/copy
      textDiv.innerHTML = ''
      textDiv.style.setProperty('--scale-factor', String(viewport.scale))
      try {
        const textLayer = new pdfjs.TextLayer({
          textContentSource: page.streamTextContent(),
          container: textDiv,
          viewport,
        })
        await textLayer.render()
        if (!cancelled) setTextReady((t) => t + 1)
      } catch {
        /* text layer is best-effort */
      }
    })()
    return () => {
      cancelled = true
      renderTask.current?.cancel()
    }
  }, [doc, pageNo, scale, visible])

  // (re)apply search highlight whenever the text layer or query changes
  useEffect(() => {
    if (textRef.current && visible) applyHighlight(textRef.current, highlight)
  }, [highlight, textReady, visible])

  const w = size.width * scale
  const h = size.height * scale
  return (
    <div
      data-page={pageNo}
      className="page-shell relative mx-auto bg-white shadow-lg shadow-black/40"
      style={{ width: w, height: h, marginBottom: PAGE_GAP }}
    >
      {visible ? (
        <>
          <canvas ref={canvasRef} className="absolute inset-0" />
          <div ref={textRef} className="textLayer" />
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900 text-xs text-neutral-600">
          {pageNo}
        </div>
      )}
    </div>
  )
}

export default function PdfReader({
  itemId,
  pdfFile,
  pdfUrl,
  requestedPage,
  onPageHandled,
  onAddPageNote,
}: {
  itemId: string
  pdfFile: string | null
  pdfUrl?: string | null
  /** page requested externally (e.g. a p.N link in notes); consumed via onPageHandled */
  requestedPage?: number | null
  onPageHandled?: () => void
  onAddPageNote?: (page: number) => void
}) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageSizes, setPageSizes] = useState<PageInfo[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'unsupported'>('loading')
  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [fitScale, setFitScale] = useState(1)
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [currentPage, setCurrentPage] = useState(1)
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1, 2]))
  const containerRef = useRef<HTMLDivElement>(null)
  const setReadingPosition = useData((s) => s.setReadingPosition)
  const initialPage = useRef(useData.getState().progress[itemId]?.lastPage ?? 1)

  const scale = zoom === 'fit' ? fitScale : zoom

  // load document from OPFS
  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    setDoc(null)
    setState('loading')
    ;(async () => {
      if (!pdfFile) {
        setState('missing')
        return
      }
      const buf = await readPdf(pdfFile)
      if (cancelled) return
      if (!buf) {
        setState('missing')
        return
      }
      try {
        loaded = await pdfjs.getDocument({ data: buf }).promise
        if (cancelled) return
        const sizes: PageInfo[] = []
        const first = await loaded.getPage(1)
        const vp1 = first.getViewport({ scale: 1 })
        for (let i = 1; i <= loaded.numPages; i++) {
          // assume uniform page size (true for papers) to avoid loading every page up front
          sizes.push({ width: vp1.width, height: vp1.height })
        }
        setDoc(loaded)
        setPageSizes(sizes)
        setState('ready')
      } catch (e) {
        console.error('pdf load failed', e)
        setState('unsupported')
      }
    })()
    return () => {
      cancelled = true
      void loaded?.destroy()
    }
  }, [pdfFile, reloadTick])

  const fetchFromSource = useCallback(async () => {
    const url = fetchableUrl(pdfUrl)
    if (!url || !pdfFile) return
    setFetching(true)
    setFetchError(null)
    try {
      const res = await fetch(url)
      const buf = await res.arrayBuffer()
      const head = new Uint8Array(buf.slice(0, 5))
      if (!res.ok || String.fromCharCode(...head) !== '%PDF-') {
        throw new Error(`source returned ${res.status}`)
      }
      await writePdf(pdfFile, buf)
      await useData.getState().refreshPdfList()
      setReloadTick((t) => t + 1)
    } catch (e: any) {
      setFetchError(e?.message ?? String(e))
    } finally {
      setFetching(false)
    }
  }, [pdfUrl, pdfFile])

  // fit-width scale
  useEffect(() => {
    const el = containerRef.current
    if (!el || pageSizes.length === 0) return
    const compute = () => {
      const pad = 32
      setFitScale(Math.max(0.4, (el.clientWidth - pad) / pageSizes[0].width))
    }
    compute()
    const ro = new ResizeObserver(compute)
    ro.observe(el)
    return () => ro.disconnect()
  }, [pageSizes])

  // render-visibility tracking (which pages get canvases)
  useEffect(() => {
    const el = containerRef.current
    if (!el || state !== 'ready') return
    const io = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev)
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page)
            if (e.isIntersecting) next.add(n)
            else next.delete(n)
          }
          return next
        })
      },
      { root: el, rootMargin: '600px 0px' },
    )
    const shells = el.querySelectorAll('.page-shell')
    shells.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [state, pageSizes.length, scale])

  // current page: deterministic scroll geometry (stable across zoom/layout)
  useEffect(() => {
    const el = containerRef.current
    if (!el || state !== 'ready' || pageSizes.length === 0) return
    let raf = 0
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        setCurrentPage(
          pageFromScroll(el.scrollTop, el.clientHeight, pageSizes[0].height * scale, PAGE_GAP, pageSizes.length),
        )
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [state, pageSizes, scale])

  // persist reading position (debounced) + flush immediately on unmount
  const positionRef = useRef({ page: 1, total: 0 })
  useEffect(() => {
    if (state !== 'ready' || !doc) return
    positionRef.current = { page: currentPage, total: doc.numPages }
    const t = setTimeout(() => setReadingPosition(itemId, currentPage, doc.numPages), 1500)
    return () => clearTimeout(t)
  }, [currentPage, state, doc, itemId, setReadingPosition])
  useEffect(
    () => () => {
      const { page, total } = positionRef.current
      if (total > 0) setReadingPosition(itemId, page, total)
    },
    [itemId, setReadingPosition],
  )

  const scrollToPage = useCallback(
    (n: number) => {
      const el = containerRef.current
      if (!el || pageSizes.length === 0) return
      const clamped = Math.min(pageSizes.length, Math.max(1, n))
      el.scrollTop = scrollTopForPage(clamped, pageSizes[0].height * scale, PAGE_GAP, pageSizes.length)
      setCurrentPage(clamped)
    },
    [pageSizes, scale],
  )

  // restore last position once ready
  useEffect(() => {
    if (state !== 'ready') return
    const target = initialPage.current
    if (target > 1) {
      requestAnimationFrame(() => scrollToPage(target))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // zoom preserving the current page
  const zoomBy = (f: number) => {
    const keep = currentPage
    setZoom((z) => Math.min(4, Math.max(0.4, (z === 'fit' ? fitScale : z) * f)))
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToPageRef.current(keep)))
  }
  const setZoomMode = (mode: 'fit') => {
    const keep = currentPage
    setZoom(mode)
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToPageRef.current(keep)))
  }
  const scrollToPageRef = useRef(scrollToPage)
  scrollToPageRef.current = scrollToPage

  // externally requested page (note links) — works even across remounts
  useEffect(() => {
    if (state !== 'ready' || requestedPage == null) return
    scrollToPage(requestedPage)
    onPageHandled?.()
  }, [state, requestedPage, scrollToPage, onPageHandled])

  // ---- search (text-layer based) ----
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  const [matches, setMatches] = useState<Array<{ page: number; count: number }>>([])
  const [matchIdx, setMatchIdx] = useState(0)
  const [searching, setSearching] = useState(false)
  const textCache = useRef(new Map<number, string>())

  useEffect(() => {
    textCache.current.clear()
    setMatches([])
    setActiveQuery('')
    setQuery('')
    setSearchOpen(false)
  }, [pdfFile, reloadTick])

  const runSearch = useCallback(async () => {
    const q = query.trim().toLowerCase()
    if (!doc || !q) return
    setSearching(true)
    setActiveQuery(query.trim())
    const found: Array<{ page: number; count: number }> = []
    for (let n = 1; n <= doc.numPages; n++) {
      let text = textCache.current.get(n)
      if (text == null) {
        try {
          const page = await doc.getPage(n)
          const content = await page.getTextContent()
          text = content.items.map((it: any) => it.str ?? '').join(' ')
        } catch {
          text = ''
        }
        textCache.current.set(n, text)
      }
      const lower = text.toLowerCase()
      let count = 0
      for (let i = lower.indexOf(q); i !== -1; i = lower.indexOf(q, i + q.length)) count++
      if (count > 0) found.push({ page: n, count })
    }
    setMatches(found)
    setMatchIdx(0)
    setSearching(false)
    if (found.length > 0) scrollToPageRef.current(found[0].page)
  }, [doc, query])

  const stepMatch = (dir: 1 | -1) => {
    if (matches.length === 0) return
    const next = (matchIdx + dir + matches.length) % matches.length
    setMatchIdx(next)
    scrollToPageRef.current(matches[next].page)
  }

  const totalMatches = matches.reduce((a, m) => a + m.count, 0)

  // ---- bookmarks ----
  const bookmarks = useData((s) => s.progress[itemId]?.bookmarks) ?? []
  const toggleBookmark = useData((s) => s.toggleBookmark)
  const [bookmarksOpen, setBookmarksOpen] = useState(false)
  const pageBookmarked = bookmarks.some((b) => b.page === currentPage)

  const pages = useMemo(() => Array.from({ length: pageSizes.length }, (_, i) => i + 1), [pageSizes.length])

  if (state === 'missing') {
    const canFetch = !!fetchableUrl(pdfUrl) && !!pdfFile
    return (
      <div className="p-4">
        <EmptyState title="PDF not on this device yet">
          {canFetch && (
            <div className="mb-3 flex flex-col items-center gap-1.5">
              <Button variant="primary" onClick={() => void fetchFromSource()} disabled={fetching}>
                {fetching ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="download" className="h-3.5 w-3.5" />}
                Fetch from arXiv
              </Button>
              {fetchError && <span className="text-red-400">failed: {fetchError}</span>}
            </div>
          )}
          {pdfFile ? (
            <>
              Or import your library in{' '}
              <Link to="/settings" className="text-amber-400 underline">
                Settings → PDF library
              </Link>{' '}
              (expects <code className="text-neutral-400">{pdfFile}</code>)
            </>
          ) : (
            'No freely downloadable PDF exists for this item — use the source link in the Info tab.'
          )}
        </EmptyState>
      </div>
    )
  }
  if (state === 'unsupported') return <EmptyState title="Could not render this PDF" />
  if (state === 'loading' || !doc) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-neutral-800 px-2 py-1.5">
        <Button variant="ghost" onClick={() => zoomBy(1 / 1.2)} title="Zoom out" aria-label="Zoom out" className="px-2">
          −
        </Button>
        <Button variant="ghost" onClick={() => zoomBy(1.2)} title="Zoom in" aria-label="Zoom in" className="px-2">
          +
        </Button>
        <Button variant="ghost" onClick={() => setZoomMode('fit')} title="Fit width" aria-label="Fit width" className="px-2">
          <Icon name="external" className="h-3.5 w-3.5 rotate-90" />
        </Button>

        {/* search */}
        <Button
          variant="ghost"
          onClick={() => {
            setSearchOpen((o) => !o)
            if (searchOpen) {
              setActiveQuery('')
              setMatches([])
            }
          }}
          title="Search in PDF"
          aria-label="Search in PDF"
          aria-expanded={searchOpen}
          className="px-2"
        >
          <Icon name="search" className="h-3.5 w-3.5" />
        </Button>
        {searchOpen && (
          <span className="flex items-center gap-1">
            <label className="sr-only" htmlFor={`pdf-search-${itemId}`}>
              Search text in this PDF
            </label>
            <input
              id={`pdf-search-${itemId}`}
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch()
                if (e.key === 'Escape') setSearchOpen(false)
              }}
              placeholder="find…  (Enter)"
              className="w-32 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-1 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
            />
            {searching ? (
              <Spinner className="h-3 w-3" />
            ) : activeQuery ? (
              <span className="text-[11px] whitespace-nowrap text-neutral-400">
                {totalMatches} in {matches.length}p
              </span>
            ) : null}
            <Button variant="ghost" className="px-1.5" onClick={() => stepMatch(-1)} disabled={!matches.length} aria-label="Previous match">
              ‹
            </Button>
            <Button variant="ghost" className="px-1.5" onClick={() => stepMatch(1)} disabled={!matches.length} aria-label="Next match">
              ›
            </Button>
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* page note */}
          {onAddPageNote && (
            <Button
              variant="ghost"
              onClick={() => onAddPageNote(currentPage)}
              title={`Add a note for page ${currentPage}`}
              aria-label={`Add a note for page ${currentPage}`}
              className="px-2"
            >
              <Icon name="note" className="h-3.5 w-3.5" />
            </Button>
          )}
          {/* bookmarks */}
          <span className="relative">
            <Button
              variant="ghost"
              onClick={() => toggleBookmark(itemId, currentPage)}
              title={pageBookmarked ? `Remove bookmark on page ${currentPage}` : `Bookmark page ${currentPage}`}
              aria-label={pageBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
              aria-pressed={pageBookmarked}
              className={cn('px-2', pageBookmarked && 'text-amber-400')}
            >
              <Icon name="bookmark" className="h-3.5 w-3.5" />
            </Button>
            {bookmarks.length > 0 && (
              <Button
                variant="ghost"
                onClick={() => setBookmarksOpen((o) => !o)}
                className="px-1"
                aria-label={`Show ${bookmarks.length} bookmarks`}
                aria-expanded={bookmarksOpen}
              >
                <Icon name="chevron" className={cn('h-3 w-3', bookmarksOpen ? '-rotate-90' : 'rotate-90')} />
              </Button>
            )}
            {bookmarksOpen && (
              <ul className="absolute top-full right-0 z-30 mt-1 max-h-56 w-40 overflow-y-auto rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl">
                {bookmarks.map((b) => (
                  <li key={b.page} className="flex items-center">
                    <button
                      className="min-h-8 flex-1 rounded px-2 text-left text-xs text-neutral-300 hover:bg-neutral-800"
                      onClick={() => {
                        scrollToPage(b.page)
                        setBookmarksOpen(false)
                      }}
                    >
                      page {b.page}
                    </button>
                    <button
                      className="flex h-8 w-8 items-center justify-center text-neutral-600 hover:text-red-400"
                      onClick={() => toggleBookmark(itemId, b.page)}
                      aria-label={`Delete bookmark on page ${b.page}`}
                    >
                      <Icon name="x" className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </span>

          <label className="sr-only" htmlFor={`pdf-page-${itemId}`}>
            Current page
          </label>
          <input
            id={`pdf-page-${itemId}`}
            type="number"
            min={1}
            max={doc.numPages}
            value={currentPage}
            onChange={(e) => {
              const n = Math.min(doc.numPages, Math.max(1, Number(e.target.value)))
              setCurrentPage(n)
              scrollToPage(n)
            }}
            className="w-14 rounded border border-neutral-700 bg-neutral-900 px-1.5 py-0.5 text-center text-xs"
          />
          <span className="text-xs text-neutral-500">/ {doc.numPages}</span>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-neutral-900/60 p-4">
        {pages.map((n) => (
          <PageView
            key={n}
            doc={doc}
            pageNo={n}
            scale={scale}
            visible={visiblePages.has(n)}
            size={pageSizes[n - 1]}
            highlight={activeQuery}
          />
        ))}
      </div>
    </div>
  )
}
