# Architecture

Local-first PWA. Three storage planes with different lifecycles:

```
┌─────────────────────────────── browser ────────────────────────────────┐
│                                                                        │
│  OPFS  pdfs/<basename>.pdf          ← imported once per device (large) │
│  IndexedDB  docs{path,content,dirty,remoteSha}  ← user data (small)    │
│  localStorage  sync config + token                                     │
│                                                                        │
└──────────────┬─────────────────────────────────────────────────────────┘
               │ Git Data API (batch commits)
               ▼
   private GitHub repo (notes/, decks/, code/, progress.json, sessions.json)
```

## Modules

| Path | Responsibility |
|---|---|
| `src/data/catalog.json` | Generated catalog: 4 collections → 164 items (metadata only) |
| `scripts/build_catalog.py` | Regenerates the catalog from the roadmap workbooks |
| `src/lib/db.ts` | IndexedDB (`idb`): `docs` store — the unit of sync |
| `src/lib/opfs.ts` + `opfs.worker.ts` | PDF storage; writes via worker sync-access handles (Safari-safe) |
| `src/lib/github.ts` | Minimal Git Data API client (ref → tree → blobs; batch commit) |
| `src/lib/sync.ts` | Pull/merge/push engine + conflict policy (see SYNC.md) |
| `src/lib/srs.ts` | ts-fsrs wrapper; serialized scheduling state on each card |
| `src/lib/pyodide.worker.ts` + `pyodide.ts` | Python runner in a module worker; stdout/err streaming, matplotlib figure capture |
| `src/store/data.ts` | zustand store: parsed domain state ⇄ doc serialization, autosync debounce |
| `src/store/timer.ts` | Focus timer state machine + session logging |
| `src/components/PdfReader.tsx` | pdf.js viewer: virtualized pages, text layer, resume position |
| `src/pages/*` | Dashboard / Library / Workspace / Review / Settings |

## Key decisions

- **Files as the sync unit.** Every feature serializes to a Markdown/JSON doc keyed by path.
  Sync, backup/export, and the data repo all reuse the same representation; adding a feature
  means adding a path pattern.
- **OPFS writes in a worker.** `createSyncAccessHandle()` works in workers across
  Safari/Chrome/Firefox, avoiding the patchier main-thread `createWritable()` on iPadOS.
  Reads use plain `getFile()` on the main thread.
- **Pyodide in a worker, loaded from CDN.** Keeps the ~15 MB runtime out of the bundle and
  off the UI thread; the service worker runtime-caches it (CacheFirst) for offline use.
  No SharedArrayBuffer (GH Pages lacks COOP/COEP), so cancellation = worker restart.
- **HashRouter.** GitHub Pages serves a static tree; hash routing survives deep-link
  refreshes without a 404 fallback hack.
- **Uniform page-size assumption in the reader.** Papers are uniform; sizes come from page 1,
  so we never touch all pages up front. Virtualization renders ±600 px around the viewport.
- **catalog.json is committed, workbooks are not.** The public repo contains only metadata
  (titles, links, phases); the private workbooks and PDFs stay local.

## Testing & CI

- `vitest` unit tests: sync engine (mocked GitHub), FSRS wrapper round-trips, catalog
  integrity (unique ids/basenames).
- CI (GitHub Actions): eslint → tsc → vitest → build, on PRs and main.
- Deploy: `deploy.yml` builds and publishes `dist/` to GitHub Pages on every push to main.
