# Project Context — SC Juke (Sticky Notes / YouTube Link Bookmark)

> **Read this first.** This is a local context/guide file so future AI-assisted
> sessions can pick up exactly where we left off without re-reading everything.
> It describes the project, architecture, conventions, and known details.

## What this app is

**SC Juke** is a small, personal web app used as a bookmark/sticky-note tool
for **YouTube video URLs**. The user pastes a YouTube link, the app saves it
(with title, channel, and thumbnail), and the user can later **copy the URL**
back out to paste into other apps and games (e.g. a game's in-game jukebox).
The "Spotlight" panel cycles through random saved tracks so you can grab one
quickly by clicking the thumbnail (click = copy URL). The top-level "All songs"
home view shows the entire library with no playlist filter.

## File layout (flat, no build step)

| File           | Purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `index.html`   | Single page: sidebar (playlists + import/export) + main list   |
| `app.js`       | All logic: state, rendering, YouTube metadata, import/export   |
| `styles.css`   | Spotify-inspired dark theme, CSS custom properties in `:root`  |

- **No frameworks, no npm, no bundler, no package.json.** Plain HTML/CSS/JS.
- Run by opening `index.html` in a browser (or any static server).
- The only external dependency is a runtime `fetch` to YouTube's **oEmbed**
  endpoint for metadata (no API key).

## Data model (localStorage)

- Storage key: `sticky-notes-youtube`
- Shape (version 2):

  ```js
  {
    version: 2,
    tracks: { [videoId]: track },   // global track pool, keyed by YouTube ID
    playlists: [ { id, name, trackIds: [videoId, ...] } ],
    activePlaylistId: "..."
  }
  ```

- Track object: `{ id, url, title, channel, thumbnail }`
  - `url` is always canonical: `https://www.youtube.com/watch?v=<id>`
  - `thumbnail` from `https://i.ytimg.com/vi/<id>/mqdefault.jpg`
- A track can live in **multiple playlists**; `removeTrack` deletes it from
  ALL playlists and prunes `db.tracks` if no playlist references it anymore.
- `loadState()` contains a **v1 → v2 migration** (bare array of tracks is
  folded into a single "Main" playlist). Keep this migration if you touch it.
- Playlist names are unique (case-insensitive). Last playlist can't be deleted.

## Home view ("All songs")

- `onHome` (module-level bool, defaults to `true` on page load) selects the
  unfiltered home view. It is **not** persisted — the app always starts on Home.
- `activeId` still always points at a real playlist; while on Home, new tracks
  and text imports go into that active playlist (status messages name it).
- `viewTracks()` = `onHome ? allTracks() : activeTracks()`; `allTracks()` is
  `Object.values(db.tracks).reverse()` (newest-first, insertion order).
- The home nav item is built in `renderSidebar()` (class `.playlist-item.home`)
  with the total track count; search, list, and empty-state text all follow the
  home view.
- **Spotlight is view-independent**: it always shuffles `allTracks()` (the
  whole library), even when a playlist is active — intentional standalone
  feature. `autoShuffle`'s empty-guard also uses `allTracks()`.
- "Export this playlist" on Home routes to `exportAll()` (button `title` attr
  hints at this). Creating a playlist while on Home exits Home.

## UI motion / animation (v-next)

- **View-switch list swap** (`switchViewAnimated(swapFn)`): Home ⇄ playlist nav
  clicks stagger rows out to the right (`.exit-right`, 120ms), then the new
  rows enter from the left (`.enter-left`, 160ms). Timing: `LIST_STAGGER_MS = 14`,
  `LIST_STAGGER_CAP = 8`. **The swap fires at `maxDelay + 90ms` — deliberately
  before exit finishes** — so enter overlaps exit and the handoff feels fast.
  Guarded by `pendingListSwap` (nav clicks mid-animation are ignored).
  Search typing, add/remove re-renders stay instant (`listEnterAnimate` flag
  is only set by the swap).
- **Sidebar sliding highlight**: the active pill is a persistent absolutely
  positioned `navIndicator` node (`.nav-indicator`) re-appended by
  `renderSidebar()` and repositioned via `positionNavIndicator()` (top/height
  from the active item's offset, 200ms transition, also on window resize).
  `.playlist-item.active` no longer paints its own background; items are
  `z-index: 1` above the indicator.
- Keyframes: `rowExitRight` / `rowEnterLeft` in styles.css
  ("View-switch list animation" section).

## Add-to-playlist menu ("+ Add" button)

- Every track row has a `+ Add` button (`.add-to-btn` inside
  `.track-menu-wrap`) — on all views, not just Home.
- Click opens a custom popover (`.playlist-menu`) listing ALL playlists;
  playlists already containing the track show a green ✓.
- Clicking a menu item **toggles**: not in playlist → `pl.trackIds.push(videoId)`;
  already in it → removes from that playlist (and prunes `db.tracks` if no
  playlist references it anymore — same rule as `removeTrack`).
- Status messages: `Added "title" to "pl"` / `Removed "title" from "pl"`.
- Only one menu open at a time (`openMenuWrap` singleton). Closed by: outside
  `document` click, `Esc` key, or any `render()` (menu DOM is rebuilt anyway).
- Menus are appended into `.track-menu-wrap` (position: relative) and
  absolutely positioned below-right; z-index 30.

## Key mechanics & constants (app.js)

- `extractVideoId(url)` — regex-based; supports `watch?v=`, `youtu.be/`,
  `/embed/`, `/shorts/`, `/live/`. 11-char `[A-Za-z0-9_-]` ID match.
- `fetchVideoInfo(videoId)` — uses `https://www.youtube.com/oembed?url=...&format=json`.
  Returns title + `author_name` as channel. Fails (and track is not added)
  if the video isn't oEmbed-able (private, region-locked, embed-disabled).
- **Spotlight**: `SPOTLIGHT_INTERVAL_MS = 5000` (auto-shuffle every 5s via
  `setInterval`), `SLIDE_MS = 250` (image crossfade classes `slide-in`/`slide-out`).
  Pauses while hovered (`spotlightHovered`) or mid-transition (`spotlightSwitching`).
  Uses `hqdefault` thumbnail. Hidden when playlist is empty.
- Status messages auto-clear after 4s (`setStatus(msg, type)`; types:
  `""`, `"success"`, `"error"`).
- Clipboard: `navigator.clipboard.writeText` with a `document.execCommand("copy")`
  fallback (for non-secure contexts).
- UI helpers: `$ = id => document.getElementById(id)`; all elements cached in
  the `els` object at the top of the script (script is at end of body, no
  `DOMContentLoaded` wrapper needed).

## Import / export formats

- **Export JSON** (`exportPlaylistFile` / `exportAll`):
  ```json
  {
    "format": "sc-juke-export",
    "exported": "<ISO date>",
    "name": "Playlist name",        // single-playlist export
    "playlists": [ { "name", "tracks": [track, ...] } ],  // exportAll
    "tracks": [track, ...]
  }
  ```
  Files: `<slug>.json` or `sc-juke-library.json`.
- **Import** accepts:
  - Our JSON export (single playlist object or `{playlists:[...]}` or
    bare array of tracks),
  - A plain text file of one YouTube URL per line.
- `normalizeImportTrack()` is lenient: accepts `url` or `id`, `title`,
  `channel` or `author_name`, `thumbnail` or `thumbnail_url`, or a bare string.
- Import dedupes by videoId within the playlist; fetches oEmbed metadata
  only when a title is missing from the file.

## Style conventions

- CSS variables in `:root` of styles.css: `--bg #121212`, `--bg-elevated`,
  `--bg-hover`, `--border`, `--text`, `--text-dim`, `--accent #1db954`
  (Spotify green), `--accent-hover #1ed760`, `--danger #f15e6c`, `--radius 8px`.
- Sidebar is pure black (`#000`), 220px wide.
- **Branding**: the sidebar logo (`.logo-icon`) is an `<img>` of
  `scjtransparent.png` (30×30); the same PNG is the favicon via
  `<link rel="icon" type="image/png">` in the head. `scjfull.jpg` is the
  dark-background version, kept for reference / future dark-surface use.
- Buttons: `.btn`, `.btn-primary` (green, black text), `.btn-icon` (round ghost),
  `.copy-btn` (pill, "Copy URL" → "Copied!" for 1.5s), `.sidebar-action`.
- Track rows: 96×54 thumbnail, title (green on hover), dim channel line,
  actions on the right.
- Responsive breakpoint at 720px: sidebar hidden, content stacks vertically.
- New DOM is built with `document.createElement` (no innerHTML string
  templates for user data — titles/channels are set via `textContent`).

## Gotchas / things to keep in mind

1. **`db.tracks` is keyed by the 11-char videoId** (not `uid()`). Playlist
   `id`s use `uid()`. Don't mix these up.
2. `addTrack` uses `pl.trackIds.unshift(videoId)` — new tracks appear at the TOP.
   Import uses `.push()` — appended at the bottom. Preserve both behaviors.
3. The `spotlight` element display is toggled (`none`/`flex`) in JS based on
   whether the whole library (`allTracks()`) has tracks — it is intentionally
   independent of the active playlist.
4. `activeId` is the module-level "current playlist" variable; it's synced to
   `db.activePlaylistId` on load but only `save()` persists it (e.g. on
   playlist switch, creation, deletion).
5. There is no test suite and no linter config — validate changes by opening
   `index.html` and exercising the flow manually (add → copy → export → import).
6. The app is local-only; data lives in the browser's localStorage per origin.
   Moving to a different path/protocol with a different origin may appear to
   "lose" data (localStorage is origin-scoped).
7. `setInterval` auto-shuffle runs forever; it's guarded by `document.hidden`
   check and hover state — keep those guards if you refactor.
8. **Known limitation (mobile)**: below 720px the entire sidebar is
   `display: none`, so playlists, import/export, and "All songs" are
   unreachable on small screens. Not yet fixed — flagged for a future task.

## Typical session tasks (what this app is for)

- Adding new YouTube links to a playlist.
- Copying a saved URL to paste into another app/game.
- Organizing links into named playlists.
- Backing up (Export all → `sc-juke-library.json`) and restoring on another
  browser/machine via Import.
- Tinkering with the Spotlight shuffle behavior or the dark theme.

## Suggested workflow for changes

1. Check the section of this file that matches the change.
2. Edit the relevant file(s); keep vanilla JS, no new dependencies, no build
   tooling unless the user asks.
3. Keep the localStorage schema backward-compatible or add a migration in
   `loadState()` (bump `version` to 3 if the shape changes).
4. Manually verify in a browser: open `index.html`, add a link, shuffle,
   export, import, check the status messages.
