# GitHub sync

lumen keeps your study data in plain files and syncs them to a **private GitHub repository
you own**. No third-party backend; the app talks directly to `api.github.com` from your
browser.

## What syncs

```
progress.json        status / reading position / timestamps per item
sessions.json        focus-session log
custom.json          papers you added from Radar (your Inbox)
radar.json           your Radar topics + last-checked markers
notes/<item>.md      one Markdown file per paper
code/<item>.json     Python snippets per paper
decks/<item>.json    flashcards incl. FSRS scheduling state
```

Everything is human-readable in the repo — your notes remain useful even without lumen.
PDFs and the GitHub token are **never** synced.

## One-time setup

1. **Create a private repo**, e.g. `lumen-data` (empty is fine — no README needed).
2. **Create a fine-grained personal access token**
   GitHub → Settings → Developer settings → Personal access tokens → *Fine-grained tokens*:
   - Repository access: **Only select repositories** → `lumen-data`
   - Repository permissions: **Contents → Read and write** (nothing else)
   - Expiration: your call (you'll paste a fresh one when it expires)
3. In lumen → Settings → **GitHub sync**: enter owner, repo, branch (`main`), token → Save →
   *Test connection* → *Sync now*.
4. Repeat step 3 on each device (same repo + token, or one token per device if you prefer
   revocability).

## How it works

- Each sync is one **pull** (compare remote tree against last-known blob SHAs, fetch what
  changed) and at most one **push** (all locally-edited files in a single batch commit via
  the Git Data API — blobs → tree → commit → ref).
- Auto-sync runs on launch and ~45 s after your last edit (toggleable); manual **Sync now**
  is always available in the header.
- If the branch moved between pull and push (another device racing), lumen re-reads the head
  and retries the push once on top of it.

## Merge policy (single user, multiple devices)

Structured docs merge **per record**, so independent changes from two devices both survive:

| Doc | Merge unit | Rule |
|---|---|---|
| `progress.json` | per item id | newest `updatedAt` wins per item; unique items union |
| `sessions.json` | per session id | union (capped at 2000) |
| `decks/*.json`, `experiments/*.json` | per record id | newest `updatedAt` wins per record; union |
| `custom.json` | per item id | union + deletion tombstones (removals survive sync) |
| `radar.json` | per topic id | newest topic wins; `lastChecked` takes the max |
| `queue.json` | whole doc | last writer wins by `updatedAt` (it's one small ordered list) |
| `notes/*.md`, `code/*.json` | — | **cannot be merged safely**: local stays live, the remote version is saved as `…​.conflict-<timestamp>` and surfaced in Settings (promote / download / discard). Nothing is silently overwritten. |

Additional guarantees:

- **Exact-revision clean-marking.** After a push, a file is marked "synced" only if it is
  still byte-for-byte the revision that was uploaded; anything you typed while the push was
  in flight stays pending for the next sync.
- **Retry on reconnect.** Pending changes sync automatically when the browser regains
  connectivity (plus on launch, and ~45 s after edits if auto-sync is enabled).
- **Local save ≠ synced.** The header chip shows `N pending` (amber) until the data repo has
  confirmed the upload, then `Synced` (green).

Full history remains in the repo — any state is one `git log` away.

## Security notes

- The token is stored in `localStorage` on the device, sent only to `api.github.com` over
  HTTPS, and scoped to a single repo's contents — worst-case blast radius is that repo.
- Revoke tokens anytime in GitHub settings; lumen degrades gracefully to local-only.
