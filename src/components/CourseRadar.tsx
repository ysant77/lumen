import { useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { CourseTrack } from '../types'
import {
  SEARCH_QUOTA_UNITS,
  KNOWN_CHANNELS,
  elsewhereLinks,
  isFollowed,
  pickToSource,
  picksForTrack,
  playlistToSource,
  playlistUrl,
  searchCoursePlaylists,
  type CourseOrder,
  type CoursePick,
  type CoursePlaylist,
} from '../lib/courses'
import { embedUrl, getYouTubeKey } from '../lib/youtube'
import { useData } from '../store/data'
import { Button, Chip, EmptyState, Icon, Spinner, cn } from './ui'

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40)
}

interface SearchState {
  loading?: boolean
  error?: string | null
  results?: CoursePlaylist[]
  /** the track's lastChecked BEFORE this search — what "new" is measured against */
  newSince?: string | null
}

function FollowControl({ followed, onFollow, label }: { followed: boolean; onFollow: () => void; label: string }) {
  return followed ? (
    <Link to="/sources">
      <Chip className="border-emerald-800 text-emerald-400">following</Chip>
    </Link>
  ) : (
    <Button variant="primary" onClick={onFollow} aria-label={`Follow ${label}`} title="Adds it to Sources">
      <Icon name="plus" className="h-3.5 w-3.5" /> Follow
    </Button>
  )
}

function CourseCard({
  title,
  url,
  meta,
  body,
  playlistId,
  followed,
  onFollow,
}: {
  title: string
  url: string
  meta: ReactNode
  body?: string
  playlistId?: string | null
  followed: boolean
  onFollow: () => void
}) {
  const [embedOpen, setEmbedOpen] = useState(false)
  const embed = playlistId ? embedUrl({ playlistId }) : null
  return (
    <li className="rounded-lg border border-neutral-800 p-3">
      <div className="flex items-start gap-2">
        <Icon name={playlistId ? 'play' : 'external'} className="mt-0.5 h-4 w-4 shrink-0 text-amber-400/80" />
        <div className="min-w-0 flex-1">
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] leading-snug font-medium text-neutral-200 hover:text-amber-300"
          >
            {title}
          </a>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-neutral-500">{meta}</p>
          {body && <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-neutral-400">{body}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {embed && (
            <Button
              variant="ghost"
              className="px-2"
              onClick={() => setEmbedOpen(!embedOpen)}
              aria-expanded={embedOpen}
              aria-label={`${embedOpen ? 'Hide' : 'Preview'} ${title}`}
              title={embedOpen ? 'Hide player' : 'Preview here (loads YouTube on click)'}
            >
              <Icon name="play" className="h-3.5 w-3.5" />
            </Button>
          )}
          <FollowControl followed={followed} onFollow={onFollow} label={title} />
        </div>
      </div>
      {embedOpen && embed && (
        <div className="mt-2 aspect-video overflow-hidden rounded-lg border border-neutral-800">
          <iframe
            src={embed}
            title={title}
            className="h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}
    </li>
  )
}

export default function CourseRadar({ tabs }: { tabs: ReactNode }) {
  const tracks = useData((s) => s.courseTracks)
  const saveCourseTracks = useData((s) => s.saveCourseTracks)
  const sources = useData((s) => s.sources)
  const addSource = useData((s) => s.addSource)

  const [activeId, setActiveId] = useState(tracks[0]?.id ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ label: '', query: '' })
  const [order, setOrder] = useState<CourseOrder>('relevance')
  const [searches, setSearches] = useState<Record<string, SearchState>>({})

  // one-off search (not saved unless the user says so)
  const [adhocInput, setAdhocInput] = useState('')
  const [adhoc, setAdhoc] = useState<CourseTrack | null>(null)

  // async guard per track: an obsolete response never overwrites a newer one
  const seqs = useRef<Record<string, number>>({})

  const apiKey = getYouTubeKey()
  const hasKey = !!apiKey
  const active = adhoc ?? tracks.find((t) => t.id === activeId) ?? tracks[0]
  const picks = active && !adhoc ? picksForTrack(active.id) : []
  const search = active ? (searches[active.id] ?? {}) : {}

  const runSearch = async (track: CourseTrack, persistCheck: boolean, withOrder: CourseOrder = order) => {
    if (!hasKey) return
    const seq = (seqs.current[track.id] = (seqs.current[track.id] ?? 0) + 1)
    const newSince = persistCheck ? (track.lastChecked ?? null) : null
    setSearches((s) => ({ ...s, [track.id]: { ...s[track.id], loading: true, error: null } }))
    try {
      const results = await searchCoursePlaylists(track.query, apiKey, withOrder)
      if (seq !== seqs.current[track.id]) return
      setSearches((s) => ({ ...s, [track.id]: { results, newSince } }))
      if (persistCheck) {
        const now = new Date().toISOString()
        saveCourseTracks(
          useData.getState().courseTracks.map((t) => (t.id === track.id ? { ...t, lastChecked: now } : t)),
        )
      }
    } catch (e: any) {
      if (seq !== seqs.current[track.id]) return
      // a failed search keeps earlier results and does not count as a check
      setSearches((s) => ({ ...s, [track.id]: { ...s[track.id], loading: false, error: e?.message ?? String(e) } }))
    }
  }

  const runAdhoc = () => {
    const q = adhocInput.trim()
    if (!q) return
    const track: CourseTrack = { id: 'adhoc', label: q, query: q }
    setAdhoc(track)
    setSearches((s) => ({ ...s, adhoc: {} }))
    void runSearch(track, false)
  }

  const saveAdhocAsTrack = () => {
    if (!adhoc) return
    const t: CourseTrack = { ...adhoc, id: slugify(adhoc.query) || crypto.randomUUID().slice(0, 8) }
    if (!tracks.some((x) => x.id === t.id)) saveCourseTracks([...tracks, t])
    setSearches((s) => ({ ...s, [t.id]: s.adhoc ?? {} }))
    setAdhoc(null)
    setActiveId(t.id)
  }

  const addTrack = () => {
    if (!draft.label.trim() || !draft.query.trim()) return
    const t: CourseTrack = {
      id: slugify(draft.label) || crypto.randomUUID().slice(0, 8),
      label: draft.label.trim(),
      query: draft.query.trim(),
    }
    if (tracks.some((x) => x.id === t.id)) return
    saveCourseTracks([...tracks, t])
    setDraft({ label: '', query: '' })
    setActiveId(t.id)
  }

  const removeTrack = (id: string) => {
    const next = tracks.filter((t) => t.id !== id)
    saveCourseTracks(next)
    if (activeId === id) setActiveId(next[0]?.id ?? '')
  }

  const followPick = (p: CoursePick) => addSource(pickToSource(p, crypto.randomUUID(), new Date().toISOString()))
  const followPlaylist = (p: CoursePlaylist) =>
    addSource(playlistToSource(p, crypto.randomUUID(), new Date().toISOString()))

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-6">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-100">Radar</h1>
        <button
          onClick={() => setEditing(!editing)}
          className={cn('text-xs', editing ? 'text-amber-300' : 'text-neutral-500 hover:text-neutral-300')}
        >
          {editing ? 'done' : 'edit tracks'}
        </button>
      </div>
      {tabs}
      <p className="mb-4 text-xs text-neutral-500">
        Free courses and lecture series per track. Follow one and it lands in{' '}
        <Link to="/sources" className="text-amber-400 underline">
          Sources
        </Link>
        , where the lecture watcher tells you when new videos are added.
      </p>

      {/* ---- one-off course search ---- */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="course-q">
          Find courses on any topic
        </label>
        <input
          id="course-q"
          value={adhocInput}
          onChange={(e) => setAdhocInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runAdhoc()}
          placeholder="Find courses on any topic… (e.g. polarimetric SAR calibration)"
          className="min-w-56 flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
        />
        <label className="sr-only" htmlFor="course-order">
          Result order
        </label>
        <select
          id="course-order"
          value={order}
          onChange={(e) => setOrder(e.target.value as CourseOrder)}
          className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs"
        >
          <option value="relevance">most relevant</option>
          <option value="date">newest first</option>
        </select>
        <Button
          variant="primary"
          onClick={runAdhoc}
          disabled={!hasKey || !adhocInput.trim()}
          title={hasKey ? `Searches YouTube (${SEARCH_QUOTA_UNITS} quota units)` : 'Add your YouTube API key in Sources first'}
        >
          <Icon name="search" className="h-3.5 w-3.5" /> Search
        </Button>
        {adhoc && (
          <>
            <Chip className="border-amber-700 text-amber-300">one-off: {adhoc.query.slice(0, 32)}</Chip>
            <Button variant="ghost" className="px-2 py-1" onClick={saveAdhocAsTrack}>
              <Icon name="plus" className="h-3 w-3" /> save as track
            </Button>
            <Button variant="ghost" className="px-2 py-1" onClick={() => setAdhoc(null)} aria-label="Close one-off search">
              <Icon name="x" className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {tracks.map((t) => (
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
                onClick={() => removeTrack(t.id)}
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
        <div className="mb-4 grid gap-2 rounded-lg border border-neutral-800 p-3 sm:grid-cols-[1fr_2fr_auto]">
          <input
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            placeholder="Track label"
            aria-label="Track label"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
          />
          <input
            value={draft.query}
            onChange={(e) => setDraft({ ...draft, query: e.target.value })}
            placeholder="Search terms (e.g. FPGA signal processing course)"
            aria-label="Track search terms"
            className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-xs focus:ring-1 focus:ring-amber-500 focus:outline-none"
          />
          <Button variant="primary" onClick={addTrack}>
            <Icon name="plus" className="h-3.5 w-3.5" /> Add track
          </Button>
        </div>
      )}

      {!active ? (
        <EmptyState title="No tracks">Add a track to start following courses.</EmptyState>
      ) : (
        <>
          {picks.length > 0 && (
            <section aria-label="Starter picks" className="mb-5">
              <h2 className="mb-1 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
                Starter picks
              </h2>
              <p className="mb-2 text-[11px] text-neutral-500">
                Links checked by hand. “audit” means free to audit or preview where the provider
                offers it; certificates are paid.
              </p>
              <ul className="flex flex-col gap-2">
                {picks.map((p) => (
                  <CourseCard
                    key={p.id}
                    title={p.title}
                    url={p.url}
                    body={p.note}
                    playlistId={p.playlistId}
                    followed={isFollowed(sources, p)}
                    onFollow={() => followPick(p)}
                    meta={
                      <>
                        <span>{p.provider}</span>
                        <Chip>{p.platform}</Chip>
                        <Chip
                          className={
                            p.access === 'free' ? 'border-emerald-900 text-emerald-400' : 'border-sky-900 text-sky-400'
                          }
                        >
                          {p.access}
                        </Chip>
                      </>
                    }
                  />
                ))}
              </ul>
            </section>
          )}

          <section aria-label="YouTube discovery" className="mb-5">
            <div className="mb-1 flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
                Course playlists on YouTube
              </h2>
              <Button
                onClick={() => void runSearch(active, !adhoc)}
                disabled={!hasKey || search.loading}
                title={hasKey ? `Uses ${SEARCH_QUOTA_UNITS} of your key's daily quota units` : 'Add your YouTube API key in Sources first'}
              >
                {search.loading ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="radar" className="h-3.5 w-3.5" />}
                {search.results ? 'Search again' : 'Search YouTube'}
              </Button>
            </div>
            <p className="mb-2 text-[11px] text-neutral-500">
              “{active.query}”
              {active.lastChecked && ` · last searched ${new Date(active.lastChecked).toLocaleDateString()}`}
            </p>
            {!hasKey && (
              <p className="mb-2 text-[11px] text-neutral-400">
                Searching needs your YouTube API key — add it under{' '}
                <Link to="/sources" className="text-amber-400 underline">
                  Sources → Lecture watcher
                </Link>
                . The picks above and the links below work without it.
              </p>
            )}
            {search.error && (
              <p className="mb-2 text-xs text-red-400" role="alert">
                Search failed: {search.error}
                {search.results && search.results.length > 0 && ' — earlier results below are kept'}
              </p>
            )}
            {search.results &&
              (search.results.length === 0 ? (
                <EmptyState title="No playlists found">Try broader search terms.</EmptyState>
              ) : (
                <ul className="flex flex-col gap-2">
                  {search.results.map((r) => (
                    <CourseCard
                      key={r.playlistId}
                      title={r.title}
                      url={playlistUrl(r.playlistId)}
                      body={r.description || undefined}
                      playlistId={r.playlistId}
                      followed={isFollowed(sources, { url: playlistUrl(r.playlistId), playlistId: r.playlistId })}
                      onFollow={() => followPlaylist(r)}
                      meta={
                        <>
                          <span>{r.channelTitle}</span>
                          <span className="font-mono">{r.publishedAt.slice(0, 10)}</span>
                          {r.channelId in KNOWN_CHANNELS && (
                            <Chip className="border-emerald-900 text-emerald-400">known course channel</Chip>
                          )}
                          {!!search.newSince && Date.parse(r.publishedAt) > Date.parse(search.newSince) && (
                            <Chip className="border-amber-700 text-amber-400">new</Chip>
                          )}
                        </>
                      }
                    />
                  ))}
                </ul>
              ))}
          </section>

          <section aria-label="Other catalogs" className="mb-5">
            <h2 className="mb-1 text-[11px] font-semibold tracking-wider text-neutral-400 uppercase">
              Search other catalogs
            </h2>
            <p className="mb-2 text-[11px] text-neutral-500">
              These catalogs can't be queried from inside lumen, so each link opens their own search
              for this track in a new tab.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {elsewhereLinks(active.query).map((l) => (
                <a
                  key={l.label}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-800"
                >
                  {l.label} <Icon name="external" className="h-3 w-3 text-neutral-500" />
                </a>
              ))}
            </div>
          </section>
        </>
      )}

      <p className="text-[11px] leading-relaxed text-neutral-500">
        YouTube search uses YouTube API Services with your own key, only when you click Search;
        results are shown here and not stored unless you follow one. Terms and data handling are
        described on the{' '}
        <Link to="/sources" className="text-amber-400 underline">
          Sources
        </Link>{' '}
        page.
      </p>
    </div>
  )
}
