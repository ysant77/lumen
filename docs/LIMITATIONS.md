# Known limitations

Honest list, maintained alongside releases. "Tests pass" ≠ production-ready;
this is a personal tool hardened for one user across a few devices.

## Scope freeze (current)

Feature development is **frozen**; only reliability/data-safety fixes land.
Explicitly out of scope for now: quizzes, code challenges, additional
discovery feeds, and any PageTrace integration.

If a PageTrace (or similar) integration is ever added, it must be:

- **optional** — lumen works fully without it;
- **explicitly user-initiated** — no background calls, nothing on by default;
- **upload-safe** — it must never silently upload PDFs or notes; any transfer
  of content requires a per-action, clearly-labelled user step;
- **non-blocking** — ordinary reading, notes, progress and review must never
  depend on the availability of an external answering service.

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
