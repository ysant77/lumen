import { useMemo, useRef, useState } from 'react'
import type { LearningSource } from '../types'
import { useData } from '../store/data'
import { isHttpUrl } from '../lib/lookup'
import {
  ackVideos,
  embedUrl,
  fetchAllPlaylistItems,
  getYouTubeKey,
  oembedLookup,
  parseYouTubeUrl,
  planCheck,
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
  error?: string | null
  /** pending results survive later failures until acknowledged */
  newVideos?: PlaylistVideo[]
  /** the exact snapshot the user saw; "mark seen" acknowledges THIS, never a fresh fetch */
  snapshot?: PlaylistVideo[]
  incomplete?: boolean
  note?: string
}

function SourceCard({
  source,
  check,
  hasKey,
  onCheck,
  onMarkSeen,
  onRemove,
}: {
  source: LearningSource
  check: CheckState
  hasKey: boolean
  onCheck: () => void
  onMarkSeen: () => void
  onRemove: () => void
}) {
  const [embedOpen, setEmbedOpen] = useState(false)
  const embed = embedUrl(source)
  const watchable = !!source.playlistId

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
            {watchable && !source.baselinedAt && <Chip>not baselined yet</Chip>}
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
            <Button variant="ghost" className="px-2" onClick={onCheck} disabled={!hasKey || check.checking} title={hasKey ? 'Check for new lectures (YouTube Data API)' : 'Add your YouTube API key below to enable checking'} aria-label={`Check ${source.title} for new videos`}>
              {check.checking ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="sync" className="h-3.5 w-3.5" />}
            </Button>
          )}
          <Button variant="ghost" className="px-2" onClick={onRemove} title="Remove source" aria-label={`Remove ${source.title}`}>
            <Icon name="trash" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {check.error && (
        <p className="mt-2 text-[11px] text-red-400">
          check failed: {check.error}
          {check.newVideos && check.newVideos.length > 0 && ' — earlier results below are kept'}
        </p>
      )}
      {check.note && <p className="mt-2 text-[11px] text-neutral-400">{check.note}</p>}
      {check.incomplete && (
        <p className="mt-2 text-[11px] text-orange-300">
          Incomplete check: the playlist is larger than one check's request budget, so results may
          miss entries. "Mark seen" only acknowledges what was actually fetched.
        </p>
      )}
      {check.newVideos && (
        <div className="mt-2 rounded-md border border-neutral-800 bg-neutral-900/50 p-2">
          {check.newVideos.length === 0 ? (
            <p className="text-[11px] text-neutral-400">Nothing new since your last acknowledgement.</p>
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
                {check.newVideos.length > 8 && (
                  <li className="text-[11px] text-neutral-500">…and {check.newVideos.length - 8} more</li>
                )}
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

  // key controls: single state source so saving/clearing updates everything at once
  const [savedKey, setSavedKey] = useState(getYouTubeKey())
  const [keyInput, setKeyInput] = useState(savedKey)
  const hasKey = !!savedKey

  const [checks, setChecks] = useState<Record<string, CheckState>>({})
  const [checkingAll, setCheckingAll] = useState(false)
  const inFlight = useRef(new Set<string>())

  const groups = useMemo(() => {
    const yt = sources.filter((s) => s.type !== 'site')
    const sites = sources.filter((s) => s.type === 'site')
    return { yt, sites }
  }, [sources])

  const add = async () => {
    setAddError(null)
    const trimmed = url.trim()
    if (!trimmed) return
    if (!isHttpUrl(trimmed)) {
      setAddError('Enter a valid http(s) URL.')
      return
    }
    if (sources.some((s) => s.url === trimmed)) {
      setAddError('Already in your sources — not added again.')
      return
    }
    setAdding(true)
    try {
      const yt = parseYouTubeUrl(trimmed)
      let resolvedTitle = title.trim()
      let provider: string | null = null
      if (yt && !resolvedTitle) {
        const info = await oembedLookup(trimmed)
        if (info) {
          resolvedTitle = info.title
          provider = info.author || null
        }
      }
      if (!resolvedTitle) resolvedTitle = yt ? trimmed : new URL(trimmed).hostname
      addSource({
        id: crypto.randomUUID(),
        title: resolvedTitle,
        url: trimmed,
        type: yt ? (yt.playlistId ? 'youtube-playlist' : 'youtube-video') : 'site',
        provider,
        playlistId: yt?.playlistId ?? null,
        videoId: yt?.videoId ?? null,
        addedAt: new Date().toISOString(),
      })
      setUrl('')
      setTitle('')
    } finally {
      setAdding(false)
    }
  }

  const checkOne = async (s: LearningSource) => {
    if (!s.playlistId || !hasKey || inFlight.current.has(s.id)) return
    inFlight.current.add(s.id)
    // preserve prior pending results while a new check runs
    setChecks((c) => ({ ...c, [s.id]: { ...c[s.id], checking: true, error: null } }))
    try {
      const { videos, incomplete } = await fetchAllPlaylistItems(s.playlistId, savedKey)
      // operate on the LATEST source state, not the render-time closure
      const latest = useData.getState().sources.find((x) => x.id === s.id)
      if (!latest) return // removed while checking
      const now = new Date().toISOString()
      const plan = planCheck(latest, videos, incomplete)
      if (plan.action === 'no-baseline-incomplete') {
        // a truncated fetch must never claim (or upgrade to) a complete baseline
        updateSource({ ...latest, lastChecked: now })
        setChecks((c) => ({
          ...c,
          [s.id]: {
            incomplete: true,
            note: 'This playlist exceeds one check\u2019s request budget, so a complete baseline could not be established — nothing was marked seen.',
          },
        }))
      } else if (plan.action === 'baseline') {
        updateSource({ ...latest, seenVideoIds: plan.ackIds, baselinedAt: now, lastChecked: now })
        setChecks((c) => ({
          ...c,
          [s.id]: {
            newVideos: [],
            snapshot: videos,
            incomplete,
            note: plan.migratedFromPartial
              ? 'Baseline upgraded to the full playlist (earlier versions only tracked the first page); new uploads are reported from now on.'
              : videos.length === 0
                ? 'Playlist is currently empty — its first upload will be reported as new.'
                : `Baseline established (${videos.length} existing videos marked seen).`,
          },
        }))
      } else {
        updateSource({ ...latest, lastChecked: now })
        setChecks((c) => ({ ...c, [s.id]: { newVideos: plan.newVideos, snapshot: videos, incomplete } }))
      }
    } catch (e: any) {
      // failures keep pending results and do NOT touch source timestamps
      setChecks((c) => ({ ...c, [s.id]: { ...c[s.id], checking: false, error: e?.message ?? String(e) } }))
      return
    } finally {
      inFlight.current.delete(s.id)
      setChecks((c) => ({ ...c, [s.id]: { ...c[s.id], checking: false } }))
    }
  }

  const markSeen = (s: LearningSource) => {
    const state = checks[s.id]
    const snapshot = state?.snapshot
    if (!snapshot) return // nothing checked yet; never ack from a blind fetch
    const latest = useData.getState().sources.find((x) => x.id === s.id)
    if (!latest) return
    const now = new Date().toISOString()
    updateSource({
      ...latest,
      seenVideoIds: ackVideos(latest.seenVideoIds, snapshot),
      // an incomplete snapshot may acknowledge what was seen, but must never
      // establish a complete baseline it cannot vouch for
      baselinedAt: latest.baselinedAt ?? (state.incomplete ? null : now),
      lastChecked: now,
    })
    setChecks((c) => ({ ...c, [s.id]: { ...c[s.id], newVideos: [], note: undefined } }))
  }

  const checkAll = async () => {
    if (checkingAll) return
    setCheckingAll(true)
    try {
      for (const s of useData.getState().sources) {
        if (s.playlistId) await checkOne(s)
      }
    } finally {
      setCheckingAll(false)
    }
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

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <h1 className="mb-1 text-lg font-semibold text-neutral-100">Sources</h1>
      <p className="mb-4 text-xs text-neutral-500">
        External courses and playlists you follow. Links open in a new tab; players load only when
        you tap them; the watcher fetches only when you click Check. None of this is required for
        reading, notes or progress.
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
        {addError && (
          <p className="text-[11px] text-red-400 sm:col-span-3" role="alert">
            {addError}
          </p>
        )}
      </div>

      {sources.length === 0 && (
        <div className="mb-4">
          <EmptyState title="No sources yet">
            <Button variant="primary" onClick={importSeeds}>
              <Icon name="download" className="h-3.5 w-3.5" /> Add {SEEDS.length} verified course sources
            </Button>
            <p className="mt-2">
              University playlists (Stanford, MIT, CMU, Harvard) and course sites — playlist
              uploaders verified against YouTube before inclusion.
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
                hasKey={hasKey}
                onCheck={() => void checkOne(s)}
                onMarkSeen={() => markSeen(s)}
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
          <h2 className="mb-1 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
            Course sites & tools
          </h2>
          <p className="mb-2 text-[11px] text-neutral-500">
            Plain links (opened manually) — lumen has no permitted way to check these sites for
            updates from the browser today, and won't pretend otherwise.
          </p>
          <ul className="flex flex-col gap-2">
            {groups.sites.map((s) => (
              <SourceCard
                key={s.id}
                source={s}
                check={{}}
                hasKey={hasKey}
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
          "Check" calls the YouTube Data API v3 with <b>your own API key</b> (Google Cloud Console →
          enable YouTube Data API v3 → Credentials → API key). The key is stored only in this
          browser's localStorage — never synced, exported or logged. Be aware that any key used
          from a browser is visible to whoever can use this device; restricting it (to the YouTube
          Data API and your app URL) limits misuse but does not make it secret.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="yt-key">
            YouTube Data API key
          </label>
          <input
            id="yt-key"
            type="password"
            value={keyInput}
            onChange={(e) => setKeyInput(e.target.value)}
            placeholder="YouTube Data API key"
            autoComplete="off"
            className="w-64 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
          />
          <Button
            onClick={() => {
              setYouTubeKey(keyInput)
              setSavedKey(getYouTubeKey())
            }}
            disabled={!keyInput.trim()}
          >
            Save key
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setYouTubeKey('')
              setKeyInput('')
              setSavedKey('')
            }}
            disabled={!hasKey}
          >
            Clear key
          </Button>
          <span
            className={cn('text-[11px]', hasKey ? 'text-emerald-400' : 'text-neutral-500')}
            data-testid="key-status"
          >
            {hasKey ? 'key set (device-local)' : 'no key — links and embeds still work'}
          </span>
        </div>
      </section>

      {/* provider terms & data handling */}
      <section aria-label="Third-party terms" className="mt-4 rounded-xl border border-neutral-800 bg-neutral-900/20 p-4 text-[11px] leading-relaxed text-neutral-500">
        <h2 className="mb-1 text-xs font-semibold text-neutral-300">Third-party services & data</h2>
        <p>
          YouTube players, title lookup and the lecture watcher use YouTube API Services. By using
          them you agree to the{' '}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer" className="text-amber-400 underline">
            YouTube Terms of Service
          </a>
          ; Google's{' '}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer" className="text-amber-400 underline">
            Privacy Policy
          </a>{' '}
          applies. What lumen stores from YouTube: when you add a YouTube source, its{' '}
          <b className="text-neutral-400">title and uploader name</b> (fetched once via oEmbed) are
          saved on that source record and sync with it — this YouTube-derived metadata is kept only
          as long as the source exists and goes away when you remove it. Watcher (Data API)
          responses are displayed transiently and not retained beyond the check you are looking at;
          lumen additionally persists the video IDs you explicitly mark seen, a baseline flag and
          check timestamps. All of that is source bookkeeping — your notes, decks and reading
          progress are separate user-created data and are never touched or deleted by source
          operations. All network checks are user-initiated; nothing polls in the background.
        </p>
      </section>
    </div>
  )
}
