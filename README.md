# lumen

**A focused reading room for AI papers.** Read PDFs, track progress, take math-heavy notes,
run Python experiments and rehearse formulas with spaced repetition — in one local-first PWA
that works on iPad, macOS, Windows and Linux.

> Built around a personal roadmap of 164 AI resources (LLM systems, computer vision / SAR /
> Earth observation, regulated AI, books & courses), but the catalog is just a JSON file —
> regenerate it from your own reading list and lumen becomes *your* reading room.

## Features

- **Library & progress** — papers grouped by roadmap phase with priorities, difficulty,
  per-paper status (`reading`, `implementing`, `done`, …), reading position and progress bars.
- **PDF reader** — pdf.js with virtualized rendering, text selection, zoom/fit-width, and
  per-paper resume. PDFs are imported once into browser storage (OPFS) — no server, fully offline.
- **Notes** — Markdown editor (CodeMirror) with live KaTeX preview; a note template per paper
  seeds key-ideas / questions / exercise-log sections.
- **Code lab** — per-paper Python scratchpads executed **in the browser** via Pyodide
  (numpy preloaded, matplotlib on demand, figures rendered inline). No kernel, no setup.
- **Math rehearsal** — flashcards with Markdown + LaTeX on both sides, scheduled by
  [FSRS](https://github.com/open-spaced-repetition/ts-fsrs); global review queue with
  keyboard grading and interval previews. Starter decks included for core papers.
- **Focus timer** — pomodoro-style sessions attached to the paper you're reading, logged and
  summarized on the dashboard (streak + 12-week activity heatmap).
- **Radar** — a discovery feed of the latest papers per topic (via OpenAlex), pre-tuned to the
  roadmap's gap areas (multimodal LLMs, retrieval, agents/test-time compute, EO/SAR foundation
  models…). One tap adds a paper to your Inbox with the arXiv PDF fetched straight into local
  storage — it then behaves like any catalog paper (notes, code, cards, progress).
- **GitHub sync** — notes, progress, decks, code and sessions serialize to plain
  Markdown/JSON files and sync to a **private GitHub repo you own** via a fine-grained token.
  Batch commits through the Git Data API; conflict policy: per-file last-writer-wins
  (dirty local edits always survive). Your token never leaves the device.
- **PWA** — installable, offline-capable (service worker precaches the app; Pyodide is
  runtime-cached after first use).

## Privacy model

| Data | Where it lives |
|---|---|
| App code | Public (this repo, GitHub Pages) |
| Paper PDFs | Your device only (OPFS) — never uploaded |
| Notes / progress / decks | Your device + *your* private data repo |
| GitHub token | `localStorage` on your device only |

## Quick start

```bash
npm ci
npm run dev        # local dev
npm run build      # production build (dist/)
npm test           # vitest
```

Deployment is automatic: push to `main` → GitHub Actions builds and publishes to Pages.

### First-run setup (any device)

1. Open the app → **Settings**.
2. **PDF library**: import your papers folder (zip recommended on iPad). Files are matched by
   name, e.g. `01_Transformer_2017.pdf`.
3. **GitHub sync**: create a private data repo + fine-grained PAT (Contents: read/write on
   that repo only), paste both — see [docs/SYNC.md](docs/SYNC.md).
4. Install to home screen / dock for the standalone experience.

## Acquire the paper library on any machine

Every open-access PDF in the catalog can be re-downloaded from its canonical source with one
command (resumable; commercial books are skipped automatically):

```bash
pip install requests
python scripts/acquire_pdfs.py --out AI_papers --zip   # --skip-books for papers only
```

Then import the resulting folder/zip in the app (Settings → PDF library). Individual arXiv
papers can also be fetched per-paper from inside the reader ("Fetch from arXiv").

## Bring your own catalog

`src/data/catalog.json` is generated from four Excel roadmap workbooks by
[`scripts/build_catalog.py`](scripts/build_catalog.py):

```bash
python scripts/build_catalog.py /path/to/AI_papers
```

Any catalog with the same shape works — collections → items with `id`, `phase`, `title`,
`priority`, optional `pdfFile` (see `src/types.ts`).

## Documentation

- [docs/SETUP.md](docs/SETUP.md) — device setup, PDF import paths, installing as an app
- [docs/SYNC.md](docs/SYNC.md) — data repo, token creation, sync semantics & conflict policy
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, storage layout, design decisions

## Stack

React 18 · TypeScript · Vite · Tailwind CSS 4 · zustand · pdf.js · CodeMirror 6 ·
Pyodide · ts-fsrs · KaTeX · react-markdown · idb (IndexedDB) · fflate · vite-plugin-pwa

## License

[MIT](LICENSE)
