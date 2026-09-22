const STORAGE_KEY = "sticky-notes-youtube";

const $ = (id) => document.getElementById(id);

const els = {
  trackList: $("trackList"),
  urlInput: $("urlInput"),
  addBtn: $("addBtn"),
  searchInput: $("searchInput"),
  status: $("status"),
  emptyState: $("emptyState"),
  playlistName: $("playlistName"),
  playlistNav: $("playlistNav"),
  trackCount: $("trackCount"),
  newPlaylistBtn: $("newPlaylistBtn"),
  exportBtn: $("exportBtn"),
  exportAllBtn: $("exportAllBtn"),
  exportMenuWrap: $("exportMenuWrap"),
  dialog: $("dialog"),
  dialogTitle: $("dialogTitle"),
  dialogMessage: $("dialogMessage"),
  dialogInput: $("dialogInput"),
  dialogOk: $("dialogOk"),
  dialogCancel: $("dialogCancel"),
  importBtn: $("importBtn"),
  importInput: $("importInput"),
  spotlight: $("spotlight"),
  spotlightImg: $("spotlightImg"),
  spotlightHint: $("spotlightHint"),
  spotlightTitle: $("spotlightTitle"),
  spotlightChannel: $("spotlightChannel"),
  spotlightThumb: $("spotlightThumb"),
  shuffleBtn: $("shuffleBtn"),
};

/* ---------- State ---------- */

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function makePlaylist(name) {
  return { id: uid(), name, trackIds: [] };
}

function freshState() {
  const pl = makePlaylist("Main");
  return { version: 2, tracks: {}, playlists: [pl], activePlaylistId: pl.id };
}

function loadState() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    raw = null;
  }
  if (!raw) return freshState();

  // v1 migration: bare array of tracks -> one "Main" playlist.
  if (Array.isArray(raw)) {
    const db = freshState();
    const pl = db.playlists[0];
    for (const t of raw) {
      if (t && t.id) {
        db.tracks[t.id] = t;
        pl.trackIds.push(t.id);
      }
    }
    return db;
  }

  if (raw && raw.version === 2 && Array.isArray(raw.playlists)) {
    if (!raw.activePlaylistId || !raw.playlists.some((p) => p.id === raw.activePlaylistId)) {
      raw.activePlaylistId = raw.playlists.length ? raw.playlists[0].id : null;
    }
    return raw;
  }

  return freshState();
}

let db = loadState();
let activeId = db.activePlaylistId;

/* Home ("All songs") view: true = unfiltered library view, false = a playlist.
   activeId still tracks the playlist that receives new tracks/imports. */
let onHome = true;

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

function activePlaylist() {
  return db.playlists.find((p) => p.id === activeId);
}

function activeTracks() {
  const pl = activePlaylist();
  return pl ? pl.trackIds.map((id) => db.tracks[id]).filter(Boolean) : [];
}

/* Playlist that receives new tracks / imports. If the user has deleted
   every playlist, auto-create "Main" so adding/importing keeps working —
   Home ("All songs") is the library view and always exists. */
function ensureActivePlaylist() {
  let pl = activePlaylist();
  if (!pl) {
    pl = makePlaylist("Main");
    db.playlists.push(pl);
    activeId = pl.id;
  }
  return pl;
}

function allTracks() {
  // Newest first: db.tracks insertion order is oldest-first.
  return Object.values(db.tracks).reverse();
}

// Tracks shown in the current view (home = whole library, playlist = its tracks).
function viewTracks() {
  return onHome ? allTracks() : activeTracks();
}

/* ---------- YouTube helpers ---------- */

// Accepts any YouTube URL format and returns the video ID, or null.
function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
    /(?:youtube\.com\/live\/)([\w-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function canonicalUrl(videoId) {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

// Uses YouTube's oEmbed endpoint (no API key required) to fetch metadata.
async function fetchVideoInfo(videoId) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    canonicalUrl(videoId)
  )}&format=json`;

  const res = await fetch(oembedUrl);
  if (!res.ok) throw new Error("Video not found or unavailable");

  const data = await res.json();
  return {
    id: videoId,
    url: canonicalUrl(videoId),
    title: data.title,
    channel: data.author_name,
    thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
  };
}

/* ---------- Status messages ---------- */

let statusTimeout;
function setStatus(message, type = "") {
  els.status.textContent = message;
  els.status.className = `status ${type}`.trim();
  clearTimeout(statusTimeout);
  statusTimeout = setTimeout(() => {
    els.status.textContent = "";
    els.status.className = "status";
  }, 4000);
}

/* ---------- Rendering ---------- */

function render() {
  closePlaylistMenu();
  closeExportMenu();
  els.playlistName.textContent = onHome ? "All songs" : activePlaylist().name;
  els.exportBtn.title = onHome
    ? "On All songs — this exports your full library"
    : "Export the current playlist as JSON";
  renderSidebar();
  renderList();
  renderSpotlight(false);
}

/* ---------- Sidebar nav highlight (slides between items) ---------- */

// Persistent node so its top/height transition animates between items across re-renders.
const navIndicator = document.createElement("div");
navIndicator.className = "nav-indicator";

function positionNavIndicator() {
  const active = els.playlistNav.querySelector(".playlist-item.active");
  if (!active) return;
  navIndicator.style.top = active.offsetTop + "px";
  navIndicator.style.height = active.offsetHeight + "px";
}

window.addEventListener("resize", positionNavIndicator);

function renderSidebar() {
  els.playlistNav.innerHTML = "";

  const home = document.createElement("li");
  home.className = "playlist-item home" + (onHome ? " active" : "");
  const homeName = document.createElement("span");
  homeName.className = "playlist-name";
  homeName.textContent = "All songs";
  const homeCount = document.createElement("span");
  homeCount.className = "playlist-count";
  homeCount.textContent = Object.keys(db.tracks).length;
  home.append(homeName, homeCount);
  home.addEventListener("click", () => {
    if (onHome) return;
    switchViewAnimated(() => {
      onHome = true;
      els.searchInput.value = "";
      spotlightId = null;
      render();
    });
  });
  els.playlistNav.appendChild(home);

  for (const pl of db.playlists) {
    const li = document.createElement("li");
    li.className = "playlist-item" + (!onHome && pl.id === activeId ? " active" : "");
    li.title = pl.name;

    const name = document.createElement("span");
    name.className = "playlist-name";
    name.textContent = pl.name;

    const count = document.createElement("span");
    count.className = "playlist-count";
    count.textContent = pl.trackIds.length;

    li.append(name, count);
    li.addEventListener("click", () => {
      if (!onHome && activeId === pl.id) return;
      switchViewAnimated(() => {
        onHome = false;
        activeId = pl.id;
        els.searchInput.value = "";
        spotlightId = null;
        save();
        render();
      });
    });

    if (db.playlists.length > 1) {
      const del = document.createElement("button");
      del.className = "playlist-delete";
      del.type = "button";
      del.textContent = "\u00d7";
      del.title = "Delete playlist";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deletePlaylist(pl.id);
      });
      li.appendChild(del);
    }

    els.playlistNav.appendChild(li);
  }

  els.playlistNav.appendChild(navIndicator);
  positionNavIndicator();
  els.trackCount.textContent = `Total songs: ${Object.keys(db.tracks).length}`;
}

/* ---------- View-switch list animation ----------
   Old rows stagger out to the right, new rows stagger in from the left.
   Only used on Home ⇄ playlist switches; search/add/remove stay instant. */
const LIST_STAGGER_MS = 14;
const LIST_STAGGER_CAP = 8;
let listEnterAnimate = false;
let pendingListSwap = null;

function switchViewAnimated(swapFn) {
  if (pendingListSwap) return; // already mid-swap; ignore
  const rows = els.trackList.querySelectorAll(".track");
  if (!rows.length) {
    swapFn();
    return;
  }
  const maxDelay = Math.min(rows.length, LIST_STAGGER_CAP) * LIST_STAGGER_MS;
  pendingListSwap = swapFn;
  rows.forEach((row, i) => {
    row.style.animationDelay = Math.min(i, LIST_STAGGER_CAP) * LIST_STAGGER_MS + "ms";
    row.classList.add("exit-right");
  });
  // Swap while exit rows are still finishing (~75% gone) so enter overlaps
  // exit — the handoff reads as one continuous, fast motion.
  setTimeout(() => {
    const fn = pendingListSwap;
    pendingListSwap = null;
    listEnterAnimate = true;
    fn();
  }, maxDelay + 90);
}

function renderList() {
  const query = els.searchInput.value.trim().toLowerCase();
  const visible = viewTracks().filter(
    (t) =>
      !query ||
      (t.title || "").toLowerCase().includes(query) ||
      (t.channel || "").toLowerCase().includes(query)
  );

  els.trackList.innerHTML = "";
  for (const track of visible) {
    els.trackList.appendChild(createTrackElement(track));
  }

  if (listEnterAnimate) {
    listEnterAnimate = false;
    els.trackList.querySelectorAll(".track").forEach((row, i) => {
      row.style.animationDelay = Math.min(i, LIST_STAGGER_CAP) * LIST_STAGGER_MS + "ms";
      row.classList.add("enter-left");
    });
  }

  if (!visible.length) {
    els.emptyState.querySelector("p").textContent = onHome
      ? "No songs saved yet."
      : "No songs in this playlist yet.";
  }
  els.emptyState.style.display = visible.length ? "none" : "block";
}

function createTrackElement(track) {
  const li = document.createElement("li");
  li.className = "track";

  const img = document.createElement("img");
  img.className = "track-thumb";
  img.src = track.thumbnail;
  img.alt = track.title;
  img.loading = "lazy";

  const info = document.createElement("div");
  info.className = "track-info";

  const title = document.createElement("div");
  title.className = "track-title";
  title.textContent = track.title;

  const channel = document.createElement("div");
  channel.className = "track-channel";
  channel.textContent = track.channel || "";

  info.append(title, channel);

  const actions = document.createElement("div");
  actions.className = "track-actions";

  const addWrap = document.createElement("div");
  addWrap.className = "track-menu-wrap";
  const addBtn = document.createElement("button");
  addBtn.className = "add-to-btn";
  addBtn.type = "button";
  addBtn.textContent = "+ Add";
  addBtn.title = "Add to playlist";
  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePlaylistMenu(addWrap, track.id);
  });
  addWrap.appendChild(addBtn);

  const copyBtn = document.createElement("button");
  copyBtn.className = "copy-btn";
  copyBtn.type = "button";
  copyBtn.textContent = "Copy URL";
  copyBtn.addEventListener("click", () => copyToClipboard(track.url, copyBtn));

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "btn-icon";
  deleteBtn.type = "button";
  deleteBtn.title = "Remove from all playlists";
  deleteBtn.textContent = "\u00d7";
  deleteBtn.addEventListener("click", () => removeTrack(track.id));

  actions.append(addWrap, copyBtn, deleteBtn);
  li.append(img, info, actions);
  return li;
}

/* ---------- Spotlight ---------- */

const SPOTLIGHT_INTERVAL_MS = 5000;
const SLIDE_MS = 250;
let spotlightHovered = false;
let spotlightSwitching = false;
let spotlightId = null;

function pickRandomTrack(pool, excludeId) {
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  let track;
  do {
    track = pool[Math.floor(Math.random() * pool.length)];
  } while (track.id === excludeId);
  return track;
}

function setSpotlightTrack(track, animate) {
  spotlightId = track.id;
  const apply = () => {
    els.spotlightImg.src = track.thumbnail.replace("mqdefault", "hqdefault");
    els.spotlightImg.alt = track.title;
    els.spotlightTitle.textContent = track.title;
    els.spotlightChannel.textContent = track.channel || "";
    els.spotlightHint.textContent = "Click to copy URL";
    els.spotlightHint.classList.remove("copied");
  };

  if (!animate || spotlightSwitching || !document.contains(els.spotlightImg)) {
    apply();
    return;
  }

  spotlightSwitching = true;
  els.spotlightImg.classList.add("slide-out");
  setTimeout(() => {
    apply();
    els.spotlightImg.classList.remove("slide-out");
    els.spotlightImg.classList.add("slide-in");
    setTimeout(() => {
      els.spotlightImg.classList.remove("slide-in");
      spotlightSwitching = false;
    }, SLIDE_MS);
  }, SLIDE_MS);
}

function renderSpotlight(animate) {
  // Spotlight is a standalone feature: always shuffles the whole library,
  // regardless of which view (home or playlist) is active.
  const pool = allTracks();
  if (!pool.length) {
    els.spotlight.style.display = "none";
    spotlightId = null;
    return;
  }
  els.spotlight.style.display = "flex";
  if (animate) {
    setSpotlightTrack(pickRandomTrack(pool, spotlightId), true);
  } else {
    setSpotlightTrack(pickRandomTrack(pool, null), false);
  }
}

function shuffleSpotlight() {
  renderSpotlight(true);
}

function autoShuffle() {
  if (spotlightHovered || spotlightSwitching || !allTracks().length) return;
  renderSpotlight(true);
}

/* ---------- Track actions ---------- */

async function addTrack() {
  const rawUrl = els.urlInput.value.trim();
  if (!rawUrl) {
    setStatus("Paste a YouTube link first.", "error");
    return;
  }

  const videoId = extractVideoId(rawUrl);
  if (!videoId) {
    setStatus("That doesn't look like a valid YouTube link.", "error");
    return;
  }

  const pl = ensureActivePlaylist();
  if (pl.trackIds.includes(videoId)) {
    setStatus(`Already in "${pl.name}".`, "error");
    return;
  }

  let track = db.tracks[videoId];
  if (!track) {
    els.addBtn.disabled = true;
    setStatus("Loading video info...");
    try {
      track = await fetchVideoInfo(videoId);
    } catch {
      setStatus("Couldn't load that video. Check the link and try again.", "error");
      return;
    } finally {
      els.addBtn.disabled = false;
    }
    db.tracks[videoId] = track;
  }

  pl.trackIds.unshift(videoId);
  save();
  els.urlInput.value = "";
  render();
  setStatus(`Added "${track.title}" to ${pl.name}`, "success");
}

function removeTrack(videoId) {
  for (const pl of db.playlists) {
    pl.trackIds = pl.trackIds.filter((id) => id !== videoId);
  }
  const stillUsed = db.playlists.some((pl) => pl.trackIds.includes(videoId));
  if (!stillUsed) delete db.tracks[videoId];
  save();
  render();
  setStatus("Removed from all playlists.", "success");
}

/* ---------- Add-to-playlist menu ---------- */

let openMenuWrap = null;

function closePlaylistMenu() {
  if (!openMenuWrap) return;
  const menu = openMenuWrap.querySelector(".playlist-menu");
  if (menu) menu.remove();
  openMenuWrap.classList.remove("open");
  openMenuWrap = null;
}

function togglePlaylistMenu(wrap, videoId) {
  if (openMenuWrap === wrap) {
    closePlaylistMenu();
    return;
  }
  closePlaylistMenu();

  const menu = document.createElement("div");
  menu.className = "playlist-menu";
  const heading = document.createElement("div");
  heading.className = "playlist-menu-title";
  heading.textContent = "Add to playlist";
  menu.appendChild(heading);

  for (const pl of db.playlists) {
    const inPlaylist = pl.trackIds.includes(videoId);
    const item = document.createElement("button");
    item.type = "button";
    item.className = "playlist-menu-item";
    item.title = inPlaylist
      ? `Already in "${pl.name}" — click to remove`
      : `Add to "${pl.name}"`;
    const name = document.createElement("span");
    name.className = "playlist-menu-name";
    name.textContent = pl.name;
    item.appendChild(name);
    if (inPlaylist) {
      const check = document.createElement("span");
      check.className = "playlist-menu-check";
      check.textContent = "\u2713";
      item.appendChild(check);
    }
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      closePlaylistMenu();
      toggleTrackInPlaylist(videoId, pl);
    });
    menu.appendChild(item);
  }

  wrap.appendChild(menu);
  wrap.classList.add("open");
  openMenuWrap = wrap;
}

// Adds the song to the playlist, or removes it from that playlist if already in it.
function toggleTrackInPlaylist(videoId, pl) {
  const track = db.tracks[videoId];
  if (pl.trackIds.includes(videoId)) {
    pl.trackIds = pl.trackIds.filter((id) => id !== videoId);
    const stillUsed = db.playlists.some((p) => p.trackIds.includes(videoId));
    if (!stillUsed) delete db.tracks[videoId];
    save();
    render();
    if (track) setStatus(`Removed "${track.title}" from "${pl.name}"`, "success");
  } else {
    pl.trackIds.push(videoId);
    save();
    render();
    if (track) setStatus(`Added "${track.title}" to "${pl.name}"`, "success");
  }
}

/* ---------- Playlist management ---------- */

async function newPlaylist() {
  const name = await askName("New playlist", "What should it be called?");
  if (!name) return;
  if (db.playlists.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
    setStatus(`A playlist named "${name}" already exists.`, "error");
    return;
  }
  const pl = makePlaylist(name);
  db.playlists.push(pl);
  onHome = false;
  activeId = pl.id;
  save();
  render();
  setStatus(`Created playlist "${name}"`, "success");
}

async function deletePlaylist(id) {
  const pl = db.playlists.find((p) => p.id === id);
  const ok = await askConfirm(
    `Delete "${pl.name}"?`,
    "Only the playlist is deleted — songs that live in other playlists are kept."
  );
  if (!ok) return;
  db.playlists = db.playlists.filter((p) => p.id !== id);
  if (activeId === id) {
    if (db.playlists.length) {
      activeId = db.playlists[0].id;
    } else {
      // No playlists left — land on Home. "All songs" is the library view,
      // not a playlist, so the app always has somewhere to show tracks.
      activeId = null;
      onHome = true;
    }
  }
  save();
  render();
}

/* ---------- Custom dialog (native prompt/confirm are NEVER used) ---------- */

let dialogResolve = null;

function openDialog({
  title,
  message = "",
  input = null,
  okLabel = "OK",
  danger = false,
}) {
  els.dialogTitle.textContent = title;
  els.dialogMessage.textContent = message;
  els.dialogMessage.hidden = !message;
  const showInput = input !== null;
  els.dialogInput.hidden = !showInput;
  if (showInput) els.dialogInput.value = input;
  els.dialogOk.textContent = okLabel;
  els.dialogOk.classList.toggle("btn-danger", danger);
  els.dialog.classList.add("open");
  if (showInput) {
    els.dialogInput.focus();
    els.dialogInput.select();
  }
}

function closeDialog(result) {
  els.dialog.classList.remove("open");
  const resolve = dialogResolve;
  dialogResolve = null;
  if (resolve) resolve(result);
}

/* Promise-based: resolve = true (OK clicked) or null (cancel/backdrop/Esc);
   input mode resolves the trimmed value or null. */
function askDialog(opts) {
  return new Promise((resolve) => {
    dialogResolve = resolve;
    openDialog(opts);
  });
}

function askConfirm(title, message, okLabel = "Delete") {
  return askDialog({ title, message, okLabel, danger: true }).then((v) => !!v);
}

function askName(title, message, okLabel = "Create") {
  return askDialog({ title, message, input: "", okLabel }).then((v) =>
    v == null ? null : v.trim()
  );
}

els.dialogOk.addEventListener("click", () => {
  closeDialog(els.dialogInput.hidden ? true : els.dialogInput.value);
});
els.dialogCancel.addEventListener("click", () => closeDialog(null));
els.dialog.addEventListener("click", (e) => {
  if (e.target === els.dialog) closeDialog(null); // backdrop click
});
els.dialogInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") els.dialogOk.click();
});

/* ---------- Export ---------- */

function slug(name) {
  return (
    name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "playlist"
  );
}

function triggerDownload(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

function exportPlaylistFile(pl) {
  const data = {
    format: "sc-juke-export",
    exported: new Date().toISOString(),
    name: pl.name,
    tracks: pl.trackIds.map((id) => db.tracks[id]).filter(Boolean),
  };
  triggerDownload(`${slug(pl.name)}.json`, JSON.stringify(data, null, 2));
  setStatus(`Exported "${pl.name}"`, "success");
}

function exportAll() {
  const data = {
    format: "sc-juke-export",
    exported: new Date().toISOString(),
    playlists: db.playlists.map((p) => ({
      name: p.name,
      tracks: p.trackIds.map((id) => db.tracks[id]).filter(Boolean),
    })),
  };
  triggerDownload("sc-juke-library.json", JSON.stringify(data, null, 2));
  setStatus("Exported full library", "success");
}

function closeExportMenu() {
  els.exportMenuWrap.classList.remove("open");
}

/* Flat export: every song in the library as one bare JSON array (in the
   order they were added), no playlist structure. Import merges a bare array
   into the active playlist, skipping duplicates already there. */
function exportFlat() {
  const tracks = Object.values(db.tracks).map((t) => ({
    id: t.id,
    url: t.url,
    title: t.title,
    channel: t.channel,
    thumbnail: t.thumbnail,
  }));
  if (!tracks.length) {
    setStatus("Your library is empty — nothing to export.", "error");
    return;
  }
  triggerDownload("sc-juke-all-songs.json", JSON.stringify(tracks, null, 2));
  setStatus(
    `Exported ${tracks.length} song${tracks.length === 1 ? "" : "s"} (flat list)`,
    "success"
  );
}

/* ---------- Clipboard ---------- */

async function copyToClipboard(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for contexts where the async clipboard API is unavailable.
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  if (button) {
    button.textContent = "Copied!";
    button.classList.add("copied");
    setTimeout(() => {
      button.textContent = "Copy URL";
      button.classList.remove("copied");
    }, 1500);
  }
}

/* ---------- Import ---------- */

function handleImportFile(file) {
  const reader = new FileReader();
  reader.onload = () => importText(String(reader.result), file.name);
  reader.onerror = () => setStatus("Couldn't read that file.", "error");
  reader.readAsText(file);
}

async function importText(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    setStatus("That file is empty.", "error");
    return;
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      setStatus("That doesn't look like valid JSON or a URL list.", "error");
      return;
    }
    await importJSON(parsed);
    return;
  }

  await importTextUrls(trimmed);
}

// Normalizes a track from an imported file; accepts our export format and
// reasonable variations (id/url, title, channel/author_name, thumbnail variants).
function normalizeImportTrack(t) {
  if (typeof t === "string") t = { url: t };
  const url = t.url || (t.id ? canonicalUrl(t.id) : null);
  const videoId = url ? extractVideoId(url) : null;
  if (!videoId) return null;
  return {
    videoId,
    url: canonicalUrl(videoId),
    title: t.title || null,
    channel: t.channel || t.author_name || null,
    thumbnail: t.thumbnail || t.thumbnail_url || null,
  };
}

async function importTracksInto(pl, importTracks) {
  let added = 0;
  for (const t of importTracks) {
    if (pl.trackIds.includes(t.videoId)) continue; // no duplicates
    let track = db.tracks[t.videoId];
    if (!track) {
      if (!t.title) {
        try {
          track = await fetchVideoInfo(t.videoId);
        } catch {
          continue; // skip videos we can't resolve
        }
      } else {
        track = {
          id: t.videoId,
          url: t.url,
          title: t.title,
          channel: t.channel,
          thumbnail: t.thumbnail || `https://i.ytimg.com/vi/${t.videoId}/mqdefault.jpg`,
        };
      }
      db.tracks[t.videoId] = track;
    }
    pl.trackIds.push(t.videoId);
    added++;
  }
  return added;
}

async function importJSON(data) {
  const items = Array.isArray(data)
    ? [{ name: activePlaylist()?.name || "Imported songs", tracks: data }]
    : data.playlists || (data.tracks ? [data] : []);
  if (!items.length) {
    setStatus("Couldn't find any playlists or tracks in that file.", "error");
    return;
  }

  let totalAdded = 0;
  const created = [];
  for (const item of items) {
    const importTracks = (item.tracks || []).map(normalizeImportTrack).filter(Boolean);
    if (!importTracks.length) continue;
    const name = (item.name || "").trim() || "Imported";
    const existing = db.playlists.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    );
    const pl = existing || makePlaylist(name);
    if (!existing) db.playlists.push(pl);
    totalAdded += await importTracksInto(pl, importTracks);
    if (!existing) created.push(pl.name);
  }

  save();
  render();
  const parts = [
    `Imported ${totalAdded} song${totalAdded === 1 ? "" : "s"}`,
  ];
  if (created.length) {
    parts.push(`new playlist${created.length === 1 ? "" : "s"}: ${created.join(", ")}`);
  }
  setStatus(parts.join(" — "), totalAdded ? "success" : "error");
}

async function importTextUrls(text) {
  const seen = new Set();
  const importTracks = [];
  for (const line of text.split(/\r?\n/)) {
    const videoId = extractVideoId(line.trim());
    if (!videoId || seen.has(videoId)) continue;
    seen.add(videoId);
    importTracks.push({
      videoId,
      url: canonicalUrl(videoId),
      title: null,
      channel: null,
      thumbnail: null,
    });
  }
  if (!importTracks.length) {
    setStatus("No YouTube links found in that file.", "error");
    return;
  }

  const pl = ensureActivePlaylist();
  setStatus(`Importing into "${pl.name}"...`);
  const added = await importTracksInto(pl, importTracks);
  save();
  render();
  setStatus(
    `Imported ${added} new song${added === 1 ? "" : "s"} into ${pl.name}`,
    added ? "success" : "error"
  );
}

/* ---------- Events ---------- */

els.addBtn.addEventListener("click", addTrack);
els.urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addTrack();
});
els.searchInput.addEventListener("input", renderList);
els.shuffleBtn.addEventListener("click", shuffleSpotlight);
els.spotlight.addEventListener("mouseenter", () => {
  spotlightHovered = true;
});
els.spotlight.addEventListener("mouseleave", () => {
  spotlightHovered = false;
});
setInterval(() => {
  if (!document.hidden) autoShuffle();
}, SPOTLIGHT_INTERVAL_MS);

els.newPlaylistBtn.addEventListener("click", newPlaylist);
els.exportBtn.addEventListener("click", () => {
  if (onHome) {
    exportAll();
  } else {
    const pl = activePlaylist();
    if (pl) exportPlaylistFile(pl);
    else exportAll();
  }
});
els.exportAllBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  const willOpen = !els.exportMenuWrap.classList.contains("open");
  closeExportMenu();
  if (willOpen) els.exportMenuWrap.classList.add("open");
});

els.exportMenuWrap.querySelectorAll(".playlist-menu-item").forEach((row) => {
  row.addEventListener("click", () => {
    if (row.dataset.export === "flat") exportFlat();
    else exportAll();
    closeExportMenu();
  });
});
els.importBtn.addEventListener("click", () => els.importInput.click());
els.importInput.addEventListener("change", () => {
  const file = els.importInput.files[0];
  if (file) handleImportFile(file);
  els.importInput.value = "";
});

els.spotlightThumb.addEventListener("click", () => {
  const track = db.tracks[spotlightId];
  if (!track) return;
  copyToClipboard(track.url, null);
  els.spotlightHint.textContent = "Copied!";
  els.spotlightHint.classList.add("copied");
  setTimeout(() => {
    els.spotlightHint.textContent = "Click to copy URL";
    els.spotlightHint.classList.remove("copied");
  }, 1500);
});

document.addEventListener("click", (e) => {
  if (openMenuWrap && !openMenuWrap.contains(e.target)) closePlaylistMenu();
  if (
    els.exportMenuWrap.classList.contains("open") &&
    !els.exportMenuWrap.contains(e.target)
  ) {
    closeExportMenu();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closePlaylistMenu();
    closeExportMenu();
    if (els.dialog.classList.contains("open")) closeDialog(null);
  }
});

render();
