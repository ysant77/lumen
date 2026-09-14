# Known limitations

Honest list, maintained alongside releases. "Tests pass" ≠ production-ready;
this is a personal tool hardened for one user across a few devices.

## Scope guardrails

Still excluded regardless of other feature work: quizzes, code challenges,
and any PageTrace integration.

Third-party integrations must always be (and the YouTube watcher complies):

- **optional** — lumen works fully without them;
- **explicitly user-initiated** — no background calls, nothing on by default
  (the watcher only fetches when you click "Check", embeds only load on tap);
- **upload-safe** — nothing silently uploads PDFs or notes; any transfer of
  content requires a per-action, clearly-labelled user step;
- **non-blocking** — ordinary reading, notes, progress and review never
  depend on the availability of an external service.

## Sources & watcher

- **YouTube API key is device-local** (localStorage; never synced, exported
  or logged) and only needed for "check for new lectures" — links and embeds
  work without it. A key used from a browser is visible to anyone who can use
  this device/profile: restricting it (YouTube Data API only + your app URL)
  reduces misuse, it does not make the key secret.
- **Checks paginate the full playlist** (new lectures are appended at the
  end) within a bounded request budget (~400 videos); larger playlists are
  flagged as an *incomplete check* rather than silently truncated.
- **Baselines are explicit and only ever complete.** The first check
  acknowledges the entire current playlist (an empty playlist baselines to
  empty, so its first upload is reported). A truncated (budget-limited) fetch
  never establishes or upgrades a baseline — neither via Check nor via
  "mark seen" on a truncated snapshot; such playlists stay "not baselined"
  and say so. Pre-1.3.1 partial baselines are upgraded once, silently, on the
  first complete check.
- **"Mark seen" acknowledges exactly the checked snapshot** — never a fresh
  fetch — and acknowledgements are never evicted, so acknowledged videos are
  not re-reported. Acks survive cross-device merges (union), including edits
  made elsewhere.
- **oEmbed titles are best-effort**; if YouTube declines the request the
  source keeps the title you typed (or the raw URL).
- **YouTube-derived data that IS stored**: a source's title and uploader name
  (fetched once via oEmbed when you add it) are saved on the source record
  and sync with it; they are kept only as long as the source exists and are
  deleted with it. Watcher (Data API) responses are displayed transiently and
  not retained beyond the current check; acknowledged video IDs, the baseline
  flag and check timestamps are persisted. This bookkeeping is separate from
  user-created notes/decks/progress, which source operations never touch or
  delete.
- **University course sites are plain links.** lumen currently has no
  permitted browser-side adapter for discovering or checking updates on those
  sites, and does not pretend to; they stay links unless/until real permitted
  adapters exist. deep-ml remains link-only (lowest priority).

## Sync & data

- **Notes/code conflicts are preserved, not merged.** Diverged Markdown/code
  docs keep the local version live and save the remote as a conflict copy
  (Settings → Your data → resolve). There is no line-level text merge.
- **Deck/experiment deletions can resurrect.** Cards and experiment records
  merge by union (newest-per-id). Deleting a card on device A while device B
  still has it re-adds it after sync. Custom items are the only records with
  deletion tombstones. Workaround: delete on a synced state, then sync.
- **Radar topic deletions can also resurrect** (union merge, no tombstones).
- **Whole-queue LWW.** The "This week" queue merges as one document by
  updatedAt — simultaneous edits on two devices keep only the later list.
- **No token-scoped encryption.** The GitHub token lives in localStorage;
  anyone with the unlocked device profile can read it. Scope it to the data
  repo only.
- **Clock skew caveat.** Record-level merge uses device wall clocks
  (`updatedAt`); a device with a badly wrong clock can win merges it
  shouldn't. Git history in the data repo remains the recovery path.
- **Evidence drafts are device-local.** Unfinished experiment forms persist
  per device (localStorage) and survive tab switches/navigation/reloads, but
  they do **not** sync between devices until submitted as records.

## Reader

- **Uniform page-size assumption.** Position math uses page 1's size; PDFs
  with mixed page sizes (rare for papers) will mis-estimate the current page.
- **Search is exact-substring** on the text layer: no regex, fuzziness, or
  hyphenation-aware matching; scanned/image-only PDFs yield no matches.
- **Bookmarks live inside the per-item progress record** — merged
  last-writer-wins per item, so bookmark sets edited on two devices in the
  same window may lose one side's additions.

## Code lab

- **No cancel of a running Python cell** (GitHub Pages lacks COOP/COEP, so no
  SharedArrayBuffer interrupts). "Restart runtime" is the escape hatch.
- **First run needs the network** for the Pyodide CDN download; afterwards it
  is service-worker cached.

## Testing scope

- Browser regressions run on **Chromium (Playwright) only**. WebKit/iPad
  Safari and Windows browsers are checked manually — viewport emulation in CI
  is explicitly not claimed as real-device verification.
- The offline e2e uses a tiny generated PDF; multi-hundred-page rendering
  performance is validated only informally.
- The Pyodide e2e stubs the CDN; the real runtime path is exercised manually.

## Catalog & roadmap

- Overview-sheet guidance is parsed heuristically from free-form Excel cells;
  reformatting those sheets may need parser adjustments (`parse_overview`).
- `id_registry.json` guarantees id stability from now on; ids created before
  the registry existed are grandfathered as-is.
