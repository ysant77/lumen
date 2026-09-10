import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { readPdf } from '../lib/opfs'
import { useData } from '../store/data'
import { Button, EmptyState, Icon, Spinner } from './ui'
import { Link } from 'react-router-dom'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const PAGE_GAP = 12

interface PageInfo {
  width: number
  height: number
}

function PageView({
  doc,
  pageNo,
  scale,
  visible,
  size,
}: {
  doc: PDFDocumentProxy
  pageNo: number
  scale: number
  visible: boolean
  size: PageInfo
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const renderTask = useRef<ReturnType<PDFPageProxy['render']> | null>(null)

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
      } catch {
        /* text layer is best-effort */
      }
    })()
    return () => {
      cancelled = true
      renderTask.current?.cancel()
    }
  }, [doc, pageNo, scale, visible])

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

export default function PdfReader({ itemId, pdfFile }: { itemId: string; pdfFile: string | null }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pageSizes, setPageSizes] = useState<PageInfo[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'unsupported'>('loading')
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
  }, [pdfFile])

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

  // visibility tracking
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
        const tops = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.page))
        if (tops.length) setCurrentPage(Math.min(...tops))
      },
      { root: el, rootMargin: '600px 0px' },
    )
    const shells = el.querySelectorAll('.page-shell')
    shells.forEach((s) => io.observe(s))
    return () => io.disconnect()
  }, [state, pageSizes.length, scale])

  // persist reading position (debounced)
  useEffect(() => {
    if (state !== 'ready' || !doc) return
    const t = setTimeout(() => setReadingPosition(itemId, currentPage, doc.numPages), 1500)
    return () => clearTimeout(t)
  }, [currentPage, state, doc, itemId, setReadingPosition])

  // restore last position once ready
  useEffect(() => {
    if (state !== 'ready') return
    const target = initialPage.current
    if (target > 1) {
      requestAnimationFrame(() => scrollToPage(target))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const scrollToPage = useCallback((n: number) => {
    const el = containerRef.current?.querySelector(`[data-page="${n}"]`)
    el?.scrollIntoView({ block: 'start' })
  }, [])

  const zoomBy = (f: number) => setZoom((z) => Math.min(4, Math.max(0.4, (z === 'fit' ? fitScale : z) * f)))

  const pages = useMemo(() => Array.from({ length: pageSizes.length }, (_, i) => i + 1), [pageSizes.length])

  if (state === 'missing') {
    return (
      <EmptyState title="PDF not imported on this device">
        {pdfFile ? (
          <>
            Import your library in{' '}
            <Link to="/settings" className="text-amber-400 underline">
              Settings → PDF library
            </Link>{' '}
            (expects <code className="text-neutral-400">{pdfFile}</code>)
          </>
        ) : (
          'No freely downloadable PDF exists for this item — use the source link in the Info tab.'
        )}
      </EmptyState>
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
      <div className="flex items-center gap-2 border-b border-neutral-800 px-3 py-1.5">
        <Button variant="ghost" onClick={() => zoomBy(1 / 1.2)} title="Zoom out" className="px-2">
          −
        </Button>
        <Button variant="ghost" onClick={() => zoomBy(1.2)} title="Zoom in" className="px-2">
          +
        </Button>
        <Button variant="ghost" onClick={() => setZoom('fit')} title="Fit width" className="px-2">
          <Icon name="external" className="h-3.5 w-3.5 rotate-90" />
        </Button>
        <div className="ml-auto flex items-center gap-1 text-xs text-neutral-500">
          <input
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
          <span>/ {doc.numPages}</span>
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
          />
        ))}
      </div>
    </div>
  )
}
