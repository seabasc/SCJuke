# Project Context — SC Juke

> **Read this first.** This is the canonical handoff document for the project.
> It is written for future AI-assisted sessions (so you can pick up exactly
> where things left off without re-reading everything) and for the user.
> It covers what the app is, how it is built, the conventions to preserve,
> and the known gotchas. **Keep this file updated whenever the project
> changes** — it is the first thing a future session should read.

## ⚠️ Folder name warning — read before anything else

The project folder is literally named `sticky notes`, but that is a **leftover
mistake**: the user forgot to rename the folder when the project was created.
**This project (SC Juke) has nothing to do with the user's other
"sticky notes" project.** Do not import patterns, terminology, or assumptions
from any other sticky-notes codebase. The only "sticky" artifact left in this
project is the localStorage key (`sticky-notes-youtube`) — legacy naming only,
unrelated to that other app. The GitHub repo is `seabasc/SCJuke`.

## What this app is

**SC Juke** is a small, personal, local-only web app for bookmarking
**YouTube video URLs**. Typical usage:

1. Paste a YouTube link into the top input → **Add** (or press Enter).
2. The app fetches title + channel via oEmbed (no API key), derives the
   thumbnail from the video ID, and stores the track.
3. Tracks are organized into **named playlists**; a track can belong to
   several playlists at once.
4. **"All songs"** (the Home view) is always present and shows the whole
   library with no playlist filter — so the app never ends up with zero
   views, even if every playlist is deleted.
5. **Copy URL** retrieves the canonical link to paste into another app or
   game (e.g. an in-game jukebox).
6. The **Spotlight** panel auto-cycles random tracks from the whole library;
   clicking the thumbnail copies that URL.
7. Destructive actions (playlist delete, song removal from all playlists)
   are **undoable** — via the toast's Undo button or `Ctrl+Z` / `Cmd+Z`.

No accounts, no backend, no server: all data lives in `localStorage`.

## UI preferences (important — preserve strictly)

- **Never use native browser UI.** The user dislikes native browser
  popups/widgets:
  - No `alert()` / `confirm()` / `prompt()`.
  - No native `<select>` dropdowns.
  - Nothing OS-chrome-looking.

  Always use the app's own styled equivalents (all already implemented —
  reuse them, don't reinvent):
  - **Confirmations** (e.g. deleting a playlist) → the custom **dialog**
    (`.dialog-overlay` / `.dialog` in index.html; `askDialog()` /
    `askConfirm()` / `askName()` in app.js). Destructive OK buttons get
    `.btn-danger` (red).
  - **Text entry** (e.g. a new playlist name) → the same dialog in input
    mode (`askName()`), using the styled `.dialog-input`. Enter confirms;
    Esc / backdrop click / Cancel dismisses (resolves `null`).
  - **Menus / dropdowns** → the custom `.playlist-menu` popover pattern
    (a `.track-menu-wrap` container whose `.open` class toggles visibility).
  - The one unavoidable exception: the **OS file picker** for import —
    browser-required and not replaceable in JS. It is hidden behind the
    styled "Import..." button (`#importBtn` clicks hidden `#importInput`).
- Any new interactive UI must speak the same visual language: the dark-theme
  CSS variables in `:root`, the `.btn` family, custom popovers — never native
  controls.

## File layout (flat, no build step)

| File                 | Purpose                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------ |
| `index.html`         | Single page: sidebar (nav + import/export) + track list + Spotlight + custom dialog + undo toast |
| `app.js`             | All logic: state, rendering, YouTube metadata, import/export, undo, animations (~1125 lines)     |
| `styles.css`         | Spotify-inspired dark theme; all theme values are CSS custom properties in `:root`               |
| `CONTEXT.md`         | This file                                                                                          |
| `.gitignore`         | Ignores OS junk (`Thumbs.db`, `Desktop.ini`, `.DS_Store`) and editor dirs (`.vscode/`, `.idea/`) |
| `scjtransparent.png` | App logo on transparent background — sidebar logo (`.logo-icon`, 30×30) and favicon               |
| `scjfull.jpg`        | Same logo on a dark background — kept for reference / future dark-surface use                      |

- **No frameworks, no npm, no bundler, no package.json.** Plain HTML/CSS/JS;
  `app.js` is a plain `<script src="app.js">` (no ES modules, no build).
- **Run by opening `index.html` in a browser** (or any static server).
- No test suite, no linter config — verify changes by opening `index.html`
  and exercising the flow by hand (add → copy → export → import → delete →
  undo).
- The only runtime external dependency: a `fetch` to YouTube's **oEmbed**
  endpoint (see "YouTube metadata" below).
- Git: `main` branch, remote `https://github.com/seabasc/SCJuke.git`.
  Established workflow: small descriptive commits, pushed after each change.

## Data model (localStorage)

- Storage key: **`sticky-notes-youtube`** — a legacy name from before the app
  was branded SC Juke. Unrelated to the user's sticky notes project (see
  warning above). **Do not rename this key** without a migration in
  `loadState()` that reads the old key first — otherwise the user's library
  appears to be lost.
- Shape (version 2):

  ```js
  {
    version: 2,
    tracks: { [videoId]: track },   // global track pool, keyed by YouTube video ID
    playlists: [ { id, name, trackIds: [videoId, ...] } ],
    activePlaylistId: "..."         // null is legal = zero playlists exist
  }
  ```

- Track object: `{ id, url, title, channel, thumbnail }`
  - `id` is the 11-character YouTube **videoId** (NOT `uid()`)
  - `url` is always canonical: `https://www.youtube.com/watch?v=<id>`
  - `thumbnail` is `https://i.ytimg.com/vi/<id>/mqdefault.jpg`
  - oEmbed only returns title + author, so the thumbnail is *constructed*,
    not fetched.
- **Playlists reference tracks by videoId** — a track can live in several
  playlists. `removeTrack()` removes the videoId from **ALL** playlists and
  prunes `db.tracks` if no playlist still references it.
- `activePlaylistId` = the playlist that receives new tracks / imports. It
  may be `null` (a legal state when zero playlists exist; the Home view is
  still available).
- `freshState()` returns **zero playlists** — "Main" is NOT seeded.
  `ensureActivePlaylist()` auto-creates a "Main" playlist only when a user
  action (add, import, text import) needs a target playlist.
- **Migrations live in `loadState()`**: v1 (bare array of track objects) →
  v2 (single "Main" playlist). If the shape changes, add a migration there
  and bump `version` to 3. Never break old data silently.

## How the app works (key flows)

### Views & navigation
- `onHome` (bool): true = "All songs" (Home) library view; false = the active
  playlist. `activeId` always tracks the underlying playlist (the one that
  receives new tracks/imports) even while on Home.
- `viewTracks()` = `allTracks()` on Home, else the active playlist's tracks.
  `allTracks()` is `Object.values(db.tracks).reverse()` — **newest first**
  (insertion order is oldest-first).
- Sidebar nav: the Home row first (`.playlist-item.home`, no delete button,
  shows the total count), then one row per playlist (name + count). Every
  playlist row renders a **✕ delete button always** — the last playlist is
  deletable too, because Home is always the fallback view.
- Switching views (Home ⇄ playlist) goes through
  `switchViewAnimated(swapFn)` — see "List-swap animation". Add/remove/
  search re-render without the animation.
- **Sliding nav highlight**: the active pill is a persistent absolutely
  positioned `navIndicator` node (`.nav-indicator`) re-appended by
  `renderSidebar()` and repositioned by `positionNavIndicator()` (top/height
  from the active item's offset; CSS transitions `top`/`height`; also
  repositioned on window resize). `.playlist-item.active` no longer paints
  its own background — the indicator is the visual.
- `render()` = close both popovers + set `#playlistName` ("All songs" or the
  playlist name) + set the export button tooltip + `renderSidebar()` +
  `renderList()` + `renderSpotlight(false)`. Rely on it closing menus.

### Adding a track (`addTrack`)
- `extractVideoId()` accepts `watch?v=`, `youtu.be/`, `embed/`, `shorts/`,
  `live/`; anything else → null → error status.
- `ensureActivePlaylist()` runs first (auto-creates "Main" if none exist).
- Duplicate in the target playlist → error status, no action.
- Track already known (in `db.tracks`) → no fetch, cache is reused.
- New tracks go to the **TOP** of the playlist: `pl.trackIds.unshift(videoId)`.

### Removing a track (`removeTrack`)
- Removes the videoId from **every** playlist; prunes `db.tracks` if nothing
  references it anymore; **registers an undo entry** (see "Undo" below).

### Playlists
- **Create**: sidebar "+ New playlist" → `askName()` → duplicate names
  rejected (case-insensitive) → appended → switches to the new playlist.
- **Delete**: row ✕ → `askConfirm()` (states that songs in other playlists
  are kept) → filter out. If it was active: fall back to the first remaining
  playlist, else `activeId = null` + `onHome = true`. **Registers an undo
  entry.**
- **Add/remove from one specific playlist**: each track row's "+ Add" button
  opens the `togglePlaylistMenu()` popover listing every playlist (✓ check
  when the track is already in it). Clicking toggles: missing →
  `pl.trackIds.push(videoId)` (appends at the BOTTOM); present → removed from
  **that playlist only** (never touches the other playlists; prunes
  `db.tracks` only if the last reference goes).
- Create / single-playlist toggle / add do NOT register undo — only true
  deletions (playlist delete, remove-from-everywhere) do.

### Status messages
- `setStatus(message, type)` — the app-wide feedback channel (`#status`,
  `role="status"` / `aria-live="polite"`). `type` = `""` | `"success"` |
  `"error"` (appended as a class). ALL messages auto-clear after **4000 ms**
  (one shared timer).

## Undo (Ctrl+Z + toast) — important feature, preserve carefully

Destructive actions register undo entries so the user can restore them:

- **Stack**: module-level `undoStack` in app.js. Cap `UNDO_STACK_CAP = 10`
  (oldest entry is dropped). Each entry is `{ label, restore() }`.
- **API**:
  - `pushUndo(entry)` — push, trim to cap, refresh the toast.
  - `syncUndoToast()` — mirrors the **newest** entry into the toast;
    auto-hides after `UNDO_TOAST_MS` (6000 ms). **Dismissing the toast does
    NOT clear the stack** — `Ctrl+Z` still has history.
  - `performUndo()` — pops the newest entry, runs `restore()`, then
    `save()` → `render()` → `syncUndoToast()`. Empty stack → status
    "Nothing to undo."
- **Keyboard**: a global `keydown` listener catches `Ctrl+Z` / `Cmd+Z`
  (no shift/alt). It is **deliberately skipped** when focus is in an
  `INPUT`, `TEXTAREA`, or contenteditable element — native text undo wins
  there (e.g. the search box).
- **UI**: `.undo-toast` in index.html (fixed, bottom-center):
  `#undoToastMsg`, `#undoToastBtn` (green Undo), `#undoToastClose` (×,
  dismiss-only).
- **Current integrations** (what `restore()` must faithfully do):
  - `deletePlaylist()`: snapshots `{ id, name, trackIds }`, its array index,
    `prevActiveId`, and `prevOnHome`. Restore re-inserts a fresh copy at the
    clamped original index and restores the previous `activeId` / `onHome`.
  - `removeTrack()`: snapshots the track object plus each playlist's
    `{ plId, index }` membership. Restore re-adds a shallow copy of the track
    to `db.tracks` and splices the videoId back into each playlist at its
    original index (clamped to the current length; playlists that no longer
    exist are skipped).
- **Known, accepted edge cases** (be careful if extending):
  - If the user *re-adds* the same track after removing it, undo inserts a
    second copy (no dedupe on restore).
  - Playlist undo restores the previous active view unconditionally, even if
    the user has since switched elsewhere.
- Only true deletions register undo — see the "Playlists" section above.

## Spotlight (right-hand panel)

- Standalone feature: it **always shuffles the whole library**
  (`allTracks()`), independent of the active view/playlist. Do NOT scope it
  to the active playlist.
- Auto-reshuffles every **5000 ms** (`SPOTLIGHT_INTERVAL_MS`) via the
  `setInterval` in the events section. Guards (keep all of them if
  refactoring): `document.hidden` (tab not visible), `spotlightHovered`
  (mouse over the panel), `spotlightSwitching` (mid-swap), and a non-empty
  pool.
- Slide transition: `slide-out` class (250 ms) → swap the data → `slide-in`
  (250 ms). Handled by `setSpotlightTrack(track, animate)`; instant path
  when not animating.
- `pickRandomTrack(pool, excludeId)` avoids repeating the current track.
- Thumbnail click → copies the URL (async Clipboard API with a
  `document.execCommand("copy")` fallback) and flashes "Copied!" on the hint
  line for 1.5 s.
- The panel is `display: none` when the library is empty, `flex` otherwise
  (JS toggles it, not CSS).
- It uses the `hqdefault` thumbnail variant (`mqdefault` is string-replaced).

## List-swap animation (view switches only) — preserve the timing

`switchViewAnimated(swapFn)` is used for Home ⇄ playlist navigation:

- Old rows get `.exit-right` plus per-row `animationDelay` =
  `min(i, LIST_STAGGER_CAP) * LIST_STAGGER_MS` (currently **14 ms** stagger,
  **8**-row cap).
- The actual swap runs at `maxDelay + 90 ms` — the exit rows are ~75 % gone
  when enter begins, so the handoff reads as one continuous fast motion.
- `pendingListSwap` guard: only one swap may be in flight; nav clicks during
  a swap are ignored (rapid double-clicks don't double-swap).
- After the swap, `listEnterAnimate = true` → `renderList()` applies
  `.enter-left` plus the same stagger to the new rows.
- CSS (styles.css): `@keyframes rowExitRight` (slide to +56 px, fade,
  0.12 s, `forwards`) and `@keyframes rowEnterLeft` (from −56 px, 0.16 s,
  `both`).
- Add / remove / search re-render the list WITHOUT this animation — only view
  switches use it.

## YouTube metadata (oEmbed)

- `fetchVideoInfo(videoId)` → `fetch`
  `https://www.youtube.com/oembed?url=<canonical watch URL>&format=json`.
  No API key.
- oEmbed returns only `title` + `author_name` → the track's `thumbnail` is
  constructed from the video ID (`https://i.ytimg.com/vi/<id>/mqdefault.jpg`).
- It is called ONLY when a track is unknown: first `addTrack`, or an import
  entry missing its title. Known tracks are always reused from `db.tracks`
  (no re-fetch).
- Failures (non-2xx, network) surface as a status message; import skips
  unresolvable entries.

## Export

Three JSON download paths, all via `triggerDownload()` (Blob + object URL +
anchor click):

1. **"Export this playlist"** (`#exportBtn`) → `exportPlaylistFile(pl)`:
   - In a playlist view: exports that playlist.
   - **On Home ("All songs"): it exports the FULL library instead** (same
     result as option 2) — the button's tooltip reflects this and is set in
     `render()`.
   - File: `<slug-of-name>.json` (e.g. `my-mix.json`).
   - Shape:
     `{ "format": "sc-juke-export", "exported": "<ISO date>", "name": "<playlist>", "tracks": [ ... ] }`
2. **"Export all ▾" → "With playlists"** — `#exportAllBtn` opens a custom
   hover menu (`#exportMenuWrap` → `.export-menu`; closes on outside click or
   Esc) → `exportAll()`:
   - File: `sc-juke-library.json`
   - Shape:
     `{ "format": "sc-juke-export", "exported": "<ISO date>", "playlists": [ { "name": "...", "tracks": [ ... ] } ] }`
3. **"Export all ▾" → "All songs"** → `exportFlat()`:
   - File: `sc-juke-all-songs.json`
   - Shape: a **bare JSON array** of every track in `db.tracks` (insertion
     order = oldest first), each `{ id, url, title, channel, thumbnail }`.
   - Empty library → error status, no download.

Exported track objects are the full stored track objects.

## Import

`#importBtn` → hidden file input (`#importInput`, accepts `.json,.txt,.js`).
The file is read as text and sniffed by `importText()`:

- **JSON** (first char `{` or `[`) → `importJSON(data)`:
  - Bare array → one pseudo-item named after the active playlist (or
    "Imported songs" if none).
  - `{ playlists: [...] }` → one item per entry.
  - `{ name, tracks }` (our single-playlist export) → `[data]`.
  - Per item: normalize each track with `normalizeImportTrack()`; a
    same-named playlist (case-insensitive) is **merged into**, otherwise a
    new one is created. Status reports "Imported N songs — new playlist(s): …".
- **Plain text** → `importTextUrls()`: one URL per line (each line passed
  through `extractVideoId`, duplicates in the file ignored); imported into
  `ensureActivePlaylist()`.

- `normalizeImportTrack()` is deliberately lenient — accepts `url` or `id`,
  `title`, `channel` or `author_name`, `thumbnail` or `thumbnail_url`, or a
  bare string (treated as a URL). Returns null for unresolvable entries
  (dropped silently).
- `importTracksInto(pl, importTracks)`: dedupes by videoId within the target
  playlist; reuses cached `db.tracks` entries; fetches oEmbed only when a
  title is missing; **appends** at the bottom (`.push()`).
- **Ordering rule to preserve**: `addTrack` unshifts (newest at TOP of the
  playlist); imports append (BOTTOM). Don't "fix" one to match the other.

## Style conventions

- All theme values are CSS variables in `:root` of styles.css:
  `--bg #121212`, `--bg-elevated #181818`, `--bg-hover #282828`,
  `--border #2a2a2a`, `--text #ffffff`, `--text-dim #a7a7a7`,
  `--accent #1db954` (Spotify green), `--accent-hover #1ed760`,
  `--danger #f15e6c`, `--radius 8px`.
- Font stack: "Segoe UI", system-ui, … Font smoothing antialiased.
- Sidebar: pure black (`#000`), 220 px wide. Logo = `scjtransparent.png`
  at 30×30 (`.logo-icon`), also the favicon. `scjfull.jpg` kept for reference.
- Button family: `.btn`, `.btn-primary` (green bg, black text), `.btn-danger`
  (red — destructive OK), `.btn-ghost`, `.btn-icon` (round ghost, used for ✕
  deletes — 28 px square so `border-radius: 50%` is a true circle),
  `.copy-btn` (pill; "Copy URL" → "Copied!" for 1.5 s), `.sidebar-action`.
- Track rows: 96×54 thumbnail (lazy-loaded), title (turns green on hover),
  dim channel line, actions on the right (＋ Add, Copy URL, ✕ remove).
- **Responsive**: at ≤720 px the sidebar is `display: none` and content
  stacks. **Known limitation**: playlists, import/export, and "All songs"
  are then unreachable on small screens — not yet fixed, flagged as a future
  task.
- New DOM is built with `document.createElement`; user-supplied strings are
  set via `textContent` (no innerHTML string templates with user data).
- Event listeners are wired in one "Events" block near the bottom of app.js
  (plus the menu/dialog/undo blocks); keep that organization when adding
  features.

## Gotchas / things to keep in mind

1. **The folder is named `sticky notes` by accident** — it has nothing to do
   with the user's other sticky notes project. Same for the legacy
   localStorage key `sticky-notes-youtube`. Neither is a hint about what the
   app is.
2. `db.tracks` is keyed by the 11-char **videoId** (not `uid()`). Playlist
   `id`s use `uid()`. Don't mix these up.
3. `addTrack` unshifts; imports push. Preserve both orderings.
4. The Spotlight is library-wide, never playlist-scoped.
5. `activeId` is the module-level "current playlist"; synced from
   `db.activePlaylistId` on load and persisted by `save()` (playlist switch,
   create, delete, and undo all call it).
6. `render()` closes both popovers (add-to-playlist menu + export menu) —
   don't assume menus survive a re-render.
7. The Spotlight `setInterval` runs forever — keep its
   `document.hidden` / hover / switching guards.
8. Mobile ≤720 px: sidebar hidden (see "known limitation").
9. Undo restores are index-based with **no dedupe**; restore is best-effort
   for playlists that no longer exist (see the edge cases in "Undo").
10. `switchViewAnimated` ignores nav clicks while a swap is in flight
    (`pendingListSwap`) — intentional.
11. Data is per-origin localStorage: changing host/path/protocol makes the
    library appear to "disappear" (different origin).

## Typical session tasks (what this app is for)

- Adding new YouTube links to a playlist.
- Copying saved URLs out to paste into another app/game.
- Organizing links into named playlists (create, add/remove members, delete
  with undo).
- Backing up (Export all → "With playlists" = `sc-juke-library.json`) and
  restoring on another browser/machine via Import.
- Tinkering with the Spotlight shuffle or the dark theme.

## Suggested workflow for changes

1. Check the section of THIS file that matches the change, then read the
   relevant code.
2. Keep vanilla JS, no new dependencies, no build tooling unless the user
   asks.
3. Keep the "no native UI" rule — use the custom dialog/menu patterns.
4. Keep the localStorage schema backward-compatible, or add a migration in
   `loadState()` (bump `version` to 3 if the shape changes).
5. Verify manually: open `index.html`, add a link, shuffle the Spotlight,
   export → import round-trip, delete + undo (both the toast button and
   Ctrl+Z), check status messages and the nav highlight.
6. Commit + push to `origin/main` with a small, descriptive message
   (established workflow).

## Current state (handoff)

- Everything described above is implemented and working; working tree is
  clean at commit `42166f0` (undo feature), pushed to `origin/main`.
- Recent history (newest first): undo (Ctrl+Z + toast) → circular song-row
  delete button → non-overlapping playlist delete button → always-rendered
  delete button → fresh-start with zero playlists → deletable last playlist
  (lands on Home) → custom dialog replacing native prompt/confirm.
- Known open items (not yet requested):
  - Mobile: sidebar hidden below 720 px — playlists/import/export/All songs
    unreachable on small screens.
  - (Optional, if ever asked) undo-dedupe and smarter active-view restore.





