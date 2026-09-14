import { useMemo, useState } from 'react'
import type { LearningSource } from '../types'
import { useData } from '../store/data'
import {
  diffNewVideos,
  embedUrl,
  fetchPlaylistItems,
  getYouTubeKey,
  mergeSeen,
  oembedLookup,
  parseYouTubeUrl,
  setYouTubeKey,
  type PlaylistVideo,
} from '../lib/youtube'
import { Button, Chip, EmptyState, Icon, Spinner, cn } from '../components/ui'
import seedsRaw from '../data/seed-sources.json'

const SEEDS = seedsRaw as Array<
  Pick<LearningSource, 'title' | 'url' | 'type' | 'provider' | 'playlistId'>
>

interface CheckState {
  checking?: boolean
  error?: string
  newVideos?: PlaylistVideo[]
}

function SourceCard({
  source,
  check,
  onCheck,
  onMarkSeen,
  onRemove,
}: {
  source: LearningSource
  check: CheckState
  onCheck: () => void
  onMarkSeen: () => void
  onRemove: () => void
}) {
  const [embedOpen, setEmbedOpen] = useState(false)
  const embed = embedUrl(source)
  const watchable = !!source.playlistId
  const hasKey = !!getYouTubeKey()

  return (
    <li className="rounded-lg border border-neutral-800 p-3">
      <div className="flex items-start gap-2">
        <Icon
          name={source.type === 'site' ? 'external' : 'play'}
          className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/80"
        />
        <div className="min-w-0 flex-1">
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] leading-snug font-medium text-neutral-200 hover:text-amber-300"
          >
            {source.title} <Icon name="external" className="inline h-3 w-3 align-[-2px] text-neutral-500" />
          </a>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">
            {source.provider && <span>{source.provider}</span>}
            <Chip>{source.type.replace('youtube-', 'yt ')}</Chip>
            {source.lastChecked && <span>checked {new Date(source.lastChecked).toLocaleDateString()}</span>}
          </p>
          {source.notes && <p className="mt-1 text-[11px] text-neutral-400">{source.notes}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {embed && (
            <Button variant="ghost" className="px-2" onClick={() => setEmbedOpen(!embedOpen)} aria-expanded={embedOpen} title={embedOpen ? 'Hide player' : 'Play here (loads YouTube on click)'}>
              <Icon name="play" className="h-3.5 w-3.5" />
            </Button>
          )}
          {watchable && (
            <Button variant="ghost" className="px-2" onClick={onCheck} disabled={!hasKey || check.checking} title={hasKey ? 'Check for new lectures (official YouTube API)' : 'Add your YouTube API key below to enable checking'}>
              {check.checking ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="sync" className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button variant="ghost" className="px-2" onClick={onRemove} title="Remove source" aria-label={`Remove ${source.title}`}>
            <Icon name="trash" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {check.error && <p className="mt-2 text-[11px] text-red-400">check failed: {check.error}</p>}
      {check.newVideos && (
        <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-900/50 p-2">
          {check.newVideos.length === 0 ? (
            <p className="text-[11px] text-neutral-400">Nothing new since your last mark-seen.</p>
          ) : (
            <>
              <p className="mb-1 text-[11px] font-medium text-amber-300">
                {check.newVideos.length} new video{check.newVideos.length === 1 ? '' : 's'}
              </p>
              <ul className="flex flex-col gap-0.5">
                {check.newVideos.slice(0, 8).map((v) => (
                  <li key={v.videoId}>
                    <a
                      href={`https://www.youtube.com/watch?v=${v.videoId}&list=${source.playlistId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[11px] text-neutral-300 hover:text-amber-300"
                    >
                      {v.title}
                      <span className="ml-1 text-neutral-600">{v.publishedAt.slice(0, 10)}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <Button variant="ghost" className="mt-1.5 px-2 py-0.5" onClick={onMarkSeen}>
                <Icon name="check" className="h-3 w-3" /> mark seen
              </Button>
            </>
          )}
        </div>
      )}

      {embedOpen && embed && (
        <div className="mt-2 aspect-video overflow-hidden rounded-lg border border-neutral-800">
          <iframe
            src={embed}
            title={source.title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
    </li>
  )
}

export default function Sources() {
  const sources = useData((s) => s.sources)
  const addSource = useData((s) => s.addSource)
  const updateSource = useData((s) => s.updateSource)
  const removeSource = useData((s) => s.removeSource)

  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState(getYouTubeKey())
  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const [checkingAll, setCheckingAll] = useState(false)

  const groups = useMemo(() => {
    const yt = sources.filter((s) => s.type !== 'site')
    const sites = sources.filter((s) => s.type === 'site')
    return { yt, sites }
  }, [sources])

  const add = async () => {
    setAddError(null)
    if (!url.trim()) return
    setAdding(true)
    try {
      const yt = parseYouTubeUrl(url)
      let resolvedTitle = title.trim()
      let provider: string | null = null
      if (yt && !resolvedTitle) {
        const info = await oembedLookup(url.trim())
        if (info) {
          resolvedTitle = info.title
          provider = info.author || null
        }
      }
      if (!resolvedTitle && !yt) {
        try {
          resolvedTitle = new URL(url.trim()).hostname
        } catch {
          setAddError('Enter a valid URL.')
          setAdding(false)
          return
        }
      }
      const now = new Date().toISOString()
      addSource({
        id: crypto.randomUUID(),
        title: resolvedTitle || url.trim(),
        url: url.trim(),
        type: yt ? (yt.playlistId ? 'youtube-playlist' : 'youtube-video') : 'site',
        provider,
        playlistId: yt?.playlistId ?? null,
        videoId: yt?.videoId ?? null,
        addedAt: now,
      })
      setUrl('')
      setTitle('')
    } finally {
      setAdding(false)
    }
  }

  const checkOne = async (s: LearningSource) => {
    if (!s.playlistId) return
    const key = getYouTubeKey()
    if (!key) return
    setChecks((c) => ({ ...c, [s.id]: { checking: true } }))
    try {
      const fetched = await fetchPlaylistItems(s.playlistId, key)
      const first = !s.seenVideoIds || s.seenVideoIds.length === 0
      // first check baselines silently: everything existing counts as seen
      if (first) {
        updateSource({ ...s, seenVideoIds: mergeSeen(fetched, []), lastChecked: new Date().toISOString() })
        setChecks((c) => ({ ...c, [s.id]: { newVideos: [] } }))
      } else {
        updateSource({ ...s, lastChecked: new Date().toISOString() })
        setChecks((c) => ({ ...c, [s.id]: { newVideos: diffNewVideos(fetched, s.seenVideoIds) } }))
      }
    } catch (e: any) {
      setChecks((c) => ({ ...c, [s.id]: { error: e?.message ?? String(e) } }))
    }
  }

  const markSeen = async (s: LearningSource) => {
    const key = getYouTubeKey()
    if (!key || !s.playlistId) return
    const fetched = await fetchPlaylistItems(s.playlistId, key).catch(() => [])
    updateSource({ ...s, seenVideoIds: mergeSeen(fetched, s.seenVideoIds), lastChecked: new Date().toISOString() })
    setChecks((c) => ({ ...c, [s.id]: { newVideos: [] } }))
  }

  const checkAll = async () => {
    setCheckingAll(true)
    for (const s of sources) {
      if (s.playlistId) await checkOne(s)
    }
    setCheckingAll(false)
  }

  const importSeeds = () => {
    const now = new Date().toISOString()
    for (const seed of SEEDS) {
      if (sources.some((s) => s.url === seed.url)) continue
      addSource({
        id: crypto.randomUUID(),
        title: seed.title,
        url: seed.url,
        type: seed.type,
        provider: seed.provider ?? null,
        playlistId: seed.playlistId ?? null,
        videoId: null,
        addedAt: now,
      })
    }
  }

  const hasKey = !!getYouTubeKey()

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-100">Sources</h1>
      <p className="mb-4 text-xs text-neutral-500">
        External courses and playlists you follow. Everything opens in a new tab or as a
        click-to-load player — nothing here is required for reading, and nothing is fetched
        without your action.
      </p>

      {/* add source */}
      <div className="mb-4 grid gap-2 rounded-lg border border-neutral-800 p-3 sm:grid-cols-[2fr_1fr_auto]">
        <label className="flex flex-col gap-1 text-[11px] text-neutral-400" htmlFor="src-url">
          URL (YouTube playlist/video or any course page)
          <input
            id="src-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://www.youtube.com/playlist?list=…"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] text-neutral-400" htmlFor="src-title">
          Title (optional — auto-detected for YouTube)
          <input
            id="src-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="auto"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
          />
        </label>
        <div className="flex items-end">
          <Button variant="primary" onClick={() => void add()} disabled={adding || !url.trim()}>
            {adding ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="plus" className="h-3.5 w-3.5" />} Add
          </Button>
        </div>
        {addError && <p className="text-[11px] text-red-400 sm:col-span-3">{addError}</p>}
      </div>

      {sources.length === 0 && (
        <div className="mb-4">
          <EmptyState title="No sources yet">
            <Button variant="primary" onClick={importSeeds}>
              <Icon name="download" className="h-3.5 w-3.5" /> Add {SEEDS.length} verified course sources
            </Button>
            <p className="mt-2">
              Official university playlists (Stanford, MIT, CMU, Harvard) and course sites —
              verified as published by the universities/authors themselves.
            </p>
          </EmptyState>
        </div>
      )}

      {groups.yt.length > 0 && (
        <section aria-label="YouTube sources" className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
              Playlists & videos
            </h2>
            <Button onClick={() => void checkAll()} disabled={!hasKey || checkingAll} title={hasKey ? 'Check all playlists for new lectures' : 'Add your API key below first'}>
              {checkingAll ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="radar" className="h-3.5 w-3.5" />}
              Check all
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {groups.yt.map((s) => (
              <SourceCard
                key={s.id}
                source={s}
                check={checks[s.id] ?? {}}
                onCheck={() => void checkOne(s)}
                onMarkSeen={() => void markSeen(s)}
                onRemove={() => {
                  if (confirm(`Remove "${s.title}" from your sources?`)) removeSource(s.id)
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {groups.sites.length > 0 && (
        <section aria-label="Course sites" className="mb-5">
          <h2 className="mb-2 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            Course sites & tools
          </h2>
          <ul className="flex flex-col gap-2">
            {groups.sites.map((s) => (
              <SourceCard
                key={s.id}
                source={s}
                check={{}}
                onCheck={() => {}}
                onMarkSeen={() => {}}
                onRemove={() => {
                  if (confirm(`Remove "${s.title}" from your sources?`)) removeSource(s.id)
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {/* watcher setup */}
      <section aria-label="Watcher setup" className="rounded-xl border border-neutral-800 bg-neutral-900/30 p-4">
        <h2 className="mb-1 text-sm font-semibold text-neutral-200">Lecture watcher (optional)</h2>
        <p className="mb-2 text-[11px] leading-relaxed text-neutral-500">
          "Check" uses the official YouTube Data API with <b>your own free API key</b> — create one
          in Google Cloud Console (enable "YouTube Data API v3" → Credentials → API key; restrict it
          to that API and to your app's URL). The key stays in this browser's localStorage, is never
          synced, and nothing is checked automatically — only when you click.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="yt-key">
            YouTube Data API key
          </label>
          <input
            id="yt-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="YouTube Data API key"
            autoComplete="off"
            className="w-64 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
          />
          <Button
            onClick={() => {
              setYouTubeKey(apiKey)
              setApiKey(getYouTubeKey())
            }}
          >
            Save key
          </Button>
          <span className={cn('text-[11px]', hasKey ? 'text-emerald-400' : 'text-neutral-500')}>
            {hasKey ? 'key set (device-local)' : 'no key — embeds and links still work'}
          </span>
        </div>
      </section>
    </div>
  )
}
