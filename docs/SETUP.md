# Device setup

lumen is a static PWA — there is nothing to install server-side. Open the deployed URL,
then set up each device once.

## 1. Install as an app

- **iPad / iPhone (Safari)**: Share → *Add to Home Screen*. Opens standalone, works offline.
- **macOS (Safari)**: File → *Add to Dock*. (Chrome/Edge: install icon in the address bar.)
- **Windows / Linux (Chrome/Edge)**: address-bar install icon → *Install lumen*.

## 2. Import your PDF library

Settings → **PDF library**. PDFs are stored in the browser's Origin-Private File System
(OPFS): private to the app, never uploaded, available offline. Files are matched to the
catalog **by filename** (e.g. `01_Transformer_2017.pdf`), so import the folder produced by
the roadmap library as-is.

| Method | Best for | Notes |
|---|---|---|
| **Import zip** | iPad, or everything at once | Zip the `AI_papers` folder; streamed, so large zips are fine |
| **Import folder** | macOS / Windows browsers | Uses the directory picker |
| **Import files** | topping up a few PDFs | Multi-select |

Books are optional — skip `04_Books_and_Course_Materials` for a lighter footprint (~350 MB
for the 141 papers alone, ~900 MB with books).

Tap **Persist storage** afterwards: it asks the browser to exempt lumen's storage from
automatic eviction (important on iPadOS if the device runs low on space).

> OPFS quota: Chromium grants up to ~60% of free disk; Safari is more conservative but
> comfortably fits the full library. The Settings page shows live usage/quota.

## 3. Connect sync

See [SYNC.md](SYNC.md). Do this on every device with the same repo + token, and your notes,
progress, decks and sessions follow you.

## 4. Python code lab

Nothing to set up. The first **Run** downloads the Pyodide runtime (~15 MB) from the CDN;
the service worker caches it, so subsequent runs — including offline — are instant.
`numpy` is preloaded; importing `matplotlib` fetches it automatically; other pure-Python
wheels load on import when online.

## Keyboard shortcuts

| Context | Keys | Action |
|---|---|---|
| Code lab | `Cmd/Ctrl + Enter` | Run snippet |
| Review | `Space` / `Enter` | Reveal answer |
| Review | `1` `2` `3` `4` | Grade Again / Hard / Good / Easy |
